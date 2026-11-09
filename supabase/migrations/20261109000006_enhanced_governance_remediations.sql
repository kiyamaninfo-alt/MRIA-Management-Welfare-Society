-- Migration: 20261109000006_enhanced_governance_remediations.sql
-- Enhanced Governance, Audit Logging, Accounting Voiding, Inquiries & Notifications

-- 1. Extend payment_status enum
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'voided';

-- 2. Member Archival Flag (decoupling lifecycle archival from app_role)
ALTER TABLE public.members 
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

-- 3. Welfare Benefit Claims Proof Attachment Key
ALTER TABLE public.benefit_claims 
ADD COLUMN IF NOT EXISTS document_key VARCHAR(500);

-- 4. 1-to-1 Targeted Notifications Table
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    title_en TEXT NOT NULL,
    title_si TEXT NOT NULL,
    message_en TEXT NOT NULL,
    message_si TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('normal', 'urgent')) DEFAULT 'normal',
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members view own notifications" ON public.notifications;
CREATE POLICY "Members view own notifications" ON public.notifications
    FOR SELECT USING (recipient_id = (SELECT id FROM public.members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Members update own notifications" ON public.notifications;
CREATE POLICY "Members update own notifications" ON public.notifications
    FOR UPDATE USING (recipient_id = (SELECT id FROM public.members WHERE user_id = auth.uid()))
    WITH CHECK (recipient_id = (SELECT id FROM public.members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Staff insert notifications" ON public.notifications;
CREATE POLICY "Staff insert notifications" ON public.notifications
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.members m
            WHERE m.user_id = auth.uid()
              AND m.role IN ('admin', 'secretary', 'treasurer', 'manager')
        )
    );

DROP POLICY IF EXISTS "Admin manage all notifications" ON public.notifications;
CREATE POLICY "Admin manage all notifications" ON public.notifications
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.members m
            WHERE m.user_id = auth.uid()
              AND m.role = 'admin'
        )
    );

-- 5. In-App Admin Inquiries Table
CREATE TABLE IF NOT EXISTS public.admin_inquiries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
    sender_name TEXT NOT NULL,
    sender_email TEXT NOT NULL,
    sender_phone VARCHAR(20),
    sender_epf TEXT,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
    resolved_by UUID REFERENCES public.members(id) ON DELETE SET NULL,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_inquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated members insert inquiries" ON public.admin_inquiries;
CREATE POLICY "Authenticated members insert inquiries" ON public.admin_inquiries
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Staff view inquiries" ON public.admin_inquiries;
CREATE POLICY "Staff view inquiries" ON public.admin_inquiries
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.members m
            WHERE m.user_id = auth.uid()
              AND m.role IN ('admin', 'secretary', 'treasurer', 'manager')
        )
        OR sender_id = (SELECT id FROM public.members WHERE user_id = auth.uid())
    );

DROP POLICY IF EXISTS "Staff update inquiries" ON public.admin_inquiries;
CREATE POLICY "Staff update inquiries" ON public.admin_inquiries
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.members m
            WHERE m.user_id = auth.uid()
              AND m.role IN ('admin', 'secretary', 'treasurer', 'manager')
        )
    );

