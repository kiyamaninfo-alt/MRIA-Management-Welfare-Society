-- Migration: 20261108000004_add_app_roles
-- Description: Expand app_role enum with secretary, committee_member, and ensure manager/treasurer exist in isolation

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'secretary';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'treasurer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'committee_member';
