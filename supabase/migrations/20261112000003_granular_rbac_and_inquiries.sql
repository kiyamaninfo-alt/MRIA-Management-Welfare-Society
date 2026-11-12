-- Migration: 20261112000003_granular_rbac_and_inquiries
-- Description: Deploy granular ability-based RBAC, section 8 edit gates, inquiry confidentiality, and settings audit triggers.

-- 1. App Ability Enum
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_ability') THEN
        CREATE TYPE public.app_ability AS ENUM (
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
            'dispatch_notifications'
        );
    END IF;
END $$;

-- 2. Member Permissions Junction Table
CREATE TABLE IF NOT EXISTS public.member_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    ability public.app_ability NOT NULL,
    granted_by UUID REFERENCES public.members(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT uq_member_ability UNIQUE (member_id, ability)
);

CREATE INDEX IF NOT EXISTS idx_member_permissions_lookup 
ON public.member_permissions(member_id, ability);

ALTER TABLE public.member_permissions ENABLE ROW LEVEL SECURITY;

-- 3. Core Ability Evaluation Function (Unrestricted for root admin krishaja@gmail.com)
CREATE OR REPLACE FUNCTION public.has_ability(p_ability public.app_ability)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_email TEXT;
BEGIN
    IF current_user = 'postgres' OR session_user = 'postgres' THEN
        RETURN true;
    END IF;

    v_user_email := auth.jwt() ->> 'email';
    
    -- Root administrator unrestricted bypass
    IF v_user_email = 'krishaja@gmail.com' THEN
        RETURN true;
    END IF;

    RETURN EXISTS (
        SELECT 1 
        FROM public.member_permissions mp
        JOIN public.members m ON m.id = mp.member_id
        WHERE m.user_id = auth.uid()
          AND mp.ability = p_ability
          AND m.is_approved = true
          AND m.is_archived = false
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.has_ability(public.app_ability) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_ability(public.app_ability) TO authenticated;

-- 4. Get Current User Abilities RPC
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
            'dispatch_notifications'
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

REVOKE EXECUTE ON FUNCTION public.get_my_abilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_abilities() TO authenticated;

-- 5. Get Target Member Abilities RPC
CREATE OR REPLACE FUNCTION public.get_member_abilities(p_target_member_id UUID)
RETURNS TEXT[] AS $$
DECLARE
    v_caller_email TEXT;
    v_is_authorized BOOLEAN;
    v_abilities TEXT[];
BEGIN
    v_caller_email := auth.jwt() ->> 'email';
    v_is_authorized := (current_user = 'postgres')
                    OR (session_user = 'postgres')
                    OR (v_caller_email = 'krishaja@gmail.com') 
                    OR public.has_ability('assign_roles'::public.app_ability)
                    OR (SELECT user_id FROM public.members WHERE id = p_target_member_id) = auth.uid();
    
    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Access Denied: You do not have permission to view member abilities.';
    END IF;

    SELECT COALESCE(array_agg(ability::TEXT), ARRAY[]::TEXT[])
    INTO v_abilities
    FROM public.member_permissions
    WHERE member_id = p_target_member_id;

    RETURN v_abilities;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.get_member_abilities(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_abilities(UUID) TO authenticated;

-- 6. Set Target Member Abilities RPC (With Audit Logging)
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
    v_caller_email := COALESCE(auth.jwt() ->> 'email', 'root-administrator');

    v_is_authorized := (current_user = 'postgres')
                    OR (session_user = 'postgres')
                    OR (v_caller_email = 'krishaja@gmail.com') 
                    OR public.has_ability('assign_roles'::public.app_ability);
    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Access Denied: You do not have permission to assign member abilities.';
    END IF;

    SELECT id INTO v_caller_member_id FROM public.members WHERE user_id = auth.uid() LIMIT 1;
    IF v_caller_member_id IS NULL THEN
        SELECT id INTO v_caller_member_id FROM public.members WHERE email = 'krishaja@gmail.com' LIMIT 1;
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

REVOKE EXECUTE ON FUNCTION public.set_member_abilities(UUID, public.app_ability[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_abilities(UUID, public.app_ability[]) TO authenticated;

-- 7. Policies for member_permissions table
DROP POLICY IF EXISTS member_permissions_read ON public.member_permissions;
CREATE POLICY member_permissions_read ON public.member_permissions
FOR SELECT TO authenticated
USING (
    (auth.jwt() ->> 'email' = 'krishaja@gmail.com')
    OR public.has_ability('assign_roles'::public.app_ability)
    OR member_id = (SELECT id FROM public.members WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS member_permissions_admin_manage ON public.member_permissions;
CREATE POLICY member_permissions_admin_manage ON public.member_permissions
FOR ALL TO authenticated
USING (
    (auth.jwt() ->> 'email' = 'krishaja@gmail.com')
    OR public.has_ability('assign_roles'::public.app_ability)
)
WITH CHECK (
    (auth.jwt() ->> 'email' = 'krishaja@gmail.com')
    OR public.has_ability('assign_roles'::public.app_ability)
);

-- 8. Hardened Inquiries Confidentiality Policies (Section 8.4 & 8.6)
DROP POLICY IF EXISTS "Staff view inquiries" ON public.admin_inquiries;
DROP POLICY IF EXISTS "Staff update inquiries" ON public.admin_inquiries;
DROP POLICY IF EXISTS inquiries_select_policy ON public.admin_inquiries;
DROP POLICY IF EXISTS inquiries_update_policy ON public.admin_inquiries;

CREATE POLICY inquiries_select_policy ON public.admin_inquiries
FOR SELECT TO authenticated
USING (
    (auth.jwt() ->> 'email' = 'krishaja@gmail.com')
    OR sender_id = (SELECT id FROM public.members WHERE user_id = auth.uid())
    OR public.has_ability('view_respond_inquiries'::public.app_ability)
);

CREATE POLICY inquiries_update_policy ON public.admin_inquiries
FOR UPDATE TO authenticated
USING (
    (auth.jwt() ->> 'email' = 'krishaja@gmail.com')
    OR public.has_ability('view_respond_inquiries'::public.app_ability)
)
WITH CHECK (
    (auth.jwt() ->> 'email' = 'krishaja@gmail.com')
    OR public.has_ability('view_respond_inquiries'::public.app_ability)
);

-- 9. System Settings Edit Policies (Sections 8.1 & 8.2)
DROP POLICY IF EXISTS system_settings_manage ON public.system_settings;
DROP POLICY IF EXISTS system_settings_admin_manage ON public.system_settings;
DROP POLICY IF EXISTS system_settings_write_policy ON public.system_settings;

CREATE POLICY system_settings_write_policy ON public.system_settings
FOR ALL TO authenticated
USING (
    (auth.jwt() ->> 'email' = 'krishaja@gmail.com')
    OR (key IN ('bank_details', 'bank_qr') AND public.has_ability('edit_bank_coordinates'::public.app_ability))
    OR (key IN ('monthly_due_amount', 'admission_fees_list') AND public.has_ability('edit_dues_statutory'::public.app_ability))
    OR public.has_ability('assign_roles'::public.app_ability)
)
WITH CHECK (
    (auth.jwt() ->> 'email' = 'krishaja@gmail.com')
    OR (key IN ('bank_details', 'bank_qr') AND public.has_ability('edit_bank_coordinates'::public.app_ability))
    OR (key IN ('monthly_due_amount', 'admission_fees_list') AND public.has_ability('edit_dues_statutory'::public.app_ability))
    OR public.has_ability('assign_roles'::public.app_ability)
);

-- 10. Benefit Types Policies (Section 8.3)
DROP POLICY IF EXISTS benefit_types_admin_manage ON public.benefit_types;
DROP POLICY IF EXISTS benefit_types_write_policy ON public.benefit_types;

CREATE POLICY benefit_types_write_policy ON public.benefit_types
FOR ALL TO authenticated
USING (
    (auth.jwt() ->> 'email' = 'krishaja@gmail.com')
    OR public.has_ability('edit_welfare_programs'::public.app_ability)
    OR public.has_ability('assign_roles'::public.app_ability)
)
WITH CHECK (
    (auth.jwt() ->> 'email' = 'krishaja@gmail.com')
    OR public.has_ability('edit_welfare_programs'::public.app_ability)
    OR public.has_ability('assign_roles'::public.app_ability)
);

-- 11. Notifications Dispatch Policy (Section 8.5)
DROP POLICY IF EXISTS "Staff insert notifications" ON public.notifications;
DROP POLICY IF EXISTS notifications_dispatch_policy ON public.notifications;

CREATE POLICY notifications_dispatch_policy ON public.notifications
FOR INSERT TO authenticated
WITH CHECK (
    (auth.jwt() ->> 'email' = 'krishaja@gmail.com')
    OR public.has_ability('dispatch_notifications'::public.app_ability)
    OR public.has_ability('assign_roles'::public.app_ability)
);

-- 12. Automated Audit Triggers for Settings & Program Modifications
CREATE OR REPLACE FUNCTION public.fn_audit_system_settings_mutation()
RETURNS TRIGGER AS $$
DECLARE
    v_actor_email TEXT;
BEGIN
    v_actor_email := COALESCE(auth.jwt() ->> 'email', 'SYSTEM');

    IF TG_OP = 'INSERT' THEN
        PERFORM public.fn_record_audit_log(
            'INSERT_SYSTEM_SETTINGS',
            'system_settings',
            NEW.key,
            jsonb_build_object(
                'key', NEW.key,
                'new_value', NEW.value,
                'actor', v_actor_email,
                'timestamp', timezone('utc', now())
            )
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM public.fn_record_audit_log(
            'UPDATE_SYSTEM_SETTINGS',
            'system_settings',
            NEW.key,
            jsonb_build_object(
                'key', NEW.key,
                'old_value', OLD.value,
                'new_value', NEW.value,
                'actor', v_actor_email,
                'timestamp', timezone('utc', now())
            )
        );
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM public.fn_record_audit_log(
            'DELETE_SYSTEM_SETTINGS',
            'system_settings',
            OLD.key,
            jsonb_build_object(
                'key', OLD.key,
                'deleted_value', OLD.value,
                'actor', v_actor_email,
                'timestamp', timezone('utc', now())
            )
        );
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_audit_system_settings ON public.system_settings;
CREATE TRIGGER trg_audit_system_settings
AFTER INSERT OR UPDATE OR DELETE ON public.system_settings
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_system_settings_mutation();

CREATE OR REPLACE FUNCTION public.fn_audit_benefit_types_mutation()
RETURNS TRIGGER AS $$
DECLARE
    v_actor_email TEXT;
BEGIN
    v_actor_email := COALESCE(auth.jwt() ->> 'email', 'SYSTEM');

    IF TG_OP = 'INSERT' THEN
        PERFORM public.fn_record_audit_log(
            'INSERT_BENEFIT_PROGRAM',
            'benefit_types',
            NEW.id::text,
            jsonb_build_object(
                'id', NEW.id,
                'title_en', NEW.title_en,
                'amount', NEW.amount,
                'is_active', NEW.is_active,
                'actor', v_actor_email,
                'timestamp', timezone('utc', now())
            )
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM public.fn_record_audit_log(
            'UPDATE_BENEFIT_PROGRAM',
            'benefit_types',
            NEW.id::text,
            jsonb_build_object(
                'id', NEW.id,
                'old_title', OLD.title_en,
                'new_title', NEW.title_en,
                'old_amount', OLD.amount,
                'new_amount', NEW.amount,
                'old_is_active', OLD.is_active,
                'new_is_active', NEW.is_active,
                'actor', v_actor_email,
                'timestamp', timezone('utc', now())
            )
        );
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM public.fn_record_audit_log(
            'DELETE_BENEFIT_PROGRAM',
            'benefit_types',
            OLD.id::text,
            jsonb_build_object(
                'id', OLD.id,
                'deleted_title', OLD.title_en,
                'actor', v_actor_email,
                'timestamp', timezone('utc', now())
            )
        );
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_audit_benefit_types ON public.benefit_types;
CREATE TRIGGER trg_audit_benefit_types
AFTER INSERT OR UPDATE OR DELETE ON public.benefit_types
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_benefit_types_mutation();
