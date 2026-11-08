-- Seed: Initial Root Admin, Benefit Types, System Settings, and Welcome Announcement

-- 1. ROOT ADMINISTRATOR SEED
INSERT INTO public.members (
    email,
    full_name,
    phone,
    nic,
    address,
    is_legacy_member,
    is_approved,
    role
) VALUES (
    'krishaja@gmail.com',
    'Root Administrator',
    '0759555924',
    'ROOT-ADMIN',
    'MRIA Airport, Mattala',
    true,
    true,
    'admin'
) ON CONFLICT (email) DO UPDATE SET
    role = 'admin',
    is_approved = true,
    is_legacy_member = true;

-- 2. SYSTEM SETTINGS
INSERT INTO public.system_settings (key, value, description)
VALUES 
(
    'monthly_due_amount',
    '{"amount": 500.00, "currency": "LKR"}',
    'Standard monthly dues contribution per active member'
),
(
    'admission_fee_amount',
    '{"amount": 1000.00, "currency": "LKR"}',
    'One-time admission registration fee for non-legacy new members'
),
(
    'contact_whatsapp',
    '{"phone": "0759555924", "url": "https://wa.me/94759555924", "display": "0759555924"}',
    'Official WhatsApp contact support for unauthorized registration queries'
),
(
    'bank_qr',
    '{"url": "assets/default-bank-qr.png", "bank_name": "Bank of Ceylon", "account_name": "MRIA Management Welfare Association", "account_number": "0000000000", "branch": "Mattala"}',
    'Official Welfare Association bank payment QR and account details'
)
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = now();

-- 3. BENEFIT TYPES
INSERT INTO public.benefit_types (code, title_en, title_si, description_en, description_si, max_amount, is_active)
VALUES
(
    'DEATH_AID',
    'Death Aid (Bereavement Benefit)',
    'මරණාධාර සුබසාධන ප්‍රතිලාභය',
    'Financial bereavement aid provided for member or immediate family members upon demise.',
    'සාමාජිකයෙකුගේ හෝ ළඟම ඥාතියෙකුගේ අභාවයකදී ලබාදෙන මූල්‍ය ආධාර ප්‍රතිලාභය.',
    50000.00,
    true
),
(
    'MEDICAL_AID',
    'Medical Assistance Aid',
    'වෛද්‍ය ආධාර ප්‍රතිලාභය',
    'Financial aid for hospitalization or critical illness treatments.',
    'රෝහල්ගතවීම් හෝ විශේෂිත වෛද්‍ය ප්‍රතිකාර සඳහා ලබාදෙන මූල්‍ය ආධාර.',
    25000.00,
    true
)
ON CONFLICT (code) DO UPDATE SET
    title_en = EXCLUDED.title_en,
    title_si = EXCLUDED.title_si,
    max_amount = EXCLUDED.max_amount,
    is_active = true;

-- 4. INITIAL WELCOME ANNOUNCEMENT
INSERT INTO public.announcements (
    title_en,
    title_si,
    content_en,
    content_si,
    priority,
    is_pinned,
    created_by
)
SELECT 
    'Welcome to MRIA Management Welfare Association PWA',
    'MRIA සුබසාධක කළමනාකරණ සංගමයේ නිල වෙබ් අඩවියට සාදරයෙන් පිළිගනිමු',
    'The official digital portal for MRIA Welfare Association members. Track your monthly dues, submit bank transfer slips, view announcements, and request welfare aid.',
    'MRIA සුබසාධක සංගමයේ සාමාජිකයන් සඳහා වන නිල ඩිජිටල් ද්වාරය වෙත සාදරයෙන් පිළිගනිමු. ඔබගේ මාසික දායක මුදල් පරීක්ෂා කිරීම, ගෙවීම් රිසිට්පත් ඉදිරිපත් කිරීම සහ සුබසාධන ප්‍රතිලාභ මෙතැනින් ලබාගත හැක.',
    'normal',
    true,
    m.id
FROM public.members m
WHERE m.email = 'krishaja@gmail.com'
LIMIT 1;
