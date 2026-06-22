-- ============================================================
-- J&C Creations — Orders Table
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

create table if not exists public.orders (
  id             uuid default gen_random_uuid() primary key,
  customer_name  text not null,
  customer_contact text default '',          -- phone, FB handle, email, etc.
  source         text default 'in_person',   -- 'in_person', 'facebook', 'online'
  item_name      text not null,
  item_id        text default '',            -- links to products.id (optional)
  quantity       integer default 1,
  unit_price     numeric(10,2) default 0,
  pack_status    text default 'Pending',     -- 'Pending', 'Packaged', 'Delivered'
  pay_status     text default 'Unpaid',      -- 'Unpaid', 'Paid'
  notes          text default '',
  order_date     date default current_date,
  created_at     timestamptz default now()
);

-- Enable RLS
alter table public.orders enable row level security;

drop policy if exists "Public can read orders"  on public.orders;
drop policy if exists "Anon can modify orders"  on public.orders;

create policy "Public can read orders"
  on public.orders for select using (true);

create policy "Anon can modify orders"
  on public.orders for all using (true) with check (true);

-- Helpful index for filtering by customer and status
create index if not exists orders_customer_idx   on public.orders (lower(customer_name));
create index if not exists orders_pack_status_idx on public.orders (pack_status);
create index if not exists orders_pay_status_idx  on public.orders (pay_status);
