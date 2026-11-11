-- =============================================================================
-- Migration Rollback: 20261111000007_advance_payment_auto_settlement_rollback.sql
-- Description: Reverts advance payment auto-settlement migration safely
-- =============================================================================

-- 1. Drop the trigger on member_dues
DROP TRIGGER IF EXISTS trg_due_created_auto_settle ON public.member_dues;

-- 2. Drop the auto-settle trigger function
DROP FUNCTION IF EXISTS public.reconcile_due_from_advance();

-- 3. Drop the manual reconciler functions
DROP FUNCTION IF EXISTS public.reconcile_member_advance_dues(UUID);
DROP FUNCTION IF EXISTS public.reconcile_all_members_advance_dues();

-- 4. Restore original void_payment_receipt function
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

-- 5. Drop the column from member_dues
ALTER TABLE public.member_dues 
DROP COLUMN IF EXISTS is_advance_settled;

-- 6. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
