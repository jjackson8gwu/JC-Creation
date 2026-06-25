-- ============================================================
-- J&C Creations — Add custom_options column to products
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Adds a JSONB column that stores per-product option groups.
-- Format: [{"label": "Intensity", "values": ["Low", "Medium", "High"]}]
-- Defaults to an empty array so existing products are unaffected.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS custom_options JSONB DEFAULT '[]'::jsonb;
