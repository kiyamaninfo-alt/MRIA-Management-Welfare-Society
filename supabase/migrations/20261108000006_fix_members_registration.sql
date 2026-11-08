-- Migration: 20261108000006_fix_members_registration
-- Description: Fix member self-registration by setting default auth.uid() on user_id, making phone nullable, and refining RLS insertion policy

-- 1. Set default auth.uid() on members.user_id and ensure phone has default/nullable
ALTER TABLE public.members ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.members ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE public.members ALTER COLUMN phone SET DEFAULT '';

-- 2. BEFORE INSERT trigger to guarantee user_id is automatically linked to auth.uid()
CREATE OR REPLACE FUNCTION public.fn_set_member_user_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.user_id IS NULL AND auth.uid() IS NOT NULL THEN
        NEW.user_id := auth.uid();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_members_set_user_id ON public.members;
CREATE TRIGGER trg_members_set_user_id
BEFORE INSERT ON public.members
FOR EACH ROW EXECUTE FUNCTION public.fn_set_member_user_id();

-- 3. Update self-registration RLS policy
DROP POLICY IF EXISTS members_self_registration_insert ON public.members;
CREATE POLICY members_self_registration_insert ON public.members
FOR INSERT TO authenticated
WITH CHECK (
    (user_id = auth.uid() OR user_id IS NULL) AND 
    role = 'member'::app_role AND 
    is_approved = false AND 
    is_legacy_member = false
);
