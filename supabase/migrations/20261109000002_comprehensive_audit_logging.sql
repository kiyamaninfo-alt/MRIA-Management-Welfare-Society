-- Migration: 20261109000002_comprehensive_audit_logging.sql
-- Description: Uneditable activity logging RPC and triggers for login, logout, payments, requests, messages, member changes, settings, benefit types, and treasury actions.

-- 1. Ensure public.audit_logs is strictly immutable
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fn_prevent_audit_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Security Violation: audit_logs records are strictly immutable and cannot be updated, deleted, or truncated.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_audit_tampering();

DROP TRIGGER IF EXISTS trg_audit_logs_prevent_truncate ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_prevent_truncate
BEFORE TRUNCATE ON public.audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION public.fn_prevent_audit_tampering();

-- 2. Create the unified RPC function for logging user and system activities
CREATE OR REPLACE FUNCTION public.log_user_activity(
    p_action TEXT,
    p_entity_type TEXT DEFAULT 'USER_EVENT',
    p_entity_id TEXT DEFAULT '',
    p_details JSONB DEFAULT '{}'::jsonb,
    p_actor_email TEXT DEFAULT NULL,
    p_actor_name TEXT DEFAULT NULL,
    p_epf_number TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_user_email VARCHAR(255);
    v_full_name VARCHAR(255);
    v_epf_number VARCHAR(50);
    v_new_id UUID;
BEGIN
    v_user_email := COALESCE(auth.jwt() ->> 'email', NULLIF(p_actor_email, ''), 'ANONYMOUS');

    IF v_user_email <> 'ANONYMOUS' THEN
        SELECT full_name, epf_number INTO v_full_name, v_epf_number
        FROM public.members WHERE email = v_user_email LIMIT 1;
    END IF;

    v_full_name := COALESCE(v_full_name, NULLIF(p_actor_name, ''), 'User (' || v_user_email || ')');
    v_epf_number := COALESCE(v_epf_number, NULLIF(p_epf_number, ''), 'N/A');

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
        v_user_email,
        v_full_name,
        v_epf_number,
        p_action,
        p_entity_type,
        COALESCE(p_entity_id, ''),
        COALESCE(p_details, '{}'::jsonb)
    ) RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.log_user_activity(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) TO authenticated, anon;

-- 3. Automated Database Trigger on Payments
CREATE OR REPLACE FUNCTION public.fn_audit_payments()
RETURNS TRIGGER AS $$
DECLARE
    v_actor_email VARCHAR(255);
    v_actor_name VARCHAR(255);
    v_epf VARCHAR(50);
    v_action VARCHAR(100);
