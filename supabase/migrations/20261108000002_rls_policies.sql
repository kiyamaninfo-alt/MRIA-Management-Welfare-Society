-- Migration: 20261108000002_rls_policies
-- Description: Row Level Security functions and policies for all tables

-- 1. HELPER FUNCTIONS (SECURITY DEFINER to prevent recursive RLS)
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS app_role AS $$
    SELECT role FROM public.members WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_approved_member()
RETURNS BOOLEAN AS $$
    SELECT COALESCE((SELECT is_approved FROM public.members WHERE user_id = auth.uid() LIMIT 1), false);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_current_member_id()
RETURNS UUID AS $$
    SELECT id FROM public.members WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- 2. ENABLE RLS
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_dues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_dues_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.benefit_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.benefit_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- 3. MEMBERS POLICIES
CREATE POLICY members_self_read ON public.members
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY members_admin_manager_all ON public.members
    FOR ALL TO authenticated
    USING (public.get_current_user_role() IN ('admin', 'manager'))
    WITH CHECK (public.get_current_user_role() IN ('admin', 'manager'));

CREATE POLICY members_staff_read ON public.members
    FOR SELECT TO authenticated
    USING (public.get_current_user_role() IN ('official', 'treasurer'));

-- 4. MEMBER DUES POLICIES
CREATE POLICY member_dues_self_read ON public.member_dues
    FOR SELECT TO authenticated
    USING (member_id = public.get_current_member_id());

CREATE POLICY member_dues_staff_manage ON public.member_dues
    FOR ALL TO authenticated
    USING (public.get_current_user_role() IN ('admin', 'manager', 'official', 'treasurer'))
    WITH CHECK (public.get_current_user_role() IN ('admin', 'manager', 'official', 'treasurer'));

-- 5. PAYMENTS POLICIES
CREATE POLICY payments_self_read ON public.payments
    FOR SELECT TO authenticated
    USING (member_id = public.get_current_member_id());

CREATE POLICY payments_self_insert ON public.payments
    FOR INSERT TO authenticated
    WITH CHECK (
        member_id = public.get_current_member_id()
        AND public.is_approved_member() = true
    );

CREATE POLICY payments_treasurer_admin_all ON public.payments
    FOR ALL TO authenticated
    USING (public.get_current_user_role() IN ('admin', 'treasurer'))
    WITH CHECK (public.get_current_user_role() IN ('admin', 'treasurer'));

CREATE POLICY payments_staff_read ON public.payments
    FOR SELECT TO authenticated
    USING (public.get_current_user_role() IN ('manager', 'official'));

-- 6. PAYMENT DUES RECONCILIATION POLICIES
CREATE POLICY payment_dues_rec_self_read ON public.payment_dues_reconciliation
    FOR SELECT TO authenticated
    USING (
        payment_id IN (
            SELECT id FROM public.payments WHERE member_id = public.get_current_member_id()
        )
    );

CREATE POLICY payment_dues_rec_staff_all ON public.payment_dues_reconciliation
    FOR ALL TO authenticated
    USING (public.get_current_user_role() IN ('admin', 'manager', 'official', 'treasurer'))
    WITH CHECK (public.get_current_user_role() IN ('admin', 'manager', 'official', 'treasurer'));

-- 7. BENEFIT TYPES POLICIES
CREATE POLICY benefit_types_approved_read ON public.benefit_types
    FOR SELECT TO authenticated
    USING (is_active = true AND public.is_approved_member() = true);

CREATE POLICY benefit_types_admin_manage ON public.benefit_types
    FOR ALL TO authenticated
    USING (public.get_current_user_role() IN ('admin', 'manager'))
    WITH CHECK (public.get_current_user_role() IN ('admin', 'manager'));

-- 8. BENEFIT CLAIMS POLICIES
CREATE POLICY benefit_claims_self_read ON public.benefit_claims
    FOR SELECT TO authenticated
    USING (member_id = public.get_current_member_id());

CREATE POLICY benefit_claims_self_insert ON public.benefit_claims
    FOR INSERT TO authenticated
    WITH CHECK (
        member_id = public.get_current_member_id()
        AND public.is_approved_member() = true
    );

CREATE POLICY benefit_claims_staff_manage ON public.benefit_claims
    FOR ALL TO authenticated
    USING (public.get_current_user_role() IN ('admin', 'manager', 'treasurer'))
    WITH CHECK (public.get_current_user_role() IN ('admin', 'manager', 'treasurer'));

-- 9. ANNOUNCEMENTS POLICIES
CREATE POLICY announcements_approved_read ON public.announcements
    FOR SELECT TO authenticated
    USING (public.is_approved_member() = true);

CREATE POLICY announcements_admin_manage ON public.announcements
    FOR ALL TO authenticated
    USING (public.get_current_user_role() IN ('admin', 'manager'))
    WITH CHECK (public.get_current_user_role() IN ('admin', 'manager'));

-- 10. SYSTEM SETTINGS POLICIES
CREATE POLICY system_settings_approved_read ON public.system_settings
    FOR SELECT TO authenticated
    USING (public.is_approved_member() = true);

CREATE POLICY system_settings_admin_manage ON public.system_settings
    FOR ALL TO authenticated
    USING (public.get_current_user_role() = 'admin')
    WITH CHECK (public.get_current_user_role() = 'admin');
