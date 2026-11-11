-- =============================================================================
-- Migration: 20261111000007_advance_payment_auto_settlement.sql
-- Description: Automatic advance-payment settlement for newly generated monthly dues
-- Security: SECURITY DEFINER, search_path = public, idempotent, non-destructive
-- =============================================================================

-- 1. Add `is_advance_settled` flag to member_dues to distinguish prepaid months
ALTER TABLE public.member_dues 
ADD COLUMN IF NOT EXISTS is_advance_settled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.member_dues.is_advance_settled IS 
'True if this monthly due was automatically covered and settled from prior advance payments.';

-- 2. Core Reconciliation Function: Settles a single pending due using unallocated advance payments (FIFO)
CREATE OR REPLACE FUNCTION public.reconcile_due_from_advance()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER 
SET search_path = public, pg_temp
AS $$
DECLARE
    v_needed NUMERIC(10, 2) := NEW.amount;
    v_alloc NUMERIC(10, 2);
    v_pay RECORD;
BEGIN
    -- Idempotency safeguard: only process if the newly inserted due is 'pending'
    IF NEW.status = 'pending' THEN
        -- Loop through verified monthly_due payments that have available unallocated balance in FIFO order
        FOR v_pay IN
            SELECT 
                p.id,
                p.amount - COALESCE(SUM(pdr.allocated_amount), 0) AS available_balance
            FROM public.payments p
            LEFT JOIN public.payment_dues_reconciliation pdr ON pdr.payment_id = p.id
            WHERE p.member_id = NEW.member_id 
              AND p.payment_type = 'monthly_due' 
              AND p.status = 'verified'
            GROUP BY p.id, p.amount, p.created_at
            HAVING (p.amount - COALESCE(SUM(pdr.allocated_amount), 0)) > 0
            ORDER BY p.created_at ASC
        LOOP
            EXIT WHEN v_needed <= 0;

            v_alloc := LEAST(v_pay.available_balance, v_needed);

            -- Record reconciliation link between advance payment and the new due
            INSERT INTO public.payment_dues_reconciliation (payment_id, due_id, allocated_amount)
            VALUES (v_pay.id, NEW.id, v_alloc);

            v_needed := v_needed - v_alloc;
        END LOOP;

        -- If completely covered by advance balance, mark as paid and flag as advance settled
        IF v_needed <= 0 THEN
            UPDATE public.member_dues
            SET status = 'paid',
                is_advance_settled = true,
                updated_at = NOW()
            WHERE id = NEW.id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- 3. Attach Trigger on `member_dues`
DROP TRIGGER IF EXISTS trg_due_created_auto_settle ON public.member_dues;
CREATE TRIGGER trg_due_created_auto_settle
AFTER INSERT ON public.member_dues
FOR EACH ROW
EXECUTE FUNCTION public.reconcile_due_from_advance();

-- 4. Batch Reconciler Function: Allows manual or retroactive reconciliation for a specific member
CREATE OR REPLACE FUNCTION public.reconcile_member_advance_dues(p_member_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_due RECORD;
    v_settled_count INT := 0;
    v_needed NUMERIC(10, 2);
    v_alloc NUMERIC(10, 2);
    v_pay RECORD;
BEGIN
    -- Loop through pending dues chronologically
    FOR v_due IN 
        SELECT id, amount 
        FROM public.member_dues 
        WHERE member_id = p_member_id AND status = 'pending'
        ORDER BY billing_month ASC
    LOOP
        v_needed := v_due.amount;

        FOR v_pay IN
            SELECT 
                p.id,
                p.amount - COALESCE(SUM(pdr.allocated_amount), 0) AS available_balance
            FROM public.payments p
            LEFT JOIN public.payment_dues_reconciliation pdr ON pdr.payment_id = p.id
            WHERE p.member_id = p_member_id 
              AND p.payment_type = 'monthly_due' 
              AND p.status = 'verified'
            GROUP BY p.id, p.amount, p.created_at
            HAVING (p.amount - COALESCE(SUM(pdr.allocated_amount), 0)) > 0
            ORDER BY p.created_at ASC
        LOOP
            EXIT WHEN v_needed <= 0;

            v_alloc := LEAST(v_pay.available_balance, v_needed);

            INSERT INTO public.payment_dues_reconciliation (payment_id, due_id, allocated_amount)
            VALUES (v_pay.id, v_due.id, v_alloc);

            v_needed := v_needed - v_alloc;
        END LOOP;

        IF v_needed <= 0 THEN
            UPDATE public.member_dues
            SET status = 'paid',
                is_advance_settled = true,
                updated_at = NOW()
            WHERE id = v_due.id;

            v_settled_count := v_settled_count + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'member_id', p_member_id,
        'settled_dues_count', v_settled_count
    );
