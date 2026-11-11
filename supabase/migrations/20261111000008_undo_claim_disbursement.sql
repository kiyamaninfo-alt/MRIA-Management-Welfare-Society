-- =============================================================================
-- Migration: 20261111000008_undo_claim_disbursement.sql
-- Description: RPC function to safely undo welfare benefit grant disbursements within 30 days
-- Security: SECURITY DEFINER, search_path = public, strict 30-day validation
-- =============================================================================

CREATE OR REPLACE FUNCTION public.undo_claim_disbursement(
    p_claim_id UUID,
    p_reason TEXT,
    p_undone_by UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_claim RECORD;
    v_account_id VARCHAR(50);
    v_actor RECORD;
    v_disbursed_amount NUMERIC(12, 2);
    v_ref_no TEXT;
BEGIN
    SELECT * INTO v_claim FROM public.benefit_claims WHERE id = p_claim_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Benefit claim % not found', p_claim_id;
    END IF;

    IF v_claim.status != 'disbursed' THEN
        RAISE EXCEPTION 'Only disbursed claims can be undone (current status: %)', v_claim.status;
    END IF;

    -- Enforce 30-day statutory undo window
    IF COALESCE(v_claim.disbursed_at, v_claim.created_at) < (NOW() - INTERVAL '30 days') THEN
        RAISE EXCEPTION 'Cannot undo disbursements older than 30 days (disbursed at: %)', COALESCE(v_claim.disbursed_at, v_claim.created_at);
    END IF;

    SELECT email, full_name, epf_number INTO v_actor 
    FROM public.members WHERE id = p_undone_by;

    v_disbursed_amount := COALESCE(v_claim.disbursed_amount, v_claim.claim_amount);
    v_ref_no := 'REV-CLM-' || UPPER(SUBSTRING(p_claim_id::text, 1, 8));

    -- Determine which treasury account was originally debited
    SELECT source_account_id INTO v_account_id 
    FROM public.treasury_transactions 
    WHERE claim_id = p_claim_id AND transaction_type = 'outflow'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_account_id IS NULL THEN
        v_account_id := CASE 
            WHEN v_claim.payment_method = 'cash' THEN 'cash_in_hand'
            ELSE 'boc_savings'
        END;
    END IF;

    -- Record compensating Treasury Inflow reversal
    INSERT INTO public.treasury_transactions (
        transaction_date,
        transaction_type,
        destination_account_id,
        source_account_id,
        amount,
        reference_no,
        description,
        claim_id,
        recorded_by
    ) VALUES (
        CURRENT_DATE,
        'inflow',
        v_account_id,
        NULL,
        v_disbursed_amount,
        v_ref_no,
        'Automatic Treasury Reversal: Benefit disbursement for CLM-' || UPPER(SUBSTRING(p_claim_id::text, 1, 8)) || ' was undone by ' || COALESCE(v_actor.email, 'Admin') || '. Reason: ' || p_reason,
        p_claim_id,
        p_undone_by
    );

    -- Revert claim status to approved and clear disbursement fields
    UPDATE public.benefit_claims
    SET status = 'approved',
        disbursed_amount = NULL,
        disbursed_at = NULL,
        disbursed_by = NULL,
        notes = CASE 
            WHEN notes IS NULL OR notes = '' THEN 'Disbursement undone: ' || p_reason
            ELSE notes || ' | [Disbursement undone on ' || TO_CHAR(NOW() AT TIME ZONE 'Asia/Colombo', 'YYYY-MM-DD HH24:MI') || ' by ' || COALESCE(v_actor.email, 'Admin') || ': ' || p_reason || ']'
        END
    WHERE id = p_claim_id;

    -- Log activity in audit_logs
    PERFORM public.log_user_activity(
        'BENEFIT_DISBURSEMENT_UNDONE',
        'BENEFIT_CLAIM',
        p_claim_id::text,
        jsonb_build_object(
            'amount', v_disbursed_amount,
            'reason', p_reason,
            'treasury_account', v_account_id,
            'previous_status', 'disbursed',
            'new_status', 'approved'
        ),
        v_actor.email, v_actor.full_name, v_actor.epf_number
    );

    RETURN jsonb_build_object(
        'success', true,
        'claim_id', p_claim_id,
        'reverted_status', 'approved',
        'reversed_amount', v_disbursed_amount,
        'credited_account', v_account_id
    );
END;
$$;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
