-- =============================================================================
-- Migration: 20261112000005_dues_waivers_and_ability.sql
-- Description: Dues & Admission Fee Waiver Engine, Partial Unique Indexes,
--              Reversibility Lifecycle, and Root-Admin-Gated Ability Protection
-- =============================================================================

-- 1. Ensure `waive_statutory_dues` exists in `public.app_ability`
DO $$
BEGIN
    ALTER TYPE public.app_ability ADD VALUE IF NOT EXISTS 'waive_statutory_dues';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 2. Dues Waivers Table
CREATE TABLE IF NOT EXISTS public.dues_waivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    waiver_type TEXT NOT NULL CHECK (waiver_type IN ('monthly_due', 'admission_fee')),
    billing_month DATE NULL,
    due_id UUID NULL REFERENCES public.member_dues(id) ON DELETE RESTRICT,
    waived_amount NUMERIC(10, 2) NOT NULL CHECK (waived_amount > 0),
    reason TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
    waived_by UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    is_active BOOLEAN NOT NULL DEFAULT true,
    reversed_by UUID NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    reversed_at TIMESTAMPTZ NULL,
    reversal_reason TEXT NULL CHECK (reversal_reason IS NULL OR length(trim(reversal_reason)) >= 5)
);

-- Partial unique indexes: Exactly one active waiver per monthly due or admission fee
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_monthly_waiver 
ON public.dues_waivers (member_id, billing_month) 
WHERE is_active = true AND waiver_type = 'monthly_due';

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_admission_waiver 
ON public.dues_waivers (member_id) 
WHERE is_active = true AND waiver_type = 'admission_fee';

-- Lookup and foreign key performance indexes
CREATE INDEX IF NOT EXISTS idx_dues_waivers_member_id ON public.dues_waivers(member_id);
CREATE INDEX IF NOT EXISTS idx_dues_waivers_due_id ON public.dues_waivers(due_id);
CREATE INDEX IF NOT EXISTS idx_dues_waivers_is_active ON public.dues_waivers(is_active);

