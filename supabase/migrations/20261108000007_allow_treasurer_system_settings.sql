-- Migration: 20261108000007_allow_treasurer_system_settings
-- Description: Expand system_settings management permission to admin, manager, and treasurer

DROP POLICY IF EXISTS system_settings_admin_manage ON public.system_settings;
DROP POLICY IF EXISTS system_settings_manage ON public.system_settings;

CREATE POLICY system_settings_manage ON public.system_settings
FOR ALL TO authenticated
USING (public.get_current_user_role() IN ('admin', 'manager', 'treasurer'))
WITH CHECK (public.get_current_user_role() IN ('admin', 'manager', 'treasurer'));
