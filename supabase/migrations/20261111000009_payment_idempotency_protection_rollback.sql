-- Rollback Migration: 20261111000009_payment_idempotency_protection_rollback.sql
-- Description: Reverts token-based idempotency architecture for payments.

BEGIN;

DROP FUNCTION IF EXISTS public.record_cash_payment_idempotent(UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, UUID);
DROP INDEX IF EXISTS public.payments_idempotency_key_unique;
ALTER TABLE public.payments DROP COLUMN IF EXISTS idempotency_key;

COMMIT;
