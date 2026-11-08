-- Migration: 20261108000008_add_payment_enums
-- Description: Add 'qr_payment' to payment_method_type and 'other' to payment_category

ALTER TYPE public.payment_method_type ADD VALUE IF NOT EXISTS 'qr_payment';
ALTER TYPE public.payment_category ADD VALUE IF NOT EXISTS 'other';
