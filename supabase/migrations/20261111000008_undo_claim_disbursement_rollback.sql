-- =============================================================================
-- Migration Rollback: 20261111000008_undo_claim_disbursement_rollback.sql
-- Description: Drops the undo_claim_disbursement function
-- =============================================================================

DROP FUNCTION IF EXISTS public.undo_claim_disbursement(UUID, TEXT, UUID);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
