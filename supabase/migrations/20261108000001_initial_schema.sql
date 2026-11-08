-- Migration: 20261108000001_initial_schema
-- Description: Core schema, enums, tables, and defaulters view

-- 1. ENUMS
CREATE TYPE app_role AS ENUM ('admin', 'manager', 'official', 'treasurer', 'member');
CREATE TYPE payment_status AS ENUM ('pending_approval', 'verified', 'rejected');
CREATE TYPE payment_method_type AS ENUM ('bank_transfer', 'cash');
CREATE TYPE payment_category AS ENUM ('monthly_due', 'admission_fee', 'donation');
CREATE TYPE due_status AS ENUM ('pending', 'paid', 'waived');
CREATE TYPE claim_status AS ENUM ('submitted', 'under_review', 'approved', 'rejected', 'disbursed');

-- 2. MEMBERS / PROFILES
CREATE TABLE public.members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    nic TEXT,
    address TEXT,
    is_legacy_member BOOLEAN NOT NULL DEFAULT false,
    is_approved BOOLEAN NOT NULL DEFAULT false,
    role app_role NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. MONTHLY DUES LEDGER
CREATE TABLE public.member_dues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    billing_month DATE NOT NULL, -- Stored as YYYY-MM-01
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    status due_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(member_id, billing_month)
);

-- 4. PAYMENTS & TRANSACTIONS
CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    payment_type payment_category NOT NULL,
    payment_method payment_method_type NOT NULL,
    slip_key TEXT, -- Cloudflare R2 object key
    status payment_status NOT NULL DEFAULT 'pending_approval',
    verified_by UUID REFERENCES public.members(id),
    verified_at TIMESTAMPTZ,
    rejection_reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. DUES RECONCILIATION MAPPING
CREATE TABLE public.payment_dues_reconciliation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
    due_id UUID NOT NULL REFERENCES public.member_dues(id) ON DELETE RESTRICT,
    allocated_amount NUMERIC(10, 2) NOT NULL CHECK (allocated_amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. WELFARE BENEFIT TYPES
CREATE TABLE public.benefit_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL, -- e.g. 'DEATH_AID', 'MEDICAL_AID'
    title_en TEXT NOT NULL,
    title_si TEXT NOT NULL,
    description_en TEXT,
    description_si TEXT,
    max_amount NUMERIC(10, 2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. BENEFIT CLAIMS
CREATE TABLE public.benefit_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    benefit_type_id UUID NOT NULL REFERENCES public.benefit_types(id) ON DELETE RESTRICT,
    claim_amount NUMERIC(10, 2) NOT NULL CHECK (claim_amount > 0),
    disbursed_amount NUMERIC(10, 2) DEFAULT 0,
    status claim_status NOT NULL DEFAULT 'submitted',
    approved_by UUID REFERENCES public.members(id),
    disbursed_by UUID REFERENCES public.members(id),
    disbursed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. ANNOUNCEMENTS / NOTICE BOARD
CREATE TABLE public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title_en TEXT NOT NULL,
    title_si TEXT NOT NULL,
    content_en TEXT NOT NULL,
    content_si TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('normal', 'urgent')) DEFAULT 'normal',
    is_pinned BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES public.members(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. SYSTEM CONFIGURATION & SETTINGS
CREATE TABLE public.system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES public.members(id)
);

-- 10. DEFAULTERS COMPUTED VIEW
CREATE OR REPLACE VIEW public.defaulters_roster AS
SELECT 
    m.id AS member_id,
    m.full_name,
    m.phone,
    m.email,
    d.id AS due_id,
    d.billing_month,
    d.amount,
    d.status
FROM public.members m
JOIN public.member_dues d ON d.member_id = m.id
WHERE d.status = 'pending'
  AND d.billing_month < date_trunc('month', TIMEZONE('Asia/Colombo', now()))::DATE;
