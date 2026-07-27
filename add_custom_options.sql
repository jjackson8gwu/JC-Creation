-- ============================================================
-- J&C Creations — Add custom_options column to products
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Adds a JSONB column that stores per-product option groups.
-- Format: [{"label": "Intensity", "values": ["Low", "Medium", "High"]}]
-- Defaults to an empty array so existing products are unaffected.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS custom_options JSONB DEFAULT '[]'::jsonb;

-- IMPORTANT: Supabase's API layer (PostgREST) caches the table schema.
-- Without this line the new column exists in the database but the API
-- silently ignores it — which makes saves appear to succeed while the
-- data is dropped. This tells the API to re-read the schema.
NOTIFY pgrst, 'reload schema';

-- Verify it worked — this should return one row showing custom_options:
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'products'
   AND column_name = 'custom_options';
