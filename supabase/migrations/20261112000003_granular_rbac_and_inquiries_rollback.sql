-- Rollback Migration: 20261112000003_granular_rbac_and_inquiries_rollback
-- Description: Revert granular RBAC, settings edit policies, and inquiries policies to baseline

DROP TRIGGER IF EXISTS trg_audit_benefit_types ON public.benefit_types;
DROP FUNCTION IF EXISTS public.fn_audit_benefit_types_mutation();

DROP TRIGGER IF EXISTS trg_audit_system_settings ON public.system_settings;
DROP FUNCTION IF EXISTS public.fn_audit_system_settings_mutation();

DROP POLICY IF EXISTS notifications_dispatch_policy ON public.notifications;
CREATE POLICY "Staff insert notifications" ON public.notifications
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.members m
            WHERE m.user_id = auth.uid()
              AND m.role IN ('admin', 'secretary', 'treasurer', 'manager')
        )
    );

DROP POLICY IF EXISTS benefit_types_write_policy ON public.benefit_types;
CREATE POLICY benefit_types_admin_manage ON public.benefit_types
    FOR ALL TO authenticated
    USING (public.get_current_user_role() IN ('admin', 'manager', 'treasurer', 'official'))
    WITH CHECK (public.get_current_user_role() IN ('admin', 'manager', 'treasurer', 'official'));

DROP POLICY IF EXISTS system_settings_write_policy ON public.system_settings;
CREATE POLICY system_settings_manage ON public.system_settings
    FOR ALL TO authenticated
    USING (public.get_current_user_role() IN ('admin', 'manager', 'treasurer'))
    WITH CHECK (public.get_current_user_role() IN ('admin', 'manager', 'treasurer'));

DROP POLICY IF EXISTS inquiries_update_policy ON public.admin_inquiries;
DROP POLICY IF EXISTS inquiries_select_policy ON public.admin_inquiries;

CREATE POLICY "Staff view inquiries" ON public.admin_inquiries
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.members m
            WHERE m.user_id = auth.uid()
              AND m.role IN ('admin', 'secretary', 'treasurer', 'manager')
        )
        OR sender_id = (SELECT id FROM public.members WHERE user_id = auth.uid())
    );

CREATE POLICY "Staff update inquiries" ON public.admin_inquiries
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.members m
            WHERE m.user_id = auth.uid()
              AND m.role IN ('admin', 'secretary', 'treasurer', 'manager')
        )
    );

DROP POLICY IF EXISTS member_permissions_admin_manage ON public.member_permissions;
DROP POLICY IF EXISTS member_permissions_read ON public.member_permissions;

DROP FUNCTION IF EXISTS public.set_member_abilities(UUID, public.app_ability[]);
DROP FUNCTION IF EXISTS public.get_member_abilities(UUID);
DROP FUNCTION IF EXISTS public.get_my_abilities();
DROP FUNCTION IF EXISTS public.has_ability(public.app_ability);

DROP TABLE IF EXISTS public.member_permissions;
DROP TYPE IF EXISTS public.app_ability;