BEGIN
    v_actor_email := COALESCE(auth.jwt() ->> 'email', 'SYSTEM');
    
    SELECT full_name, epf_number INTO v_actor_name, v_epf
    FROM public.members WHERE email = v_actor_email LIMIT 1;

    IF (TG_OP = 'INSERT') THEN
        v_action := CASE 
            WHEN NEW.payment_method = 'cash' THEN 'CASH_PAYMENT_SUBMITTED' 
            ELSE 'PAYMENT_SLIP_SUBMITTED' 
        END;

        INSERT INTO public.audit_logs (timestamp, user_email, full_name, epf_number, action, entity_type, entity_id, diff_json)
        VALUES (
            timezone('utc', now()),
            v_actor_email,
            COALESCE(v_actor_name, 'Staff Officer'),
            COALESCE(v_epf, 'N/A'),
            v_action,
            'payments',
            NEW.id::text,
            jsonb_build_object(
                'amount', NEW.amount,
                'payment_type', NEW.payment_type,
                'method', NEW.payment_method,
                'status', NEW.status,
                'member_id', NEW.member_id,
                'notes', NEW.notes
            )
        );
    ELSIF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
        v_action := 'PAYMENT_STATUS_' || UPPER(NEW.status::text);

        INSERT INTO public.audit_logs (timestamp, user_email, full_name, epf_number, action, entity_type, entity_id, diff_json)
        VALUES (
            timezone('utc', now()),
            v_actor_email,
            COALESCE(v_actor_name, 'Staff Officer'),
            COALESCE(v_epf, 'N/A'),
            v_action,
            'payments',
            NEW.id::text,
            jsonb_build_object(
                'old_status', OLD.status,
                'new_status', NEW.status,
                'amount', NEW.amount,
                'member_id', NEW.member_id,
                'verified_by', NEW.verified_by
            )
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_audit_payments ON public.payments;
CREATE TRIGGER trg_audit_payments
AFTER INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_payments();

-- 4. Automated Database Trigger on Welfare Benefit Claims
CREATE OR REPLACE FUNCTION public.fn_audit_benefit_claims()
RETURNS TRIGGER AS $$
DECLARE
    v_actor_email VARCHAR(255);
    v_actor_name VARCHAR(255);
    v_epf VARCHAR(50);
    v_action VARCHAR(100);
BEGIN
    v_actor_email := COALESCE(auth.jwt() ->> 'email', 'SYSTEM');
    
    SELECT full_name, epf_number INTO v_actor_name, v_epf
    FROM public.members WHERE email = v_actor_email LIMIT 1;

    IF (TG_OP = 'INSERT') THEN
        INSERT INTO public.audit_logs (timestamp, user_email, full_name, epf_number, action, entity_type, entity_id, diff_json)
        VALUES (
            timezone('utc', now()),
            v_actor_email,
            COALESCE(v_actor_name, 'Member'),
            COALESCE(v_epf, 'N/A'),
            'CLAIM_REQUEST_SUBMITTED',
            'benefit_claims',
            NEW.id::text,
            jsonb_build_object(
                'claim_amount', NEW.claim_amount,
                'benefit_type_id', NEW.benefit_type_id,
                'status', NEW.status,
                'notes', NEW.notes
            )
        );
    ELSIF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
        v_action := 'CLAIM_STATUS_' || UPPER(NEW.status::text);

        INSERT INTO public.audit_logs (timestamp, user_email, full_name, epf_number, action, entity_type, entity_id, diff_json)
        VALUES (
            timezone('utc', now()),
            v_actor_email,
            COALESCE(v_actor_name, 'Committee Official'),
            COALESCE(v_epf, 'N/A'),
            v_action,
            'benefit_claims',
            NEW.id::text,
            jsonb_build_object(
                'old_status', OLD.status,
                'new_status', NEW.status,
                'claim_amount', NEW.claim_amount,
                'disbursed_amount', NEW.disbursed_amount
            )
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_audit_benefit_claims ON public.benefit_claims;
CREATE TRIGGER trg_audit_benefit_claims
AFTER INSERT OR UPDATE ON public.benefit_claims
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_benefit_claims();

-- 5. Automated Database Trigger on Members
CREATE OR REPLACE FUNCTION public.fn_audit_members()
RETURNS TRIGGER AS $$
DECLARE
    v_actor_email VARCHAR(255);
    v_actor_name VARCHAR(255);
    v_epf VARCHAR(50);
BEGIN
    v_actor_email := COALESCE(auth.jwt() ->> 'email', 'SYSTEM');
    SELECT full_name, epf_number INTO v_actor_name, v_epf
    FROM public.members WHERE email = v_actor_email LIMIT 1;

    IF (TG_OP = 'INSERT') THEN
        INSERT INTO public.audit_logs (timestamp, user_email, full_name, epf_number, action, entity_type, entity_id, diff_json)
        VALUES (
            timezone('utc', now()),
            v_actor_email,
            COALESCE(v_actor_name, 'System/Admin'),
            COALESCE(v_epf, 'N/A'),
            'MEMBER_RECORD_CREATED',
            'members',
            NEW.id::text,
            jsonb_build_object(
                'email', NEW.email,
                'full_name', NEW.full_name,
                'epf_number', NEW.epf_number,
                'role', NEW.role,
                'is_approved', NEW.is_approved
            )
        );
    ELSIF (TG_OP = 'UPDATE') THEN
        IF OLD.is_approved IS DISTINCT FROM NEW.is_approved THEN
            INSERT INTO public.audit_logs (timestamp, user_email, full_name, epf_number, action, entity_type, entity_id, diff_json)
            VALUES (
                timezone('utc', now()),
                v_actor_email,
                COALESCE(v_actor_name, 'Admin'),
                COALESCE(v_epf, 'N/A'),
                CASE WHEN NEW.is_approved THEN 'MEMBER_APPROVED' ELSE 'MEMBER_SUSPENDED' END,
                'members',
                NEW.id::text,
                jsonb_build_object(
                    'target_email', NEW.email,
                    'target_name', NEW.full_name,
                    'old_approved', OLD.is_approved,
                    'new_approved', NEW.is_approved
                )
            );
        END IF;

        IF OLD.role IS DISTINCT FROM NEW.role THEN
            INSERT INTO public.audit_logs (timestamp, user_email, full_name, epf_number, action, entity_type, entity_id, diff_json)
            VALUES (
                timezone('utc', now()),
                v_actor_email,
                COALESCE(v_actor_name, 'Admin'),
                COALESCE(v_epf, 'N/A'),
                'MEMBER_ROLE_CHANGED',
                'members',
                NEW.id::text,
                jsonb_build_object(
                    'target_email', NEW.email,
                    'old_role', OLD.role,
                    'new_role', NEW.role
                )
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_audit_members ON public.members;
CREATE TRIGGER trg_audit_members
AFTER INSERT OR UPDATE ON public.members
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_members();

-- 6. Automated Database Trigger on System Settings
CREATE OR REPLACE FUNCTION public.fn_audit_system_settings()
RETURNS TRIGGER AS $$
DECLARE
    v_actor_email VARCHAR(255);
    v_actor_name VARCHAR(255);
    v_epf VARCHAR(50);
BEGIN
    v_actor_email := COALESCE(auth.jwt() ->> 'email', 'SYSTEM');
    SELECT full_name, epf_number INTO v_actor_name, v_epf
    FROM public.members WHERE email = v_actor_email LIMIT 1;

    IF (TG_OP = 'UPDATE' AND OLD.value IS DISTINCT FROM NEW.value) THEN
        INSERT INTO public.audit_logs (timestamp, user_email, full_name, epf_number, action, entity_type, entity_id, diff_json)
        VALUES (
            timezone('utc', now()),
            v_actor_email,
            COALESCE(v_actor_name, 'Admin'),
            COALESCE(v_epf, 'N/A'),
            'SETTING_UPDATED',
            'system_settings',
            NEW.key,
            jsonb_build_object(
                'key', NEW.key,
                'old_value', OLD.value,
                'new_value', NEW.value,
                'description', NEW.description
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_audit_system_settings ON public.system_settings;
CREATE TRIGGER trg_audit_system_settings
AFTER UPDATE ON public.system_settings
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_system_settings();

-- 7. Automated Database Trigger on Benefit Types (Welfare Programs)
CREATE OR REPLACE FUNCTION public.fn_audit_benefit_types()
RETURNS TRIGGER AS $$
DECLARE
    v_actor_email VARCHAR(255);
    v_actor_name VARCHAR(255);
    v_epf VARCHAR(50);
BEGIN
    v_actor_email := COALESCE(auth.jwt() ->> 'email', 'SYSTEM');
    SELECT full_name, epf_number INTO v_actor_name, v_epf
    FROM public.members WHERE email = v_actor_email LIMIT 1;

    IF (TG_OP = 'INSERT') THEN
        INSERT INTO public.audit_logs (timestamp, user_email, full_name, epf_number, action, entity_type, entity_id, diff_json)
        VALUES (
            timezone('utc', now()),
            v_actor_email,
            COALESCE(v_actor_name, 'Admin'),
            COALESCE(v_epf, 'N/A'),
            'BENEFIT_PROGRAM_CREATED',
            'benefit_types',
            NEW.id::text,
            jsonb_build_object(
                'title_en', NEW.title_en,
                'title_si', NEW.title_si,
                'amount', NEW.default_amount,
                'is_active', NEW.is_active
            )
        );
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO public.audit_logs (timestamp, user_email, full_name, epf_number, action, entity_type, entity_id, diff_json)
        VALUES (
            timezone('utc', now()),
            v_actor_email,
            COALESCE(v_actor_name, 'Admin'),
            COALESCE(v_epf, 'N/A'),
            'BENEFIT_PROGRAM_UPDATED',
            'benefit_types',
            NEW.id::text,
            jsonb_build_object(
                'title_en', NEW.title_en,
                'old_amount', OLD.default_amount,
                'new_amount', NEW.default_amount,
                'old_is_active', OLD.is_active,
                'new_is_active', NEW.is_active
            )
        );
    ELSIF (TG_OP = 'DELETE') THEN
        INSERT INTO public.audit_logs (timestamp, user_email, full_name, epf_number, action, entity_type, entity_id, diff_json)
        VALUES (
            timezone('utc', now()),
            v_actor_email,
            COALESCE(v_actor_name, 'Admin'),
            COALESCE(v_epf, 'N/A'),
            'BENEFIT_PROGRAM_DELETED',
            'benefit_types',
            OLD.id::text,
            jsonb_build_object(
                'title_en', OLD.title_en,
                'default_amount', OLD.default_amount
            )
        );
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_audit_benefit_types ON public.benefit_types;
CREATE TRIGGER trg_audit_benefit_types
AFTER INSERT OR UPDATE OR DELETE ON public.benefit_types
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_benefit_types();

-- 8. Automated Database Trigger on Treasury Transactions
CREATE OR REPLACE FUNCTION public.fn_audit_treasury_tx()
RETURNS TRIGGER AS $$
DECLARE
    v_actor_email VARCHAR(255);
    v_actor_name VARCHAR(255);
    v_epf VARCHAR(50);
BEGIN
    v_actor_email := COALESCE(auth.jwt() ->> 'email', 'SYSTEM');
    SELECT full_name, epf_number INTO v_actor_name, v_epf
    FROM public.members WHERE email = v_actor_email LIMIT 1;

    IF (TG_OP = 'INSERT') THEN
        INSERT INTO public.audit_logs (timestamp, user_email, full_name, epf_number, action, entity_type, entity_id, diff_json)
        VALUES (
            timezone('utc', now()),
            v_actor_email,
            COALESCE(v_actor_name, 'Treasurer'),
            COALESCE(v_epf, 'N/A'),
            'TREASURY_TRANSACTION_RECORDED',
            'treasury_transactions',
            NEW.id::text,
            jsonb_build_object(
                'source_account_id', NEW.source_account_id,
                'destination_account_id', NEW.destination_account_id,
                'transaction_type', NEW.transaction_type,
                'amount', NEW.amount,
                'reference_no', NEW.reference_no,
                'description', NEW.description
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_audit_treasury_tx ON public.treasury_transactions;
CREATE TRIGGER trg_audit_treasury_tx
AFTER INSERT ON public.treasury_transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_treasury_tx();
