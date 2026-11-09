-- Migration: 20261109000004_configure_admission_fees
-- Description: Update default admission fee to 500/= LKR and initialize admission fees schedule in system_settings.

INSERT INTO public.system_settings (key, value, description)
VALUES (
    'admission_fee_amount',
    '{"amount": 500.00, "currency": "LKR"}'::jsonb,
    'Standard one-time statutory admission registration fee for non-legacy members'
)
ON CONFLICT (key) DO UPDATE
SET value = '{"amount": 500.00, "currency": "LKR"}'::jsonb,
    updated_at = now();

INSERT INTO public.system_settings (key, value, description)
VALUES (
    'admission_fees_list',
    '[
        {
            "id": "adm_standard",
            "code": "STANDARD_ADMISSION",
            "title_en": "Standard New Member Admission Fee",
            "title_si": "නව සාමාජික ඇතුල්වීමේ ගාස්තුව",
            "amount": 500.00,
            "is_active": true,
            "description": "Standard one-time statutory admission fee for non-legacy staff joining the association"
        }
    ]'::jsonb,
    'Configurable list of member admission fee schedules'
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
