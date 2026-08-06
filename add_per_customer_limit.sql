-- ============================================================
-- J&C Creations — Per-customer promo code limits
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- (Run promo_codes_schema.sql first if you haven't already.)
-- ============================================================

-- How many times ONE email address may use a given code.
-- 0 = unlimited per customer (the total max_uses cap still applies).
ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS max_uses_per_customer integer DEFAULT 0;

-- Emails are stored lowercase so per-customer counting is case-insensitive.
-- Normalize anything already logged.
UPDATE public.promo_redemptions
   SET customer_email = lower(customer_email)
 WHERE customer_email <> lower(customer_email);

-- Makes the "how many times has this person used this code" lookup fast.
CREATE INDEX IF NOT EXISTS promo_redemptions_code_email_idx
  ON public.promo_redemptions (code, customer_email);

-- Tell Supabase's API layer to re-read the schema, otherwise the new
-- column exists in the database but the API silently ignores it.
NOTIFY pgrst, 'reload schema';

-- Verify:
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_name = 'promo_codes'
   AND column_name = 'max_uses_per_customer';
