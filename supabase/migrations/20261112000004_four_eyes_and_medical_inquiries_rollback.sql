-- Rollback Migration: 20261112000004_four_eyes_and_medical_inquiries_rollback.sql

DROP TRIGGER IF EXISTS trg_benefit_claim_four_eyes ON public.benefit_claims;
DROP FUNCTION IF EXISTS public.fn_enforce_benefit_claim_four_eyes();

-- Restore previous benefit claims policies
DROP POLICY IF EXISTS benefit_claims_select_policy ON public.benefit_claims;
DROP POLICY IF EXISTS benefit_claims_update_policy ON public.benefit_claims;
DROP POLICY IF EXISTS benefit_claims_insert_policy ON public.benefit_claims;

CREATE POLICY benefit_claims_staff_manage ON public.benefit_claims
FOR ALL TO authenticated
USING (get_current_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'treasurer'::app_role, 'secretary'::app_role, 'committee_member'::app_role, 'official'::app_role]))
WITH CHECK (get_current_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'treasurer'::app_role]));

-- Restore previous inquiries policies
DROP POLICY IF EXISTS inquiries_select_policy ON public.admin_inquiries;
DROP POLICY IF EXISTS inquiries_update_policy ON public.admin_inquiries;

CREATE POLICY inquiries_select_policy ON public.admin_inquiries
FOR SELECT TO authenticated
USING (
    session_user = 'postgres'
    OR sender_id = (SELECT m.id FROM public.members m WHERE m.user_id = auth.uid() LIMIT 1)
    OR (auth.jwt() ->> 'email'::text) = 'krishaja@gmail.com'::text
    OR public.has_ability('view_respond_inquiries'::app_ability)
);

CREATE POLICY inquiries_update_policy ON public.admin_inquiries
FOR UPDATE TO authenticated
USING (
    session_user = 'postgres'
    OR (auth.jwt() ->> 'email'::text) = 'krishaja@gmail.com'::text
    OR public.has_ability('view_respond_inquiries'::app_ability)
)
WITH CHECK (
    session_user = 'postgres'
    OR (auth.jwt() ->> 'email'::text) = 'krishaja@gmail.com'::text
    OR public.has_ability('view_respond_inquiries'::app_ability)
);

ALTER TABLE public.admin_inquiries DROP COLUMN IF EXISTS category;
DROP FUNCTION IF EXISTS public.is_root_admin();
