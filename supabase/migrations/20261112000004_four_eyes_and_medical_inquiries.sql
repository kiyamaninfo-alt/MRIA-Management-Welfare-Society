-- Migration: 20261112000004_four_eyes_and_medical_inquiries.sql
-- Description: Enforces four-eyes segregation of duties on welfare claims, logs root admin actions/overrides,
--              hardens root admin spoof-proofing with immutable UID verification, and adds confidential medical inquiry tier.

-- 1. Spoof-Proof Root Admin Identification Function
CREATE OR REPLACE FUNCTION public.is_root_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_email TEXT;
BEGIN
    -- Superuser session override (for tests and migrations)
    IF session_user = 'postgres' THEN
        RETURN TRUE;
    END IF;

    v_uid := auth.uid();
    v_email := LOWER(COALESCE(auth.jwt() ->> 'email', ''));

    -- Verifies both cryptographic JWT user ID AND exact root administrator email
    RETURN (
        v_uid = '1906cef7-2a8a-484c-8f01-95e2d26c6afe'::uuid
        AND v_email = 'krishaja@gmail.com'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_root_admin() TO authenticated, anon;

-- 2. Update has_ability() to use is_root_admin()
CREATE OR REPLACE FUNCTION public.has_ability(p_ability public.app_ability)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_has BOOLEAN;
BEGIN
    IF public.is_root_admin() THEN
        RETURN TRUE;
    END IF;

    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.member_permissions mp
        JOIN public.members m ON m.id = mp.member_id
        WHERE m.user_id = v_user_id
          AND mp.ability = p_ability
    ) INTO v_has;

    RETURN COALESCE(v_has, FALSE);
END;
$$;

-- 3. Medical / Welfare Inquiries Confidentiality Tier
DO $$
BEGIN
    ALTER TYPE public.app_ability ADD VALUE IF NOT EXISTS 'view_medical_inquiries';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.admin_inquiries 
ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general' 
CHECK (category IN ('general', 'welfare_medical'));

-- Update Inquiries RLS Policies for Confidential Medical Tier
DROP POLICY IF EXISTS inquiries_select_policy ON public.admin_inquiries;
DROP POLICY IF EXISTS inquiries_update_policy ON public.admin_inquiries;

CREATE POLICY inquiries_select_policy ON public.admin_inquiries
FOR SELECT TO authenticated
USING (
    session_user = 'postgres'
    OR sender_id = (SELECT m.id FROM public.members m WHERE m.user_id = auth.uid() LIMIT 1)
    OR public.is_root_admin()
    OR (category = 'general' AND public.has_ability('view_respond_inquiries'::app_ability))
    OR (category = 'welfare_medical' AND public.has_ability('view_medical_inquiries'::app_ability))
);

CREATE POLICY inquiries_update_policy ON public.admin_inquiries
FOR UPDATE TO authenticated
USING (
    session_user = 'postgres'
    OR public.is_root_admin()
    OR (category = 'general' AND public.has_ability('view_respond_inquiries'::app_ability))
    OR (category = 'welfare_medical' AND public.has_ability('view_medical_inquiries'::app_ability))
)
WITH CHECK (
    session_user = 'postgres'
    OR public.is_root_admin()
    OR (category = 'general' AND public.has_ability('view_respond_inquiries'::app_ability))
    OR (category = 'welfare_medical' AND public.has_ability('view_medical_inquiries'::app_ability))
);

-- 4. Benefit Claims RLS Policies Alignment with Granular Abilities
DROP POLICY IF EXISTS benefit_claims_staff_manage ON public.benefit_claims;
DROP POLICY IF EXISTS benefit_claims_select_policy ON public.benefit_claims;
DROP POLICY IF EXISTS benefit_claims_update_policy ON public.benefit_claims;
DROP POLICY IF EXISTS benefit_claims_insert_policy ON public.benefit_claims;

