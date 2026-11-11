-- Migration: 20261112000001_comprehensive_foreign_key_and_query_indexes.sql
-- Description: Complete B-Tree indexing on all 18 unindexed foreign keys and hot application query access paths.
-- Silences Supabase Database Performance Advisor 0001 warnings, eliminates sequential table scans,
-- prevents parent delete/update lock convoys, and optimizes RLS evaluations.

BEGIN;

-- Lock and statement timeouts to fail fast if concurrent transactions hold locks
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ============================================================================
-- 1. PAYMENTS INDEXES
-- ============================================================================
-- Covers FK: payments_member_id_fkey & accelerates getMemberPayments()
CREATE INDEX IF NOT EXISTS idx_payments_member_created 
ON public.payments (member_id, created_at DESC);

-- Covers FK: payments_verified_by_fkey
CREATE INDEX IF NOT EXISTS idx_payments_verified_by 
ON public.payments (verified_by);

-- Accelerates admin receipts ledger: getPaymentReceipts()
CREATE INDEX IF NOT EXISTS idx_payments_status_created 
ON public.payments (status, created_at DESC);

-- Partial index for pending slip approval queue: getPendingPayments()
CREATE INDEX IF NOT EXISTS idx_payments_pending_created 
ON public.payments (created_at DESC) 
WHERE status = 'pending_approval';

-- ============================================================================
-- 2. PAYMENT DUES RECONCILIATION INDEXES
-- ============================================================================
-- Covers FK: payment_dues_reconciliation_payment_id_fkey
CREATE INDEX IF NOT EXISTS idx_payment_dues_reconciliation_payment_id 
ON public.payment_dues_reconciliation (payment_id);

-- Covers FK: payment_dues_reconciliation_due_id_fkey
CREATE INDEX IF NOT EXISTS idx_payment_dues_reconciliation_due_id 
ON public.payment_dues_reconciliation (due_id);

-- ============================================================================
-- 3. TREASURY TRANSACTIONS INDEXES
-- ============================================================================
-- Covers FK: treasury_transactions_claim_id_fkey
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_claim_id 
ON public.treasury_transactions (claim_id);

-- Covers FK: treasury_transactions_payment_id_fkey
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_payment_id 
ON public.treasury_transactions (payment_id);

-- Covers FK: treasury_transactions_source_account_id_fkey
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_source_account 
ON public.treasury_transactions (source_account_id);

-- Covers FK: treasury_transactions_destination_account_id_fkey
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_destination_account 
ON public.treasury_transactions (destination_account_id);

-- Covers FK: treasury_transactions_recorded_by_fkey
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_recorded_by 
ON public.treasury_transactions (recorded_by);

-- Accelerates cashbook queries: getTreasuryTransactions()
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_date_created 
ON public.treasury_transactions (transaction_date DESC, created_at DESC);

-- ============================================================================
-- 4. NOTIFICATIONS INDEXES
-- ============================================================================
-- Covers FK: notifications_recipient_id_fkey & accelerates getNotifications()
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created 
ON public.notifications (recipient_id, created_at DESC);

-- ============================================================================
-- 5. BENEFIT CLAIMS INDEXES
-- ============================================================================
-- Covers FK: benefit_claims_member_id_fkey & accelerates getMemberClaims()
CREATE INDEX IF NOT EXISTS idx_benefit_claims_member_created 
ON public.benefit_claims (member_id, created_at DESC);

-- Covers FK: benefit_claims_benefit_type_id_fkey
CREATE INDEX IF NOT EXISTS idx_benefit_claims_benefit_type_id 
ON public.benefit_claims (benefit_type_id);

-- Covers FK: benefit_claims_approved_by_fkey
CREATE INDEX IF NOT EXISTS idx_benefit_claims_approved_by 
ON public.benefit_claims (approved_by);

-- Covers FK: benefit_claims_disbursed_by_fkey
CREATE INDEX IF NOT EXISTS idx_benefit_claims_disbursed_by 
ON public.benefit_claims (disbursed_by);

-- ============================================================================
-- 6. MEMBER DUES INDEXES
-- ============================================================================
-- Partial index accelerating defaulters_roster view without indexing paid historical dues
CREATE INDEX IF NOT EXISTS idx_member_dues_pending_billing 
ON public.member_dues (billing_month, member_id) 
WHERE status = 'pending';

-- ============================================================================
-- 7. AUDIT LOGS INDEXES
-- ============================================================================
-- Accelerates audit log reverse chronological viewer: getAuditLogs()
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp 
ON public.audit_logs (timestamp DESC);

-- Accelerates entity-specific audit trail lookups
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity 
ON public.audit_logs (entity_type, entity_id);

-- ============================================================================
-- 8. AUXILIARY FOREIGN KEYS (100% Linter Compliance)
-- ============================================================================
-- Covers FK: admin_inquiries_sender_id_fkey
CREATE INDEX IF NOT EXISTS idx_admin_inquiries_sender_id 
ON public.admin_inquiries (sender_id);

-- Covers FK: admin_inquiries_resolved_by_fkey
CREATE INDEX IF NOT EXISTS idx_admin_inquiries_resolved_by 
ON public.admin_inquiries (resolved_by);

-- Covers FK: announcements_created_by_fkey
CREATE INDEX IF NOT EXISTS idx_announcements_created_by 
ON public.announcements (created_by);

-- Covers FK: system_settings_updated_by_fkey
CREATE INDEX IF NOT EXISTS idx_system_settings_updated_by 
ON public.system_settings (updated_by);

-- ============================================================================
-- 9. REFRESH PLANNER STATISTICS
-- ============================================================================
ANALYZE public.payments;
ANALYZE public.payment_dues_reconciliation;
ANALYZE public.treasury_transactions;
ANALYZE public.notifications;
ANALYZE public.benefit_claims;
ANALYZE public.member_dues;
ANALYZE public.audit_logs;
ANALYZE public.admin_inquiries;
ANALYZE public.announcements;
ANALYZE public.system_settings;

COMMIT;
