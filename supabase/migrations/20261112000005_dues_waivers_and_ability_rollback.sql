-- =============================================================================
-- Migration Rollback: 20261112000005_dues_waivers_and_ability_rollback.sql
-- Description: Rolls back dues waiver engine, partial indexes, and functions
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_reverse_dues_waiver(UUID, TEXT);
DROP FUNCTION IF EXISTS public.fn_record_dues_waiver(UUID, TEXT, DATE, UUID, NUMERIC, TEXT);

DROP TABLE IF EXISTS public.dues_waivers CASCADE;

-- Revert get_my_abilities() to previous static array
CREATE OR REPLACE FUNCTION public.get_my_abilities()
RETURNS TEXT[] AS $$
DECLARE
    v_user_email TEXT;
    v_abilities TEXT[];
BEGIN
    v_user_email := auth.jwt() ->> 'email';

    -- Root administrator receives all abilities
    IF v_user_email = 'krishaja@gmail.com' THEN
        RETURN ARRAY[
            'assign_roles',
            'approve_slips',
            'collect_cash',
            'manage_treasury',
            'manage_receipts',
            'benefit_payout_desk',
            'benefit_review_edit',
            'benefit_review_view',
            'view_defaulters',
            'view_audit_logs',
            'edit_bank_coordinates',
            'edit_dues_statutory',
            'edit_welfare_programs',
            'view_respond_inquiries',
            'dispatch_notifications',
            'view_medical_inquiries'
        ]::TEXT[];
    END IF;

    SELECT COALESCE(array_agg(mp.ability::TEXT), ARRAY[]::TEXT[])
    INTO v_abilities
    FROM public.member_permissions mp
    JOIN public.members m ON m.id = mp.member_id
    WHERE m.user_id = auth.uid()
      AND m.is_approved = true
      AND m.is_archived = false;

    RETURN v_abilities;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- Revert set_member_abilities()
CREATE OR REPLACE FUNCTION public.set_member_abilities(
    p_target_member_id UUID,
    p_abilities public.app_ability[]
)
RETURNS JSONB AS $$
DECLARE
    v_caller_email TEXT;
    v_caller_member_id UUID;
    v_is_authorized BOOLEAN;
    v_prev_abilities TEXT[];
    v_new_abilities TEXT[];
BEGIN
    v_caller_email := auth.jwt() ->> 'email';

    IF session_user = 'postgres' THEN
        v_is_authorized := true;
        v_caller_email := COALESCE(v_caller_email, 'postgres-admin');
    ELSE
        v_is_authorized := (v_caller_email = 'krishaja@gmail.com') OR public.has_ability('assign_roles'::public.app_ability);
    END IF;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Access Denied: You do not have permission to assign member abilities.';
    END IF;

    SELECT id INTO v_caller_member_id FROM public.members WHERE user_id = auth.uid() LIMIT 1;
    IF v_caller_member_id IS NULL THEN
        SELECT id INTO v_caller_member_id FROM public.members WHERE email = 'krishaja@gmail.com' LIMIT 1;
    END IF;

    SELECT COALESCE(array_agg(ability::TEXT), ARRAY[]::TEXT[])
    INTO v_prev_abilities
    FROM public.member_permissions
    WHERE member_id = p_target_member_id;

    DELETE FROM public.member_permissions WHERE member_id = p_target_member_id;

    IF p_abilities IS NOT NULL AND array_length(p_abilities, 1) > 0 THEN
        INSERT INTO public.member_permissions (member_id, ability, granted_by)
        SELECT p_target_member_id, unnest(p_abilities), v_caller_member_id;
    END IF;

    SELECT COALESCE(array_agg(ability::TEXT), ARRAY[]::TEXT[])
    INTO v_new_abilities
    FROM public.member_permissions
    WHERE member_id = p_target_member_id;

    PERFORM public.fn_record_audit_log(
        'ASSIGN_MEMBER_ABILITIES',
        'member_permissions',
        p_target_member_id::TEXT,
        jsonb_build_object(
            'target_member_id', p_target_member_id,
            'previous_abilities', v_prev_abilities,
            'new_abilities', v_new_abilities,
            'assigned_by', v_caller_email,
            'timestamp', timezone('utc', now())
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'member_id', p_target_member_id,
        'abilities', v_new_abilities
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