CREATE POLICY benefit_claims_select_policy ON public.benefit_claims
FOR SELECT TO authenticated
USING (
    session_user = 'postgres'
    OR member_id = (SELECT m.id FROM public.members m WHERE m.user_id = auth.uid() LIMIT 1)
    OR public.is_root_admin()
    OR public.has_ability('benefit_review_view'::app_ability)
    OR public.has_ability('benefit_review_edit'::app_ability)
    OR public.has_ability('benefit_payout_desk'::app_ability)
    OR (get_current_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'treasurer'::app_role, 'secretary'::app_role, 'committee_member'::app_role, 'official'::app_role]))
);

CREATE POLICY benefit_claims_update_policy ON public.benefit_claims
FOR UPDATE TO authenticated
USING (
    session_user = 'postgres'
    OR public.is_root_admin()
    OR public.has_ability('benefit_review_edit'::app_ability)
    OR public.has_ability('benefit_payout_desk'::app_ability)
    OR (get_current_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'treasurer'::app_role]))
)
WITH CHECK (
    session_user = 'postgres'
    OR public.is_root_admin()
    OR public.has_ability('benefit_review_edit'::app_ability)
    OR public.has_ability('benefit_payout_desk'::app_ability)
    OR (get_current_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'treasurer'::app_role]))
);

CREATE POLICY benefit_claims_insert_policy ON public.benefit_claims
FOR INSERT TO authenticated
WITH CHECK (
    session_user = 'postgres'
    OR ((member_id = (SELECT m.id FROM public.members m WHERE m.user_id = auth.uid() LIMIT 1)) AND (is_approved_member() = true))
    OR public.is_root_admin()
    OR public.has_ability('benefit_payout_desk'::app_ability)
    OR (get_current_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'treasurer'::app_role]))
);

-- 5. Four-Eyes Claim Trigger Function
CREATE OR REPLACE FUNCTION public.fn_enforce_benefit_claim_four_eyes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_is_root BOOLEAN;
    v_actor_user_id UUID;
    v_actor_member_id UUID;
    v_actor_email TEXT;
    v_actor_name TEXT;
    v_actor_epf TEXT;
