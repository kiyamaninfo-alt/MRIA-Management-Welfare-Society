-- Migration: 20261108000005_comprehensive_overhaul
-- Description: Comprehensive database overhaul:
--   1. Data migration for committee_member role
--   2. Three-phase member attribute migration (epf_number, designation)
--   3. Privilege escalation guard trigger on members
--   4. Immutable audit trail with statement-level truncate trigger & SYSTEM actor fallback
--   5. Treasury accounts, transactions (with payment_id/claim_id FKs), and automated triggers
--   6. get_treasury_statement function with opening/period/closing balance calculations
--   7. FIFO dues reconciliation updated for AFTER INSERT OR UPDATE
--   8. Updated 6-tier RLS policies and self-registration policy

-- -----------------------------------------------------------------------------
-- 1. UPGRADE LEGACY ROLES
-- -----------------------------------------------------------------------------
UPDATE public.members 
SET role = 'committee_member' 
WHERE role = 'official';

-- -----------------------------------------------------------------------------
-- 2. THREE-PHASE MEMBER ATTRIBUTE MIGRATION
-- -----------------------------------------------------------------------------
-- Phase 2.1: Add columns as nullable
ALTER TABLE public.members 
ADD COLUMN IF NOT EXISTS epf_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS designation VARCHAR(150);

-- Phase 2.2: Backfill existing records
UPDATE public.members
SET 
    role = 'admin',
    is_approved = true,
    epf_number = COALESCE(epf_number, 'EPF-0001'),
    designation = COALESCE(designation, 'System Administrator')
WHERE email = 'krishaja@gmail.com';

UPDATE public.members
SET 
    epf_number = COALESCE(epf_number, 'EPF-' || upper(substring(id::text, 1, 6))),
    designation = COALESCE(designation, 'Airport Staff Member')
WHERE epf_number IS NULL OR designation IS NULL;

-- Phase 2.3: Enforce constraints
ALTER TABLE public.members ALTER COLUMN epf_number SET NOT NULL;
ALTER TABLE public.members ALTER COLUMN designation SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'members_epf_number_unique'
    ) THEN
        ALTER TABLE public.members ADD CONSTRAINT members_epf_number_unique UNIQUE (epf_number);
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. SENSITIVE COLUMN PROTECTION TRIGGER (PREVENT PRIVILEGE ESCALATION)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_protect_member_sensitive_columns()
RETURNS TRIGGER AS $$
DECLARE
    v_caller_role app_role;