-- Row Level Security
ALTER TABLE public.dues_waivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dues_waivers_select_policy ON public.dues_waivers;
CREATE POLICY dues_waivers_select_policy ON public.dues_waivers
FOR SELECT TO authenticated
USING (
    session_user = 'postgres'
    OR public.is_root_admin()
    OR public.has_ability('waive_statutory_dues'::public.app_ability)
    OR public.has_ability('view_defaulters'::public.app_ability)
    OR member_id IN (SELECT id FROM public.members WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS dues_waivers_admin_manage ON public.dues_waivers;
CREATE POLICY dues_waivers_admin_manage ON public.dues_waivers
FOR ALL TO authenticated
USING (
    session_user = 'postgres'
    OR public.is_root_admin()
)
WITH CHECK (
    session_user = 'postgres'
    OR public.is_root_admin()
);

-- 3. Dynamic get_my_abilities() reflecting all enum values for Root Administrator
CREATE OR REPLACE FUNCTION public.get_my_abilities()
RETURNS TEXT[] AS $$
DECLARE
    v_abilities TEXT[];
BEGIN
    -- Root administrator receives all abilities
    IF public.is_root_admin() THEN
        SELECT array_agg(e.enumlabel::TEXT ORDER BY e.enumsortorder)
        INTO v_abilities
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'app_ability';
        RETURN COALESCE(v_abilities, ARRAY[]::TEXT[]);
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

REVOKE EXECUTE ON FUNCTION public.get_my_abilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_abilities() TO authenticated;

-- 4. Update set_member_abilities(): Only Root Admin can grant or revoke `waive_statutory_dues`
CREATE OR REPLACE FUNCTION public.set_member_abilities(
    p_target_member_id UUID,
    p_abilities public.app_ability[]
)
RETURNS JSONB AS $$
DECLARE
    v_caller_email TEXT;
    v_caller_member_id UUID;
    v_is_root BOOLEAN;
    v_has_assign_roles BOOLEAN;
    v_prev_abilities TEXT[];
    v_new_abilities TEXT[];
    v_target_had_waive BOOLEAN;
    v_target_will_have_waive BOOLEAN;
BEGIN
    v_caller_email := auth.jwt() ->> 'email';
    v_is_root := (session_user = 'postgres') OR public.is_root_admin();
    v_has_assign_roles := public.has_ability('assign_roles'::public.app_ability);

    IF NOT (v_is_root OR v_has_assign_roles) THEN
        RAISE EXCEPTION 'Access Denied: You do not have permission to assign member abilities.';
    END IF;

    -- Check if target currently has 'waive_statutory_dues'
    SELECT EXISTS (
        SELECT 1 FROM public.member_permissions
        WHERE member_id = p_target_member_id AND ability = 'waive_statutory_dues'::public.app_ability
    ) INTO v_target_had_waive;

    -- Check if target will have 'waive_statutory_dues' in new set
    v_target_will_have_waive := (p_abilities IS NOT NULL AND 'waive_statutory_dues'::public.app_ability = ANY(p_abilities));

    -- Strict governance guard: Only Root Admin can grant or revoke waive_statutory_dues
    IF (v_target_had_waive != v_target_will_have_waive) AND NOT v_is_root THEN
        RAISE EXCEPTION 'Access Denied: Only the root administrator can assign or revoke the waive_statutory_dues ability.';
    END IF;

    SELECT id INTO v_caller_member_id FROM public.members WHERE user_id = auth.uid() LIMIT 1;
    IF v_caller_member_id IS NULL THEN
        SELECT id INTO v_caller_member_id FROM public.members WHERE email = 'krishaja@gmail.com' LIMIT 1;
    END IF;
    IF v_caller_member_id IS NULL THEN
        SELECT id INTO v_caller_member_id FROM public.members LIMIT 1;
    END IF;

    -- Capture previous abilities
    SELECT COALESCE(array_agg(ability::TEXT), ARRAY[]::TEXT[])
    INTO v_prev_abilities
    FROM public.member_permissions
    WHERE member_id = p_target_member_id;

    -- Delete old abilities
    DELETE FROM public.member_permissions WHERE member_id = p_target_member_id;

    -- Insert new abilities
    IF p_abilities IS NOT NULL AND array_length(p_abilities, 1) > 0 THEN
        INSERT INTO public.member_permissions (member_id, ability, granted_by)
        SELECT p_target_member_id, unnest(p_abilities), v_caller_member_id;
    END IF;

    -- Capture new abilities
    SELECT COALESCE(array_agg(ability::TEXT), ARRAY[]::TEXT[])
    INTO v_new_abilities
    FROM public.member_permissions
    WHERE member_id = p_target_member_id;

    -- Record in audit log
    PERFORM public.fn_record_audit_log(
        'ASSIGN_MEMBER_ABILITIES',
        'member_permissions',
        p_target_member_id::TEXT,
        jsonb_build_object(
            'target_member_id', p_target_member_id,
            'previous_abilities', v_prev_abilities,
            'new_abilities', v_new_abilities,
            'assigned_by', COALESCE(v_caller_email, 'postgres-admin'),
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

REVOKE EXECUTE ON FUNCTION public.set_member_abilities(UUID, public.app_ability[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_abilities(UUID, public.app_ability[]) TO authenticated;

-- 5. Atomic Waiver Recording Function: fn_record_dues_waiver
CREATE OR REPLACE FUNCTION public.fn_record_dues_waiver(
    p_member_id UUID,
    p_waiver_type TEXT,
    p_billing_month DATE DEFAULT NULL,
    p_due_id UUID DEFAULT NULL,
    p_waived_amount NUMERIC DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_is_authorized BOOLEAN;
    v_caller_member_id UUID;
    v_caller_email TEXT;
    v_due RECORD;
    v_target_member RECORD;
    v_waiver_id UUID;
    v_amount NUMERIC(10, 2);
    v_month DATE;
    v_is_paid BOOLEAN;
    v_is_already_waived BOOLEAN;
BEGIN
    -- 1. Authorization check: root admin or has 'waive_statutory_dues'
    v_caller_email := auth.jwt() ->> 'email';
    v_is_authorized := (session_user = 'postgres')
                    OR public.is_root_admin()
                    OR public.has_ability('waive_statutory_dues'::public.app_ability);

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Access Denied: You do not have permission to waive statutory dues (requires waive_statutory_dues ability).';
    END IF;

    -- Caller member identity
    SELECT id INTO v_caller_member_id FROM public.members WHERE user_id = auth.uid() LIMIT 1;
    IF v_caller_member_id IS NULL THEN
        SELECT id INTO v_caller_member_id FROM public.members WHERE email = 'krishaja@gmail.com' LIMIT 1;
    END IF;
    IF v_caller_member_id IS NULL THEN
        SELECT id INTO v_caller_member_id FROM public.members LIMIT 1;
    END IF;

    -- Target member validation
    SELECT * INTO v_target_member FROM public.members WHERE id = p_member_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target member % not found.', p_member_id;
    END IF;

    -- Reason validation
    IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'A mandatory waiver reason with at least 5 characters is required.';
    END IF;

    -- Type validation
    IF p_waiver_type NOT IN ('monthly_due', 'admission_fee') THEN
        RAISE EXCEPTION 'Invalid waiver type: %. Must be monthly_due or admission_fee.', p_waiver_type;
    END IF;

    -- 2. Process Monthly Due Waiver
    IF p_waiver_type = 'monthly_due' THEN
        -- Resolve due record
        IF p_due_id IS NOT NULL THEN
            SELECT * INTO v_due FROM public.member_dues WHERE id = p_due_id FOR UPDATE;
        ELSIF p_billing_month IS NOT NULL THEN
            v_month := date_trunc('month', p_billing_month)::DATE;
            SELECT * INTO v_due FROM public.member_dues 
            WHERE member_id = p_member_id AND billing_month = v_month FOR UPDATE;
        ELSE
            RAISE EXCEPTION 'Either due_id or billing_month must be provided for monthly_due waiver.';
        END IF;

        IF FOUND THEN
            -- Invariant 3: Reject waiving an already-paid due inside database function!
            IF v_due.status = 'paid' THEN
                RAISE EXCEPTION 'Cannot waive an already-paid due (Month: %, Status: paid).', to_char(v_due.billing_month, 'YYYY-MM');
            END IF;

            IF v_due.status = 'waived' THEN
                RAISE EXCEPTION 'Due for month % is already waived.', to_char(v_due.billing_month, 'YYYY-MM');
            END IF;

            v_month := v_due.billing_month;
            v_amount := COALESCE(p_waived_amount, v_due.amount);

            -- Update due status to waived
            UPDATE public.member_dues
            SET status = 'waived',
                updated_at = NOW()
            WHERE id = v_due.id;
        ELSE
            -- No existing due row: insert as waived directly
            v_month := date_trunc('month', p_billing_month)::DATE;
            v_amount := COALESCE(p_waived_amount, 300.00);

            INSERT INTO public.member_dues (
                member_id, billing_month, amount, status
            ) VALUES (
                p_member_id, v_month, v_amount, 'waived'
            ) RETURNING * INTO v_due;
        END IF;

        -- Check active waiver partial index constraint preemptively with clear error
        SELECT EXISTS (
            SELECT 1 FROM public.dues_waivers 
            WHERE member_id = p_member_id 
              AND billing_month = v_month 
              AND is_active = true
        ) INTO v_is_already_waived;

        IF v_is_already_waived THEN
            RAISE EXCEPTION 'An active waiver already exists for month %.', to_char(v_month, 'YYYY-MM');
        END IF;

        -- Insert into dues_waivers
        INSERT INTO public.dues_waivers (
            member_id, waiver_type, billing_month, due_id, waived_amount, reason, waived_by
        ) VALUES (
            p_member_id, 'monthly_due', v_month, v_due.id, v_amount, trim(p_reason), v_caller_member_id
        ) RETURNING id INTO v_waiver_id;

    -- 3. Process Admission Fee Waiver
    ELSIF p_waiver_type = 'admission_fee' THEN
        -- Check if already verified/paid
        SELECT EXISTS (
            SELECT 1 FROM public.payments 
            WHERE member_id = p_member_id 
              AND payment_type = 'admission_fee' 
              AND status = 'verified'
        ) INTO v_is_paid;

        IF v_is_paid THEN
            RAISE EXCEPTION 'Cannot waive admission fee: an approved payment has already been verified for this member.';
        END IF;

        -- Check if already actively waived
        SELECT EXISTS (
            SELECT 1 FROM public.dues_waivers 
            WHERE member_id = p_member_id 
              AND waiver_type = 'admission_fee' 
              AND is_active = true
        ) INTO v_is_already_waived;

        IF v_is_already_waived THEN
            RAISE EXCEPTION 'Admission fee is already waived for this member.';
        END IF;

        v_amount := COALESCE(p_waived_amount, 500.00);

        INSERT INTO public.dues_waivers (
            member_id, waiver_type, billing_month, due_id, waived_amount, reason, waived_by
        ) VALUES (
            p_member_id, 'admission_fee', NULL, NULL, v_amount, trim(p_reason), v_caller_member_id
        ) RETURNING id INTO v_waiver_id;
    END IF;

    -- 4. Audit Logging
    PERFORM public.fn_record_audit_log(
        'WAIVE_STATUTORY_DUE',
        'dues_waivers',
        v_waiver_id::TEXT,
        jsonb_build_object(
            'waiver_id', v_waiver_id,
            'member_id', p_member_id,
            'member_epf', v_target_member.epf_number,
            'member_name', v_target_member.full_name,
            'waiver_type', p_waiver_type,
            'billing_month', v_month,
            'waived_amount', v_amount,
            'reason', trim(p_reason),
            'waived_by', COALESCE(v_caller_email, 'postgres')
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'waiver_id', v_waiver_id,
        'member_id', p_member_id,
        'waiver_type', p_waiver_type,
        'billing_month', v_month,
        'waived_amount', v_amount
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_record_dues_waiver(UUID, TEXT, DATE, UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_record_dues_waiver(UUID, TEXT, DATE, UUID, NUMERIC, TEXT) TO authenticated;

-- 6. Atomic Waiver Reversal Function: fn_reverse_dues_waiver
CREATE OR REPLACE FUNCTION public.fn_reverse_dues_waiver(
    p_waiver_id UUID,
    p_reversal_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_is_authorized BOOLEAN;
    v_caller_member_id UUID;
    v_caller_email TEXT;
    v_waiver RECORD;
    v_target_member RECORD;
    v_reconcile_result JSONB;
BEGIN
    -- 1. Authorization check: root admin or has 'waive_statutory_dues'
    v_caller_email := auth.jwt() ->> 'email';
    v_is_authorized := (session_user = 'postgres')
                    OR public.is_root_admin()
                    OR public.has_ability('waive_statutory_dues'::public.app_ability);

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Access Denied: You do not have permission to reverse statutory waivers (requires waive_statutory_dues ability).';
    END IF;

    -- Caller member identity
    SELECT id INTO v_caller_member_id FROM public.members WHERE user_id = auth.uid() LIMIT 1;
    IF v_caller_member_id IS NULL THEN
        SELECT id INTO v_caller_member_id FROM public.members WHERE email = 'krishaja@gmail.com' LIMIT 1;
    END IF;
    IF v_caller_member_id IS NULL THEN
        SELECT id INTO v_caller_member_id FROM public.members LIMIT 1;
    END IF;

    -- Reversal reason validation
    IF p_reversal_reason IS NULL OR length(trim(p_reversal_reason)) < 5 THEN
        RAISE EXCEPTION 'A mandatory reversal reason with at least 5 characters is required.';
    END IF;

    -- Find waiver record with row lock
    SELECT * INTO v_waiver FROM public.dues_waivers WHERE id = p_waiver_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Waiver record % not found.', p_waiver_id;
    END IF;

    -- Invariant 4: Safe idempotent handling if already reversed!
    IF v_waiver.is_active = FALSE THEN
        RETURN jsonb_build_object(
            'success', true,
            'waiver_id', p_waiver_id,
            'status', 'already_reversed',
            'message', 'Waiver was already reversed previously.'
        );
    END IF;

    -- Target member info for audit log
    SELECT * INTO v_target_member FROM public.members WHERE id = v_waiver.member_id;

    -- Update waiver record to inactive
    UPDATE public.dues_waivers
    SET is_active = false,
        reversed_by = v_caller_member_id,
        reversed_at = NOW(),
        reversal_reason = trim(p_reversal_reason)
    WHERE id = p_waiver_id;

    -- 2. If monthly due, return member_due to 'pending'
    IF v_waiver.waiver_type = 'monthly_due' AND v_waiver.due_id IS NOT NULL THEN
        UPDATE public.member_dues
        SET status = 'pending',
            updated_at = NOW()
        WHERE id = v_waiver.due_id;

        -- Invariant 2: Trigger advance payment auto-settlement reconciliation if member has advance funds!
        SELECT public.reconcile_member_advance_dues(v_waiver.member_id) INTO v_reconcile_result;
    END IF;

    -- 3. Audit Logging
    PERFORM public.fn_record_audit_log(
        'REVERSE_STATUTORY_WAIVER',
        'dues_waivers',
        p_waiver_id::TEXT,
        jsonb_build_object(
            'waiver_id', p_waiver_id,
            'member_id', v_waiver.member_id,
            'member_epf', v_target_member.epf_number,
            'member_name', v_target_member.full_name,
            'waiver_type', v_waiver.waiver_type,
            'billing_month', v_waiver.billing_month,
            'waived_amount', v_waiver.waived_amount,
            'original_reason', v_waiver.reason,
            'reversal_reason', trim(p_reversal_reason),
            'reversed_by', COALESCE(v_caller_email, 'postgres'),
            'advance_reconciliation', v_reconcile_result
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'waiver_id', p_waiver_id,
        'status', 'reversed',
        'member_id', v_waiver.member_id,
        'waiver_type', v_waiver.waiver_type,
        'billing_month', v_waiver.billing_month,
        'reconcile_result', v_reconcile_result
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_reverse_dues_waiver(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reverse_dues_waiver(UUID, TEXT) TO authenticated;
