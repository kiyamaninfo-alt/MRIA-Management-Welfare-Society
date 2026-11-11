-- Rollback Migration: 20261112000001_comprehensive_foreign_key_and_query_indexes_rollback.sql
-- Description: Cleanly drops all foreign key and query performance indexes created in 20261112000001.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. Payments
DROP INDEX IF EXISTS public.idx_payments_member_created;
DROP INDEX IF EXISTS public.idx_payments_verified_by;
DROP INDEX IF EXISTS public.idx_payments_status_created;
DROP INDEX IF EXISTS public.idx_payments_pending_created;

-- 2. Payment Dues Reconciliation
DROP INDEX IF EXISTS public.idx_payment_dues_reconciliation_payment_id;
DROP INDEX IF EXISTS public.idx_payment_dues_reconciliation_due_id;

-- 3. Treasury Transactions
DROP INDEX IF EXISTS public.idx_treasury_transactions_claim_id;
DROP INDEX IF EXISTS public.idx_treasury_transactions_payment_id;
DROP INDEX IF EXISTS public.idx_treasury_transactions_source_account;
DROP INDEX IF EXISTS public.idx_treasury_transactions_destination_account;
DROP INDEX IF EXISTS public.idx_treasury_transactions_recorded_by;
DROP INDEX IF EXISTS public.idx_treasury_transactions_date_created;

-- 4. Notifications
DROP INDEX IF EXISTS public.idx_notifications_recipient_created;

-- 5. Benefit Claims
DROP INDEX IF EXISTS public.idx_benefit_claims_member_created;
DROP INDEX IF EXISTS public.idx_benefit_claims_benefit_type_id;
DROP INDEX IF EXISTS public.idx_benefit_claims_approved_by;
DROP INDEX IF EXISTS public.idx_benefit_claims_disbursed_by;

-- 6. Member Dues
DROP INDEX IF EXISTS public.idx_member_dues_pending_billing;

-- 7. Audit Logs
DROP INDEX IF EXISTS public.idx_audit_logs_timestamp;
DROP INDEX IF EXISTS public.idx_audit_logs_entity;

-- 8. Auxiliary Tables
DROP INDEX IF EXISTS public.idx_admin_inquiries_sender_id;
DROP INDEX IF EXISTS public.idx_admin_inquiries_resolved_by;
DROP INDEX IF EXISTS public.idx_announcements_created_by;
DROP INDEX IF EXISTS public.idx_system_settings_updated_by;

COMMIT;
