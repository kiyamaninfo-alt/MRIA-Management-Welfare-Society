-- Migration: 20261109000005_benefit_grant_payment_methods.sql
-- Add payment_method to benefit_claims and update automatic treasury outflow sync trigger

ALTER TABLE public.benefit_claims 
ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'cash';

CREATE OR REPLACE FUNCTION public.fn_sync_claim_disbursement_to_treasury()
RETURNS TRIGGER AS $$
DECLARE
    v_recorder UUID;
    v_amount NUMERIC(12, 2);
    v_source_account VARCHAR(50);
    v_method_label TEXT;
BEGIN
    IF (NEW.status = 'disbursed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'disbursed' OR OLD.payment_method IS DISTINCT FROM NEW.payment_method OR OLD.disbursed_amount IS DISTINCT FROM NEW.disbursed_amount)) THEN
        v_recorder := COALESCE(NEW.disbursed_by, NEW.approved_by, NEW.member_id);
        v_amount := COALESCE(NEW.disbursed_amount, NEW.claim_amount);

        -- Map payment_method to appropriate source treasury account
        IF NEW.payment_method = 'cash' THEN
            v_source_account := 'cash_in_hand';
            v_method_label := 'Direct Cash Float';
        ELSIF NEW.payment_method = 'qr_payment' THEN
            v_source_account := 'boc_savings';
            v_method_label := 'LankaQR Scan';
        ELSE
            v_source_account := 'boc_savings';
            v_method_label := 'Bank Transfer';
        END IF;

        IF v_amount > 0 THEN
            IF EXISTS (SELECT 1 FROM public.treasury_transactions WHERE claim_id = NEW.id) THEN
                UPDATE public.treasury_transactions
                SET source_account_id = v_source_account,
                    amount = v_amount,
                    transaction_date = COALESCE(NEW.disbursed_at::date, CURRENT_DATE),
                    description = 'Disbursed Welfare Aid Grant (' || v_method_label || ')'
                WHERE claim_id = NEW.id;
            ELSE
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
                    v_source_account,
                    v_amount,
                    'CLM-' || upper(substring(NEW.id::text, 1, 8)),
                    'Disbursed Welfare Aid Grant (' || v_method_label || ')',
                    NEW.id,
                    v_recorder
                );
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