BEGIN
    v_caller_role := public.get_current_user_role();

    -- Enforce for authenticated client sessions whose role is not admin, manager, or secretary
    IF auth.uid() IS NOT NULL AND (v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'manager', 'secretary')) THEN
        IF (NEW.role IS DISTINCT FROM OLD.role) OR
           (NEW.is_approved IS DISTINCT FROM OLD.is_approved) OR
           (NEW.is_legacy_member IS DISTINCT FROM OLD.is_legacy_member) OR
           (NEW.epf_number IS DISTINCT FROM OLD.epf_number) THEN
            RAISE EXCEPTION 'Security Violation: Modifying role, approval status, legacy flag, or EPF number is strictly restricted to Administrators and the Secretary.';
        END IF;
    END IF;

    NEW.updated_at = timezone('utc', now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.fn_protect_member_sensitive_columns() FROM authenticated, anon, public;

DROP TRIGGER IF EXISTS trg_members_protect_sensitive_columns ON public.members;
CREATE TRIGGER trg_members_protect_sensitive_columns
BEFORE UPDATE ON public.members
FOR EACH ROW EXECUTE FUNCTION public.fn_protect_member_sensitive_columns();

-- -----------------------------------------------------------------------------
-- 4. IMMUTABLE AUDIT TRAIL SCHEMA & TRIGGERS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    user_email VARCHAR(255) NOT NULL DEFAULT 'SYSTEM',
    full_name VARCHAR(255),
    epf_number VARCHAR(50),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    diff_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Tamper prevention trigger function
CREATE OR REPLACE FUNCTION public.fn_prevent_audit_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Security Violation: audit_logs records are strictly immutable and cannot be updated, deleted, or truncated.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.fn_prevent_audit_tampering() FROM authenticated, anon, public;

-- Row-level immutability trigger
DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_audit_tampering();

-- Statement-level truncate prevention trigger
DROP TRIGGER IF EXISTS trg_audit_logs_prevent_truncate ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_prevent_truncate
BEFORE TRUNCATE ON public.audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION public.fn_prevent_audit_tampering();

-- Audit recording function with safe SYSTEM fallback
CREATE OR REPLACE FUNCTION public.fn_record_audit_log(
    p_action VARCHAR,
    p_entity_type VARCHAR,
    p_entity_id VARCHAR,
    p_diff_json JSONB DEFAULT '{}'::jsonb
) RETURNS VOID AS $$
DECLARE
    v_user_email VARCHAR;
    v_full_name VARCHAR;
    v_epf_number VARCHAR;
BEGIN
    v_user_email := COALESCE(auth.jwt() ->> 'email', 'SYSTEM');
    
    IF v_user_email <> 'SYSTEM' THEN
        SELECT full_name, epf_number INTO v_full_name, v_epf_number
        FROM public.members WHERE email = v_user_email LIMIT 1;

        v_full_name := COALESCE(v_full_name, 'Authenticated User (' || v_user_email || ')');
        v_epf_number := COALESCE(v_epf_number, 'N/A');
    ELSE
        v_full_name := 'Automated System Service';
        v_epf_number := 'SYSTEM';
    END IF;

    INSERT INTO public.audit_logs (
        user_email, full_name, epf_number, action, entity_type, entity_id, diff_json
    ) VALUES (
        v_user_email, v_full_name, v_epf_number, p_action, p_entity_type, p_entity_id, p_diff_json
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.fn_record_audit_log(VARCHAR, VARCHAR, VARCHAR, JSONB) FROM authenticated, anon, public;

-- Audit logs RLS policies
DROP POLICY IF EXISTS audit_logs_admin_manager_read ON public.audit_logs;
CREATE POLICY audit_logs_admin_manager_read ON public.audit_logs
    FOR SELECT TO authenticated
    USING (public.get_current_user_role() IN ('admin', 'manager'));

-- -----------------------------------------------------------------------------
-- 5. TREASURY ASSET SEGREGATION SCHEMA & AUTOMATION
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'treasury_tx_type') THEN
        CREATE TYPE public.treasury_tx_type AS ENUM ('inflow', 'outflow', 'transfer');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.treasury_accounts (
    id VARCHAR(50) PRIMARY KEY, -- 'boc_savings', 'cash_in_hand', 'fixed_deposits'
    account_name VARCHAR(100) NOT NULL,
    account_number VARCHAR(100),
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.treasury_accounts ENABLE ROW LEVEL SECURITY;

-- Initial Accounts Seeding
INSERT INTO public.treasury_accounts (id, account_name, account_number, description) VALUES
('boc_savings', 'Bank of Ceylon Operating Savings', 'BOC-HAM-8839201', 'Primary association operational bank account'),
('cash_in_hand', 'Treasurer Physical Cash Float', NULL, 'Physical cash collected at airport desk awaiting bank deposit'),
('fixed_deposits', 'BOC Fixed Deposit Capital Reserve', 'BOC-FD-0029104', 'Long-term interest-bearing emergency welfare reserve')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.treasury_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    transaction_type public.treasury_tx_type NOT NULL,
    source_account_id VARCHAR(50) REFERENCES public.treasury_accounts(id),
    destination_account_id VARCHAR(50) REFERENCES public.treasury_accounts(id),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    reference_no VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    claim_id UUID REFERENCES public.benefit_claims(id) ON DELETE SET NULL,
    recorded_by UUID NOT NULL REFERENCES public.members(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT chk_treasury_accounts_validity CHECK (
        (transaction_type = 'inflow' AND destination_account_id IS NOT NULL AND source_account_id IS NULL) OR
        (transaction_type = 'outflow' AND source_account_id IS NOT NULL AND destination_account_id IS NULL) OR
        (transaction_type = 'transfer' AND source_account_id IS NOT NULL AND destination_account_id IS NOT NULL AND source_account_id <> destination_account_id)
    )
);

ALTER TABLE public.treasury_transactions ENABLE ROW LEVEL SECURITY;

-- Real-Time Balance Summary View
CREATE OR REPLACE VIEW public.treasury_account_balances 
WITH (security_invoker = true) AS
SELECT 
    acc.id AS account_id,
    acc.account_name,
    COALESCE(SUM(
        CASE 
            WHEN tx.destination_account_id = acc.id THEN tx.amount 
            WHEN tx.source_account_id = acc.id THEN -tx.amount 
            ELSE 0 
        END
    ), 0.00) AS current_balance
FROM public.treasury_accounts acc
LEFT JOIN public.treasury_transactions tx 
    ON acc.id = tx.source_account_id OR acc.id = tx.destination_account_id
GROUP BY acc.id, acc.account_name;

-- Automated Inflow Synchronization Trigger (Bank Slip & Cash Intake)
CREATE OR REPLACE FUNCTION public.fn_sync_payment_to_treasury()
RETURNS TRIGGER AS $$
DECLARE
    v_target_account VARCHAR(50);
    v_recorder UUID;
BEGIN
    IF (NEW.status = 'verified' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'verified')) THEN
        -- Route cash to 'cash_in_hand', bank transfer to 'boc_savings'
        v_target_account := CASE WHEN NEW.payment_method = 'cash' THEN 'cash_in_hand' ELSE 'boc_savings' END;
        v_recorder := COALESCE(NEW.verified_by, NEW.member_id);

        -- Insert automated inflow if not already recorded
        IF NOT EXISTS (SELECT 1 FROM public.treasury_transactions WHERE payment_id = NEW.id) THEN
            INSERT INTO public.treasury_transactions (
                transaction_date,
                transaction_type,
                destination_account_id,
                amount,
                reference_no,
                description,
                payment_id,
                recorded_by
            ) VALUES (
                COALESCE(NEW.verified_at::date, CURRENT_DATE),
                'inflow',
                v_target_account,
                NEW.amount,
                'PAY-' || upper(substring(NEW.id::text, 1, 8)),
                'Automated Dues Inflow (' || NEW.payment_method::text || ')',
                NEW.id,
                v_recorder
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.fn_sync_payment_to_treasury() FROM authenticated, anon, public;

DROP TRIGGER IF EXISTS trg_payments_sync_to_treasury ON public.payments;
CREATE TRIGGER trg_payments_sync_to_treasury
AFTER INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_payment_to_treasury();

-- Automated Outflow Synchronization Trigger (Disbursed Claims)
CREATE OR REPLACE FUNCTION public.fn_sync_claim_disbursement_to_treasury()
RETURNS TRIGGER AS $$
DECLARE
    v_recorder UUID;
    v_amount NUMERIC(12, 2);
BEGIN
    IF (NEW.status = 'disbursed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'disbursed')) THEN
        IF NOT EXISTS (SELECT 1 FROM public.treasury_transactions WHERE claim_id = NEW.id) THEN
            v_recorder := COALESCE(NEW.disbursed_by, NEW.approved_by, NEW.member_id);
            v_amount := COALESCE(NEW.disbursed_amount, NEW.claim_amount);

            IF v_amount > 0 THEN
                INSERT INTO public.treasury_transactions (
                    transaction_date,
                    transaction_type,
                    source_account_id,
                    amount,
                    reference_no,
                    description,
                    claim_id,
                    recorded_by
                ) VALUES (
                    COALESCE(NEW.disbursed_at::date, CURRENT_DATE),
                    'outflow',
                    'boc_savings',
                    v_amount,
                    'CLM-' || upper(substring(NEW.id::text, 1, 8)),
                    'Disbursed Welfare Aid Grant',
                    NEW.id,
                    v_recorder
                );
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.fn_sync_claim_disbursement_to_treasury() FROM authenticated, anon, public;

DROP TRIGGER IF EXISTS trg_claims_sync_to_treasury ON public.benefit_claims;
CREATE TRIGGER trg_claims_sync_to_treasury
AFTER INSERT OR UPDATE ON public.benefit_claims
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_claim_disbursement_to_treasury();

-- -----------------------------------------------------------------------------
-- 6. TREASURY STATEMENT REPORTING RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_treasury_statement(
    p_start_date DATE,
    p_end_date DATE
)
RETURNS JSONB AS $$
DECLARE
    v_opening_balances JSONB;
    v_period_movements JSONB;
    v_closing_balances JSONB;
    v_transactions JSONB;
BEGIN
    -- 1. Calculate opening balance before p_start_date for all accounts
    SELECT COALESCE(jsonb_object_agg(account_id, balance), '{}'::jsonb)
    INTO v_opening_balances
    FROM (
        SELECT 
            acc.id AS account_id,
            COALESCE(SUM(
                CASE 
                    WHEN tx.destination_account_id = acc.id THEN tx.amount 
                    WHEN tx.source_account_id = acc.id THEN -tx.amount 
                    ELSE 0 
                END
            ), 0.00) AS balance
        FROM public.treasury_accounts acc
        LEFT JOIN public.treasury_transactions tx 
            ON (acc.id = tx.source_account_id OR acc.id = tx.destination_account_id)
            AND tx.transaction_date < p_start_date
        GROUP BY acc.id
    ) s;

    -- 2. Calculate net movement during [p_start_date, p_end_date] for all accounts
    SELECT COALESCE(jsonb_object_agg(account_id, balance), '{}'::jsonb)
    INTO v_period_movements
    FROM (
        SELECT 
            acc.id AS account_id,
            COALESCE(SUM(
                CASE 
                    WHEN tx.destination_account_id = acc.id THEN tx.amount 
                    WHEN tx.source_account_id = acc.id THEN -tx.amount 
                    ELSE 0 
                END
            ), 0.00) AS balance
        FROM public.treasury_accounts acc
        LEFT JOIN public.treasury_transactions tx 
            ON (acc.id = tx.source_account_id OR acc.id = tx.destination_account_id)
            AND tx.transaction_date BETWEEN p_start_date AND p_end_date
        GROUP BY acc.id
    ) s;

    -- 3. Calculate closing balance up to and including p_end_date for all accounts
    SELECT COALESCE(jsonb_object_agg(account_id, balance), '{}'::jsonb)
    INTO v_closing_balances
    FROM (
        SELECT 
            acc.id AS account_id,
            COALESCE(SUM(
                CASE 
                    WHEN tx.destination_account_id = acc.id THEN tx.amount 
                    WHEN tx.source_account_id = acc.id THEN -tx.amount 
                    ELSE 0 
                END
            ), 0.00) AS balance
        FROM public.treasury_accounts acc
        LEFT JOIN public.treasury_transactions tx 
            ON (acc.id = tx.source_account_id OR acc.id = tx.destination_account_id)
            AND tx.transaction_date <= p_end_date
        GROUP BY acc.id
    ) s;

    -- 4. Retrieve transaction items within period
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', tx.id,
        'transaction_date', tx.transaction_date,
        'transaction_type', tx.transaction_type,
        'source_account_id', tx.source_account_id,
        'destination_account_id', tx.destination_account_id,
        'amount', tx.amount,
        'reference_no', tx.reference_no,
        'description', tx.description,
        'payment_id', tx.payment_id,
        'claim_id', tx.claim_id,
        'recorded_by', tx.recorded_by,
        'created_at', tx.created_at
    ) ORDER BY tx.transaction_date ASC, tx.created_at ASC), '[]'::jsonb)
    INTO v_transactions
    FROM public.treasury_transactions tx
    WHERE tx.transaction_date BETWEEN p_start_date AND p_end_date;

    RETURN jsonb_build_object(
        'start_date', p_start_date,
        'end_date', p_end_date,
        'opening_balances', v_opening_balances,
        'period_movements', v_period_movements,
        'closing_balances', v_closing_balances,
        'transactions', v_transactions
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.get_treasury_statement(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_treasury_statement(DATE, DATE) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. UPDATE FIFO CASH PAYMENT DUES RECONCILIATION TRIGGER (AFTER INSERT OR UPDATE)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_verified_payment()
RETURNS TRIGGER AS $$
DECLARE
    remaining_funds NUMERIC(10, 2) := NEW.amount;
    due_record RECORD;
    alloc_amount NUMERIC(10, 2);
BEGIN
    -- Execute on INSERT with status 'verified', or UPDATE where status transitioned to 'verified'
    IF NEW.status = 'verified' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'verified') AND NEW.payment_type = 'monthly_due' THEN
        -- Loop through unpaid dues chronologically (FIFO)
        FOR due_record IN 
            SELECT id, amount 
            FROM public.member_dues 
            WHERE member_id = NEW.member_id AND status = 'pending'
            ORDER BY billing_month ASC
        LOOP
            EXIT WHEN remaining_funds <= 0;

            IF remaining_funds >= due_record.amount THEN
                alloc_amount := due_record.amount;
                UPDATE public.member_dues SET status = 'paid', updated_at = now() WHERE id = due_record.id;
            ELSE
                alloc_amount := remaining_funds;
            END IF;

            INSERT INTO public.payment_dues_reconciliation (payment_id, due_id, allocated_amount)
            VALUES (NEW.id, due_record.id, alloc_amount);

            remaining_funds := remaining_funds - alloc_amount;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.reconcile_verified_payment() FROM authenticated, anon, public;

DROP TRIGGER IF EXISTS on_payment_verified_reconcile ON public.payments;
CREATE TRIGGER on_payment_verified_reconcile
AFTER INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.reconcile_verified_payment();

-- -----------------------------------------------------------------------------
-- 8. GRANULAR 6-TIER RLS POLICIES & SELF-REGISTRATION
-- -----------------------------------------------------------------------------
-- 8.1 Members Policies
DROP POLICY IF EXISTS members_self_registration_insert ON public.members;
CREATE POLICY members_self_registration_insert ON public.members
FOR INSERT TO authenticated
WITH CHECK (
    auth.uid() = user_id AND 
    role = 'member'::app_role AND 
    is_approved = false AND 
    is_legacy_member = false
);

DROP POLICY IF EXISTS members_self_update ON public.members;
CREATE POLICY members_self_update ON public.members
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS members_admin_manager_all ON public.members;
DROP POLICY IF EXISTS members_secretary_manage ON public.members;
CREATE POLICY members_secretary_manage ON public.members
FOR ALL TO authenticated
USING (public.get_current_user_role() IN ('admin', 'manager', 'secretary'))
WITH CHECK (public.get_current_user_role() IN ('admin', 'manager', 'secretary'));

DROP POLICY IF EXISTS members_staff_read ON public.members;
CREATE POLICY members_staff_read ON public.members
FOR SELECT TO authenticated
USING (public.get_current_user_role() IN ('treasurer', 'committee_member', 'official'));

-- 8.2 Treasury Accounts Policies
DROP POLICY IF EXISTS treasury_accounts_read_all ON public.treasury_accounts;
CREATE POLICY treasury_accounts_read_all ON public.treasury_accounts
FOR SELECT TO authenticated
USING (public.get_current_user_role() IN ('admin', 'manager', 'treasurer', 'secretary', 'committee_member', 'official'));

DROP POLICY IF EXISTS treasury_accounts_admin_manage ON public.treasury_accounts;
CREATE POLICY treasury_accounts_admin_manage ON public.treasury_accounts
FOR ALL TO authenticated
USING (public.get_current_user_role() IN ('admin', 'treasurer'))
WITH CHECK (public.get_current_user_role() IN ('admin', 'treasurer'));

-- 8.3 Treasury Transactions Policies
DROP POLICY IF EXISTS treasury_transactions_read_staff ON public.treasury_transactions;
CREATE POLICY treasury_transactions_read_staff ON public.treasury_transactions
FOR SELECT TO authenticated
USING (public.get_current_user_role() IN ('admin', 'manager', 'treasurer', 'secretary', 'committee_member', 'official'));

DROP POLICY IF EXISTS treasury_transactions_treasurer_admin_write ON public.treasury_transactions;
CREATE POLICY treasury_transactions_treasurer_admin_write ON public.treasury_transactions
FOR INSERT TO authenticated
WITH CHECK (public.get_current_user_role() IN ('admin', 'treasurer'));

DROP POLICY IF EXISTS treasury_transactions_admin_all ON public.treasury_transactions;
CREATE POLICY treasury_transactions_admin_all ON public.treasury_transactions
FOR ALL TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

-- 8.4 Payments Policies (Include secretary & committee_member)
DROP POLICY IF EXISTS payments_staff_read ON public.payments;
CREATE POLICY payments_staff_read ON public.payments
FOR SELECT TO authenticated
USING (public.get_current_user_role() IN ('manager', 'secretary', 'committee_member', 'official'));

-- 8.5 Member Dues Policies (Include secretary & committee_member)
DROP POLICY IF EXISTS member_dues_staff_manage ON public.member_dues;
CREATE POLICY member_dues_staff_manage ON public.member_dues
FOR ALL TO authenticated
USING (public.get_current_user_role() IN ('admin', 'manager', 'treasurer', 'secretary', 'committee_member', 'official'))
WITH CHECK (public.get_current_user_role() IN ('admin', 'manager', 'treasurer'));

-- 8.6 Benefit Claims Policies (Include secretary & committee_member)
DROP POLICY IF EXISTS benefit_claims_staff_manage ON public.benefit_claims;
CREATE POLICY benefit_claims_staff_manage ON public.benefit_claims
FOR ALL TO authenticated
USING (public.get_current_user_role() IN ('admin', 'manager', 'treasurer', 'secretary', 'committee_member', 'official'))
WITH CHECK (public.get_current_user_role() IN ('admin', 'manager', 'treasurer'));

-- -----------------------------------------------------------------------------
-- 9. DEFAULTERS ROSTER VIEW SECURITY ENHANCEMENT
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.defaulters_roster 
WITH (security_invoker = true) AS
SELECT 
    m.id AS member_id,
    m.full_name,
    m.phone,
    m.email,
    d.id AS due_id,
    d.billing_month,
    d.amount,
    d.status
FROM public.members m
JOIN public.member_dues d ON d.member_id = m.id
WHERE d.status = 'pending'
  AND d.billing_month < date_trunc('month', TIMEZONE('Asia/Colombo', now()))::DATE;
