-- Migration: 20261108000003_triggers_and_functions
-- Description: Auth user linker, payment FIFO dues reconciliation, and monthly dues generation cron

-- 1. AUTH USER CREATED LINKER TRIGGER
CREATE OR REPLACE FUNCTION public.handle_auth_user_created()
RETURNS TRIGGER AS $$
DECLARE
    matched_member_id UUID;
BEGIN
    -- Look for pre-registered member record by email
    SELECT id INTO matched_member_id FROM public.members WHERE email = NEW.email;

    IF matched_member_id IS NOT NULL THEN
        UPDATE public.members
        SET user_id = NEW.id,
            updated_at = now()
        WHERE id = matched_member_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Drop trigger if exists to ensure idempotency
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_created();

-- 2. FIFO PAYMENT DUES RECONCILIATION PROCEDURE & TRIGGER
CREATE OR REPLACE FUNCTION public.reconcile_verified_payment()
RETURNS TRIGGER AS $$
DECLARE
    remaining_funds NUMERIC(10, 2) := NEW.amount;
    due_record RECORD;
    alloc_amount NUMERIC(10, 2);
BEGIN
    -- Only execute when status transitions to 'verified' for monthly_due payments
    IF NEW.status = 'verified' AND (OLD.status IS DISTINCT FROM 'verified') AND NEW.payment_type = 'monthly_due' THEN
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

-- Drop trigger if exists
DROP TRIGGER IF EXISTS on_payment_verified_reconcile ON public.payments;

CREATE TRIGGER on_payment_verified_reconcile
AFTER UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.reconcile_verified_payment();

-- 3. MONTHLY DUES GENERATION ROUTINE
CREATE OR REPLACE FUNCTION public.generate_monthly_dues_for_period(target_date DATE)
RETURNS INTEGER AS $$
DECLARE
    due_amount NUMERIC(10, 2);
    first_of_month DATE := date_trunc('month', target_date)::DATE;
    inserted_count INTEGER := 0;
BEGIN
    -- Fetch active due amount from settings (default 500.00 LKR)
    SELECT COALESCE((value->>'amount')::NUMERIC, 500.00) INTO due_amount
    FROM public.system_settings WHERE key = 'monthly_due_amount';

    INSERT INTO public.member_dues (member_id, billing_month, amount, status)
    SELECT m.id, first_of_month, due_amount, 'pending'
    FROM public.members m
    WHERE m.is_approved = true
    ON CONFLICT (member_id, billing_month) DO NOTHING;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    RETURN inserted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. SCHEDULE PG_CRON: Run at 00:00:00 Asia/Colombo (18:30:00 UTC) on the 1st of each month
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-monthly-dues-cron') THEN
        PERFORM cron.unschedule('generate-monthly-dues-cron');
    END IF;
    PERFORM cron.schedule(
        'generate-monthly-dues-cron',
        '30 18 1 * *',
        'SELECT public.generate_monthly_dues_for_period(TIMEZONE(''Asia/Colombo'', now())::DATE);'
    );
END $$;
