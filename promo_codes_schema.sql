-- ============================================================
-- J&C Creations — Promo Codes
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ── 1. The codes themselves ─────────────────────────────────
create table if not exists public.promo_codes (
  id             uuid default gen_random_uuid() primary key,
  code           text not null unique,        -- stored UPPERCASE, e.g. 'SAVE20'
  description    text default '',             -- internal note: "SimpleText Aug blast"
  discount_type  text not null default 'percent',  -- 'percent' | 'fixed'
  discount_value numeric(10,2) not null default 0, -- 20 = 20% or $20
  min_order      numeric(10,2) default 0,     -- cart must be >= this to apply
  max_uses       integer default 0,           -- 0 = unlimited
  uses_count     integer default 0,           -- incremented on each redemption
  category       text default '',             -- '' = whole cart, else limits to one category
  expires_at     date,                        -- null = never expires
  active         boolean default true,
  created_at     timestamptz default now()
);

-- Store codes case-insensitively by always upper-casing on write.
create unique index if not exists promo_codes_code_idx on public.promo_codes (upper(code));

alter table public.promo_codes enable row level security;

drop policy if exists "Public can read promo codes" on public.promo_codes;
drop policy if exists "Anon can modify promo codes" on public.promo_codes;

create policy "Public can read promo codes"
  on public.promo_codes for select using (true);

create policy "Anon can modify promo codes"
  on public.promo_codes for all using (true) with check (true);


-- ── 2. Redemption log ───────────────────────────────────────
create table if not exists public.promo_redemptions (
  id             uuid default gen_random_uuid() primary key,
  code           text not null,
  customer_name  text default '',
  customer_email text default '',
  order_subtotal numeric(10,2) default 0,
  discount_amount numeric(10,2) default 0,
  order_total    numeric(10,2) default 0,
  redeemed_at    timestamptz default now()
);

alter table public.promo_redemptions enable row level security;

drop policy if exists "Public can read redemptions" on public.promo_redemptions;
drop policy if exists "Anon can modify redemptions" on public.promo_redemptions;

create policy "Public can read redemptions"
  on public.promo_redemptions for select using (true);

create policy "Anon can modify redemptions"
  on public.promo_redemptions for all using (true) with check (true);

create index if not exists promo_redemptions_code_idx on public.promo_redemptions (code);


-- ── 3. Atomic usage increment (prevents race conditions) ────
create or replace function public.increment_promo_use(promo_code text)
returns void
language sql
as $$
  update public.promo_codes
     set uses_count = uses_count + 1
   where upper(code) = upper(promo_code);
$$;


-- ── 4. Make sure PostgREST picks up the new tables ──────────
notify pgrst, 'reload schema';
