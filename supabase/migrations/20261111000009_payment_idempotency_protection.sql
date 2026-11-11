-- Migration: 20261111000009_payment_idempotency_protection.sql
-- Description: Token-based idempotency architecture for payments in MRIA Welfare Association.
-- Prevents duplicate payment creation on double-clicks, concurrent retries, and protects email quotas.

BEGIN;

-- 1. Add idempotency_key column to public.payments
ALTER TABLE public.payments 
ADD COLUMN IF NOT EXISTS idempotency_key UUID NULL;

-- 2. Create partial unique index on idempotency_key (WHERE NOT NULL to exclude legacy records)
CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_unique 
ON public.payments (idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- 3. Create atomic idempotent cash payment recording function
CREATE OR REPLACE FUNCTION public.record_cash_payment_idempotent(
    p_member_id UUID,
    p_amount NUMERIC,
    p_payment_type TEXT DEFAULT 'monthly_due',
    p_payment_method TEXT DEFAULT 'cash',
    p_collected_by UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_paid_at TIMESTAMPTZ DEFAULT NULL,
    p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_payment public.payments%ROWTYPE;
    v_tx_date TIMESTAMPTZ;
    v_is_replayed BOOLEAN := false;
    v_actor_email VARCHAR(255);
    v_actor_name VARCHAR(255);
    v_epf VARCHAR(50);
BEGIN
    -- Validate required input
    IF p_member_id IS NULL THEN
        RAISE EXCEPTION 'member_id cannot be null' USING ERRCODE = '23502';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'amount must be greater than zero' USING ERRCODE = '23514';
    END IF;

    v_tx_date := COALESCE(p_paid_at, now());

    -- Fast-path: If idempotency_key provided, check if it already exists
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_payment 
        FROM public.payments 
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            -- Check for payload mismatch conflict (Case 4)
            IF v_payment.member_id <> p_member_id 
               OR v_payment.amount <> p_amount 
               OR v_payment.payment_type::text <> p_payment_type THEN
                RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: Idempotency key % was already used with conflicting parameters (member: %, amount: %, type: %)',
                    p_idempotency_key, v_payment.member_id, v_payment.amount, v_payment.payment_type
                    USING ERRCODE = 'P0001';
            END IF;

            -- Log intercepted duplicate in audit_logs
            v_actor_email := COALESCE(auth.jwt() ->> 'email', 'SYSTEM');
            SELECT full_name, epf_number INTO v_actor_name, v_epf
            FROM public.members WHERE id = p_collected_by OR email = v_actor_email LIMIT 1;

            INSERT INTO public.audit_logs (
                timestamp, user_email, full_name, epf_number, action, entity_type, entity_id, diff_json
            ) VALUES (
                timezone('utc', now()),
                COALESCE(v_actor_email, 'SYSTEM'),
                COALESCE(v_actor_name, 'Treasurer'),
                COALESCE(v_epf, 'N/A'),
                'PAYMENT_IDEMPOTENCY_INTERCEPTED',
                'payments',
                v_payment.id::text,
                jsonb_build_object(
                    'idempotency_key', p_idempotency_key,
                    'outcome', 'replayed_existing_voucher',
                    'amount', v_payment.amount,
                    'payment_type', v_payment.payment_type,
                    'member_id', v_payment.member_id
                )
            );

            RETURN jsonb_build_object(
                'payment', to_jsonb(v_payment),
                'is_replayed', true
            );
        END IF;
    END IF;

    -- Attempt insertion with conflict trap
    BEGIN
        INSERT INTO public.payments (
            member_id,
            amount,
            payment_type,
            payment_method,
            status,
            verified_by,
            verified_at,
            created_at,
            notes,
            idempotency_key
        ) VALUES (
            p_member_id,
            p_amount,
            p_payment_type::payment_category,
            COALESCE(p_payment_method, 'cash')::payment_method_type,
            'verified'::payment_status,
            p_collected_by,
            v_tx_date,
            v_tx_date,
            p_notes,
            p_idempotency_key
        )
        RETURNING * INTO v_payment;

        RETURN jsonb_build_object(
            'payment', to_jsonb(v_payment),
            'is_replayed', false
        );

    EXCEPTION WHEN unique_violation THEN
        -- Handle concurrent race condition on duplicate idempotency_key
        IF p_idempotency_key IS NOT NULL THEN
            SELECT * INTO v_payment 
            FROM public.payments 
            WHERE idempotency_key = p_idempotency_key;

            IF FOUND THEN
                IF v_payment.member_id <> p_member_id 
                   OR v_payment.amount <> p_amount 
                   OR v_payment.payment_type::text <> p_payment_type THEN
                    RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: Idempotency key % was already used with conflicting parameters',
                        p_idempotency_key USING ERRCODE = 'P0001';
                END IF;

                v_actor_email := COALESCE(auth.jwt() ->> 'email', 'SYSTEM');
                SELECT full_name, epf_number INTO v_actor_name, v_epf
                FROM public.members WHERE id = p_collected_by OR email = v_actor_email LIMIT 1;

                INSERT INTO public.audit_logs (
                    timestamp, user_email, full_name, epf_number, action, entity_type, entity_id, diff_json
                ) VALUES (
                    timezone('utc', now()),
                    COALESCE(v_actor_email, 'SYSTEM'),
                    COALESCE(v_actor_name, 'Treasurer'),
                    COALESCE(v_epf, 'N/A'),
                    'PAYMENT_IDEMPOTENCY_INTERCEPTED',
                    'payments',
                    v_payment.id::text,
                    jsonb_build_object(
                        'idempotency_key', p_idempotency_key,
                        'outcome', 'replayed_existing_voucher_race',
                        'amount', v_payment.amount,
                        'payment_type', v_payment.payment_type
                    )
                );

                RETURN jsonb_build_object(
                    'payment', to_jsonb(v_payment),
                    'is_replayed', true
                );
            END IF;
        END IF;

        -- Re-raise if it's another unique violation
        RAISE;
    END;
END;
$$;

-- 4. Grant execution permissions
GRANT EXECUTE ON FUNCTION public.record_cash_payment_idempotent(
    UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, UUID
) TO authenticated, service_role, anon;

COMMIT;
