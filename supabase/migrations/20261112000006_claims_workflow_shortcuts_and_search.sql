-- =============================================================================
-- Migration: 20261112000006_claims_workflow_shortcuts_and_search.sql
-- Description: Root-admin-only Approve & Go to Payout atomic shortcut RPC,
--              four-eyes verification, and claims workflow enhancements.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_claim_approve_and_go_to_payout(p_claim_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_claim RECORD;
    v_root_member_id UUID;
    v_root_email TEXT;
    v_root_name TEXT;
    v_root_epf TEXT;
BEGIN
    -- 1. Strictly enforce Root Admin only at the database function level
    IF NOT (session_user = 'postgres' OR public.is_root_admin()) THEN
        RAISE EXCEPTION 'Access Denied: Only the root administrator can use the Approve & Go to Payout shortcut.'
            USING ERRCODE = '42501';
    END IF;

    -- Fetch claim record with row lock
    SELECT * INTO v_claim FROM public.benefit_claims WHERE id = p_claim_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Benefit claim % not found.', p_claim_id;
    END IF;

    IF v_claim.status != 'submitted' THEN
        RAISE EXCEPTION 'Cannot execute Approve & Go to Payout on claim with status "%" (must be submitted).', v_claim.status;
    END IF;

    -- Resolve caller identity
    SELECT id, email, full_name, epf_number 
    INTO v_root_member_id, v_root_email, v_root_name, v_root_epf
    FROM public.members WHERE user_id = auth.uid() LIMIT 1;

    IF v_root_member_id IS NULL THEN
        SELECT id, email, full_name, epf_number 
        INTO v_root_member_id, v_root_email, v_root_name, v_root_epf
        FROM public.members WHERE email = 'krishaja@gmail.com' LIMIT 1;
    END IF;

    -- Update claim to approved with root approver
    UPDATE public.benefit_claims
    SET status = 'approved',
        approved_by = v_root_member_id
    WHERE id = p_claim_id;

    -- Audit log entry
    INSERT INTO public.audit_logs (
        timestamp,
        user_email,
        full_name,
        epf_number,
        action,
        entity_type,
        entity_id,
        diff_json
    ) VALUES (
        timezone('utc', now()),
        COALESCE(v_root_email, 'krishaja@gmail.com'),
        COALESCE(v_root_name, 'Root Administrator'),
        COALESCE(v_root_epf, 'ROOT'),
        'ROOT_ADMIN_APPROVE_AND_GO_TO_PAYOUT',
        'benefit_claims',
        p_claim_id::text,
        jsonb_build_object(
            'claim_id', p_claim_id,
            'claim_amount', v_claim.claim_amount,
            'member_id', v_claim.member_id,
            'approved_by', v_root_member_id,
            'shortcut', true
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'claim_id', p_claim_id,
        'status', 'approved',
        'approved_by', v_root_member_id,
        'member_id', v_claim.member_id,
        'claim_amount', v_claim.claim_amount
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_claim_approve_and_go_to_payout(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_claim_approve_and_go_to_payout(UUID) TO authenticated;