BEGIN
    -- Allow direct superuser operations (migrations/seeds) when unauthenticated
    IF session_user = 'postgres' AND auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    v_is_root := public.is_root_admin();
    v_actor_user_id := auth.uid();
    v_actor_email := LOWER(COALESCE(auth.jwt() ->> 'email', ''));

    IF v_actor_user_id IS NOT NULL THEN
        SELECT id, full_name, epf_number INTO v_actor_member_id, v_actor_name, v_actor_epf
        FROM public.members
        WHERE user_id = v_actor_user_id
        LIMIT 1;
    END IF;

    -- Stage 1: Approval Enforcement
    IF (NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved')) THEN
        -- Check authority
        IF NOT v_is_root AND NOT public.has_ability('benefit_review_edit'::app_ability) THEN
            RAISE EXCEPTION 'Unauthorized: Member lacks benefit_review_edit ability to approve welfare claims'
                USING ERRCODE = '42501';
        END IF;

        -- Check self-approval: officer cannot approve own claim
        IF v_actor_member_id IS NOT NULL AND NEW.member_id = v_actor_member_id AND NOT v_is_root THEN
            RAISE EXCEPTION 'Conflict of interest: Officers cannot approve their own welfare claims'
                USING ERRCODE = '23514';
        END IF;

        -- Auto-assign approver if not explicitly set
        IF NEW.approved_by IS NULL AND v_actor_member_id IS NOT NULL THEN
            NEW.approved_by := v_actor_member_id;
        END IF;

        -- Root Admin Approval Audit Entry
        IF v_is_root THEN
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
                COALESCE(v_actor_email, 'krishaja@gmail.com'),
                COALESCE(v_actor_name, 'Root Administrator'),
                COALESCE(v_actor_epf, 'ROOT'),
                'ROOT_ADMIN_BENEFIT_APPROVAL',
                'benefit_claims',
                NEW.id::text,
                jsonb_build_object(
                    'claim_id', NEW.id,
                    'claim_amount', NEW.claim_amount,
                    'member_id', NEW.member_id,
                    'approved_by', NEW.approved_by
                )
            );
        END IF;
    END IF;

    -- Prevent tampering with existing approver during subsequent updates
    IF (TG_OP = 'UPDATE' AND OLD.status = 'approved' AND NEW.approved_by IS DISTINCT FROM OLD.approved_by AND NOT v_is_root) THEN
        RAISE EXCEPTION 'Unauthorized: Cannot modify existing approver of a claim'
            USING ERRCODE = '42501';
    END IF;

    -- Stage 2: Disbursement Enforcement
    IF (NEW.status = 'disbursed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'disbursed')) THEN
        -- Check authority
        IF NOT v_is_root AND NOT public.has_ability('benefit_payout_desk'::app_ability) THEN
            RAISE EXCEPTION 'Unauthorized: Member lacks benefit_payout_desk ability to disburse welfare claims'
                USING ERRCODE = '42501';
        END IF;

        -- Auto-assign disburser if not explicitly set
        IF NEW.disbursed_by IS NULL AND v_actor_member_id IS NOT NULL THEN
            NEW.disbursed_by := v_actor_member_id;
        END IF;

        -- Check self-disbursement: officer cannot disburse aid to self
        IF v_actor_member_id IS NOT NULL AND NEW.member_id = v_actor_member_id AND NOT v_is_root THEN
            RAISE EXCEPTION 'Conflict of interest: Officers cannot disburse welfare aid to themselves'
                USING ERRCODE = '23514';
        END IF;

        -- Segregation of Duties: Approver and Disburser must be different individuals
        IF NEW.approved_by IS NOT NULL AND NEW.disbursed_by IS NOT NULL AND NEW.approved_by = NEW.disbursed_by THEN
            IF v_is_root THEN
                -- Root admin solo approval & disbursement logged with special override audit entry
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
                    COALESCE(v_actor_email, 'krishaja@gmail.com'),
                    COALESCE(v_actor_name, 'Root Administrator'),
                    COALESCE(v_actor_epf, 'ROOT'),
                    'ROOT_ADMIN_FOUR_EYES_OVERRIDE',
                    'benefit_claims',
                    NEW.id::text,
                    jsonb_build_object(
                        'reason', 'Root administrator solo approval and disbursement override',
                        'claim_id', NEW.id,
                        'claim_amount', NEW.claim_amount,
                        'disbursed_amount', NEW.disbursed_amount,
                        'approved_by', NEW.approved_by,
                        'disbursed_by', NEW.disbursed_by
                    )
                );
            ELSE
                RAISE EXCEPTION 'Four-eyes policy violation: Welfare benefit claim must be approved and disbursed by two different officers'
                    USING ERRCODE = '23514';
            END IF;
        ELSIF v_is_root THEN
            -- Root admin disbursement where approved by someone else
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
                COALESCE(v_actor_email, 'krishaja@gmail.com'),
                COALESCE(v_actor_name, 'Root Administrator'),
                COALESCE(v_actor_epf, 'ROOT'),
                'ROOT_ADMIN_BENEFIT_DISBURSEMENT',
                'benefit_claims',
                NEW.id::text,
                jsonb_build_object(
                    'claim_id', NEW.id,
                    'disbursed_amount', NEW.disbursed_amount,
                    'approved_by', NEW.approved_by,
                    'disbursed_by', NEW.disbursed_by
                )
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_benefit_claim_four_eyes ON public.benefit_claims;

CREATE TRIGGER trg_benefit_claim_four_eyes
BEFORE INSERT OR UPDATE ON public.benefit_claims
FOR EACH ROW
EXECUTE FUNCTION public.fn_enforce_benefit_claim_four_eyes();
