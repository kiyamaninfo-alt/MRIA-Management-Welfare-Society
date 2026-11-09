-- Migration: 20261109000001_configure_benefits_and_monthly_dues
-- Description: Update default monthly dues to 300/= LKR; set death donation to 20,000/=; set medical and pension benefits as inactive facilities editable by admin.

-- 1. Update Monthly Due in System Settings (Default 300/=)
UPDATE public.system_settings 
SET value = jsonb_build_object('amount', 300.00, 'currency', 'LKR'), updated_at = now()
WHERE key = 'monthly_due_amount';

-- 2. Update Monthly Dues Generator Function default to 300/=
CREATE OR REPLACE FUNCTION public.generate_monthly_dues_for_period(target_date DATE)
RETURNS INTEGER AS $$
DECLARE
    due_amount NUMERIC(10, 2);
    first_of_month DATE := date_trunc('month', target_date)::DATE;
    inserted_count INTEGER := 0;
BEGIN
    -- Fetch active due amount from settings (default 300.00 LKR)
    SELECT COALESCE((value->>'amount')::NUMERIC, 300.00) INTO due_amount
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

-- 3. Configure Benefit Types:
-- Only Death Donation is active (20,000/=). Medical Aid and Pension Party are inactive until enabled by Admin.
UPDATE public.benefit_types
SET max_amount = 20000.00, 
    is_active = true,
    title_en = 'Death Donation (Bereavement Aid)',
    title_si = 'මරණාධාර සුබසාධන ප්‍රතිලාභය'
WHERE code = 'DEATH_AID';

UPDATE public.benefit_types
SET is_active = false,
    title_en = 'Medical Assistance & Hospitalization Facilities',
    title_si = 'වෛද්‍ය සහ රෝහල්ගතවීම් ආධාර පහසුකම්'
WHERE code = 'MEDICAL_AID';

INSERT INTO public.benefit_types (code, title_en, title_si, description_en, description_si, max_amount, is_active)
VALUES (
    'PENSION_PARTY',
    'Pension & Retirement Farewell Benefit',
    'විශ්‍රාම සාද සහ උපහාර සුබසාධනය',
    'Financial assistance and society felicitation contribution for retiring members upon formal retirement.',
    'සාමාජිකයෙකුගේ නිල විශ්‍රාම යාමේදී සංගමය මගින් ලබාදෙන විශ්‍රාම උපහාර සහ සාද ආධාර දීමනාව.',
    15000.00,
    false
)
ON CONFLICT (code) DO UPDATE SET
    is_active = false,
    title_en = EXCLUDED.title_en,
    title_si = EXCLUDED.title_si;

-- 4. Grant Admin & Treasurer Management Privileges on Benefit Types
DROP POLICY IF EXISTS benefit_types_admin_manage ON public.benefit_types;
CREATE POLICY benefit_types_admin_manage ON public.benefit_types
    FOR ALL TO authenticated
    USING (public.get_current_user_role() IN ('admin', 'manager', 'treasurer', 'official'))
    WITH CHECK (public.get_current_user_role() IN ('admin', 'manager', 'treasurer', 'official'));