-- 6. Dual-Mode Member Deletion & Archival Stored Procedure
CREATE OR REPLACE FUNCTION public.delete_or_archive_member(
    p_member_id UUID,
    p_admin_id UUID,
    p_reason TEXT DEFAULT 'Administrative clean up'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pay_count INT := 0;
    v_dues_count INT := 0;
    v_claim_count INT := 0;
    v_staff_refs INT := 0;
    v_member RECORD;
    v_actor RECORD;
BEGIN
    SELECT * INTO v_member FROM public.members WHERE id = p_member_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Member record not found';
    END IF;

    -- Lookup executing admin details for complete immutable audit trail
    SELECT email, full_name, epf_number INTO v_actor 
    FROM public.members WHERE id = p_admin_id;

    -- Count personal member transaction records
    SELECT COUNT(*) INTO v_pay_count FROM public.payments WHERE member_id = p_member_id;
    SELECT COUNT(*) INTO v_dues_count FROM public.member_dues WHERE member_id = p_member_id;
    SELECT COUNT(*) INTO v_claim_count FROM public.benefit_claims WHERE member_id = p_member_id;

    -- Count staff audit references to prevent foreign key constraint crashes (23503 ON DELETE RESTRICT)
    SELECT COUNT(*) INTO v_staff_refs FROM (
        SELECT 1 FROM public.payments WHERE verified_by = p_member_id
        UNION ALL
        SELECT 1 FROM public.treasury_transactions WHERE recorded_by = p_member_id
        UNION ALL
        SELECT 1 FROM public.benefit_claims WHERE disbursed_by = p_member_id OR approved_by = p_member_id
    ) s;

    IF (v_pay_count + v_dues_count + v_claim_count + v_staff_refs) > 0 THEN
        -- Soft Archival Mode: revoke access, set is_archived flag, preserve role history
        UPDATE public.members
        SET is_approved = false,
            is_archived = true,
            updated_at = NOW()
        WHERE id = p_member_id;

        PERFORM public.log_user_activity(
            'MEMBER_ARCHIVED',
            'MEMBER',
            p_member_id::text,
            jsonb_build_object(
                'reason', p_reason,
                'email', v_member.email,
                'epf', v_member.epf_number,
                'transactions_preserved', (v_pay_count + v_dues_count + v_claim_count),
                'staff_references_preserved', v_staff_refs
            ),
            v_actor.email, v_actor.full_name, v_actor.epf_number
        );

        RETURN jsonb_build_object(
            'action', 'archived', 
            'message', 'Member has existing records or staff history. Successfully archived.'
        );
    ELSE
        -- Hard Delete Mode: clean removal for zero-record profiles
        DELETE FROM public.members WHERE id = p_member_id;

        PERFORM public.log_user_activity(
            'MEMBER_DELETED',
            'MEMBER',
            p_member_id::text,
            jsonb_build_object(
                'reason', p_reason,
                'email', v_member.email,
                'epf', v_member.epf_number
            ),
            v_actor.email, v_actor.full_name, v_actor.epf_number
        );

        RETURN jsonb_build_object(
            'action', 'deleted', 
            'message', 'Member had 0 records. Permanently deleted.'
        );
    END IF;
END;
$$;

-- 7. Accounting Receipt Voiding & Automatic Ledger Reversals Stored Procedure
CREATE OR REPLACE FUNCTION public.void_payment_receipt(
    p_payment_id UUID,
    p_reason TEXT,
    p_voided_by UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_payment RECORD;
    v_source_account TEXT;
    v_reversed_dues INT := 0;
    v_actor RECORD;
BEGIN
    SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment record % not found', p_payment_id;
    END IF;

    IF v_payment.status = 'voided' THEN
        RAISE EXCEPTION 'Payment % is already voided', p_payment_id;
    END IF;

    -- Ledger safety invariant: only formally verified receipts can be voided
    IF v_payment.status != 'verified' THEN
        RAISE EXCEPTION 'Only verified payment receipts can be voided (current status: %)', v_payment.status;
    END IF;

    -- Lookup executing officer details for immutable audit trail
    SELECT email, full_name, epf_number INTO v_actor 
    FROM public.members WHERE id = p_voided_by;

    -- Update status and rejection/void reason
    UPDATE public.payments
    SET status = 'voided',
        rejection_reason = p_reason,
        verified_by = p_voided_by,
        verified_at = NOW()
    WHERE id = p_payment_id;

    -- Un-settle reconciled dues back to pending
    WITH reverted AS (
        UPDATE public.member_dues md
        SET status = 'pending',
            updated_at = NOW()
        FROM public.payment_dues_reconciliation pdr
        WHERE pdr.payment_id = p_payment_id
          AND pdr.due_id = md.id
        RETURNING md.id
    )
    SELECT COUNT(*) INTO v_reversed_dues FROM reverted;

    DELETE FROM public.payment_dues_reconciliation WHERE payment_id = p_payment_id;

    -- Resolve treasury account from original verified transaction
    SELECT destination_account_id INTO v_source_account 
    FROM public.treasury_transactions 
    WHERE payment_id = p_payment_id 
    LIMIT 1;

    IF v_source_account IS NULL THEN
        v_source_account := CASE 
            WHEN v_payment.payment_method = 'cash' THEN 'cash_in_hand'
            ELSE 'boc_savings'
        END;
    END IF;

    -- Compensating treasury outflow reversal (append-only ledger)
    INSERT INTO public.treasury_transactions (
        transaction_date,
        transaction_type,
        source_account_id,
        amount,
        reference_no,
        description,
        payment_id,
        recorded_by
    ) VALUES (
        CURRENT_DATE,
        'outflow',
        v_source_account,
        v_payment.amount,
        'VOID-' || SUBSTRING(p_payment_id::text, 1, 8),
        'Voided Receipt Reversal: ' || COALESCE(p_reason, 'Erroneous Entry'),
        p_payment_id,
        p_voided_by
    );

    -- Record in immutable audit log with full actor attributes
    PERFORM public.log_user_activity(
        'RECEIPT_VOIDED',
        'PAYMENT',
        p_payment_id::text,
        jsonb_build_object(
            'reason', p_reason,
            'amount', v_payment.amount,
            'reversed_dues_count', v_reversed_dues,
            'source_account', v_source_account,
            'payment_type', v_payment.payment_type
        ),
        v_actor.email, v_actor.full_name, v_actor.epf_number
    );

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', p_payment_id,
        'reversed_dues', v_reversed_dues,
        'reversal_amount', v_payment.amount
    );
END;
$$;
