-- =============================================================================
-- Migration Rollback: 20261112000006_claims_workflow_shortcuts_and_search_rollback.sql
-- Description: Reverts fn_claim_approve_and_go_to_payout RPC
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_claim_approve_and_go_to_payout(UUID);