END;
$$;

-- 5. Update `void_payment_receipt` to reset `is_advance_settled` if a payment is voided
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

    IF v_payment.status != 'verified' THEN
        RAISE EXCEPTION 'Only verified payment receipts can be voided (current status: %)', v_payment.status;
    END IF;

    SELECT email, full_name, epf_number INTO v_actor 
    FROM public.members WHERE id = p_voided_by;

    UPDATE public.payments
    SET status = 'voided',
        rejection_reason = p_reason,
        verified_by = p_voided_by,
        verified_at = NOW()
    WHERE id = p_payment_id;

    -- Un-settle reconciled dues back to pending, resetting advance flag
    WITH reverted AS (
        UPDATE public.member_dues md
        SET status = 'pending',
            is_advance_settled = false,
            updated_at = NOW()
        FROM public.payment_dues_reconciliation pdr
        WHERE pdr.payment_id = p_payment_id
          AND pdr.due_id = md.id
        RETURNING md.id
    )
    SELECT COUNT(*) INTO v_reversed_dues FROM reverted;

    DELETE FROM public.payment_dues_reconciliation WHERE payment_id = p_payment_id;

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

    INSERT INTO public.treasury_transactions (
        transaction_type,
        source_account_id,
        destination_account_id,
        amount,
        reference_no,
        description,
        recorded_by,
        payment_id
    ) VALUES (
        'outflow',
        v_source_account,
        NULL,
        v_payment.amount,
        'VOID-REV-' || UPPER(SUBSTRING(p_payment_id::text, 1, 8)),
        'Automatic Treasury Reversal: Payment ' || UPPER(SUBSTRING(p_payment_id::text, 1, 8)) || ' was voided by ' || COALESCE(v_actor.email, 'Admin') || '. Reason: ' || p_reason,
        p_voided_by,
        p_payment_id
    );

    PERFORM public.log_user_activity(
        'RECEIPT_VOIDED',
        'PAYMENT',
        p_payment_id::text,
        jsonb_build_object(
            'amount', v_payment.amount,
            'reason', p_reason,
            'reversed_dues_count', v_reversed_dues,
            'treasury_account', v_source_account
        ),
        v_actor.email, v_actor.full_name, v_actor.epf_number
    );

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', p_payment_id,
        'reversed_dues_count', v_reversed_dues,
        'treasury_reversed_account', v_source_account
    );
END;
$$;

-- 6. Batch Retroactive Reconciler: Reconciles all pending dues against existing unallocated advance payments
CREATE OR REPLACE FUNCTION public.reconcile_all_members_advance_dues()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_member RECORD;
    v_total_settled INT := 0;
    v_res JSONB;
BEGIN
    FOR v_member IN
        SELECT DISTINCT m.id
        FROM public.members m
        JOIN public.member_dues md ON md.member_id = m.id AND md.status = 'pending'
        JOIN public.payments p ON p.member_id = m.id AND p.payment_type = 'monthly_due' AND p.status = 'verified'
    LOOP
        v_res := public.reconcile_member_advance_dues(v_member.id);
        v_total_settled := v_total_settled + COALESCE((v_res->>'settled_dues_count')::INT, 0);
    END LOOP;

    RETURN jsonb_build_object(
        'total_retroactively_settled_dues', v_total_settled
    );
END;
$$;

-- 7. One-time execution to settle all historical pending dues covered by advance funds
SELECT public.reconcile_all_members_advance_dues();

-- 8. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';


