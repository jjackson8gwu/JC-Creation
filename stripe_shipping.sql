-- Additive setup: run AFTER stripe_pickup.sql. Does not change stock or existing policies.
begin;

alter table public.products add column if not exists shipping_weight_oz numeric(8,2)
  check (shipping_weight_oz > 0 and shipping_weight_oz <= 1120);
alter table public.products add column if not exists shipping_mode text not null default 'quote'
  check (shipping_mode in ('standard', 'quote', 'pickup'));

-- Conservative estimates supplied by Jonathan. Do not overwrite later manual weights.
-- Eligibility stays 'quote' until the owner confirms the item fits standard packaging.
update public.products set shipping_weight_oz = case
  when category in ('1_dollar_minis', '2_dollar_minis', '3_dollar_minis') then 1
  when lower(category) = 'pokeballs' then 8
  when lower(category) = 'fidgets' then 4
  when category = 'Dragons_and_Animals' and lower(name) like '%dragon%' then 5
  else null end
where shipping_weight_oz is null;

create table if not exists public.shipping_settings (
  id boolean primary key default true check (id),
  packaging_oz numeric(8,2) not null default 7 check (packaging_oz > 0 and packaging_oz < 32),
  light_cents integer not null default 1000 check (light_cents >= 0 and light_cents <= 100000),
  heavy_cents integer not null default 1300 check (heavy_cents >= 0 and heavy_cents <= 100000)
);
insert into public.shipping_settings(id) values (true) on conflict do nothing;
alter table public.shipping_settings enable row level security;
revoke all on public.shipping_settings from public, anon, authenticated;
grant select, update on public.shipping_settings to authenticated;
grant select on public.shipping_settings to service_role;
drop policy if exists "Owner manages shipping settings" on public.shipping_settings;
create policy "Owner manages shipping settings" on public.shipping_settings for all to authenticated
  using (auth.jwt()->'app_metadata'->>'jcc_admin' = 'true')
  with check (auth.jwt()->'app_metadata'->>'jcc_admin' = 'true');

create table if not exists public.shipping_checkouts (
  id uuid primary key,
  items jsonb not null,
  requested jsonb not null,
  customer jsonb not null,
  checkout_config jsonb not null,
  packed_oz numeric(8,2) not null,
  shipping_cents integer not null,
  expires_at bigint not null,
  created_at timestamptz not null default now(),
  state text not null default 'held' check (state in ('held', 'paid', 'expired')),
  stripe_session text unique,
  session_url text,
  tax_cents integer,
  total_cents integer
);
alter table public.shipping_checkouts enable row level security;
revoke all on public.shipping_checkouts from public, anon, authenticated;
grant select, insert, update on public.shipping_checkouts to service_role;
grant select on public.shipping_checkouts to authenticated;
drop policy if exists "Owner reads shipping checkouts" on public.shipping_checkouts;
create policy "Owner reads shipping checkouts" on public.shipping_checkouts for select to authenticated
  using (auth.jwt()->'app_metadata'->>'jcc_admin' = 'true');

alter table public.orders add column if not exists shipping_amount numeric(10,2) not null default 0;
alter table public.orders add column if not exists tax_amount numeric(10,2) not null default 0;
alter table public.orders add column if not exists checkout_reference text;

create or replace function public.shipping_quote(requested jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  product public.products%rowtype;
  settings public.shipping_settings%rowtype;
  item record;
  basket jsonb := '[]';
  packed numeric;
begin
  if jsonb_typeof(requested) is distinct from 'array' or jsonb_array_length(requested) not between 1 and 25 then
    return jsonb_build_object('error', 'Review your cart before calculating shipping.');
  end if;
  select * into strict settings from public.shipping_settings where id;
  packed := settings.packaging_oz;
  for item in select entry->>'id' as id, sum((entry->>'quantity')::integer) as qty
    from jsonb_array_elements(requested) as entry group by 1 order by 1
  loop
    select p.* into product from public.products p where p.id = item.id;
    if not found or item.qty is null or item.qty not between 1 and 20
      or product.quantity is null or product.quantity < item.qty or coalesce(product.price, 0) <= 0
      or product.shipping_mode <> 'standard' or product.shipping_weight_oz is null
      or coalesce(product.made_to_order, false) or coalesce(product.price_varies, false)
      or coalesce(product.requires_color, false)
      or coalesce(jsonb_array_length(to_jsonb(product.custom_options)), 0) > 0 then
      return jsonb_build_object('error', 'An item needs a shipping quote or is unavailable. Please submit an order request.');
    end if;
    packed := packed + product.shipping_weight_oz * item.qty;
    basket := basket || jsonb_build_array(jsonb_build_object(
      'id', product.id, 'name', product.name, 'quantity', item.qty,
      'cents', round(product.price * 100)::integer, 'weight_oz', product.shipping_weight_oz));
  end loop;
  if packed > 32 then
    return jsonb_build_object('error', 'This order exceeds 2 lb including packaging. Please submit an order request for a shipping quote.');
  end if;
  return jsonb_build_object('items', basket, 'packed_oz', packed, 'packaging_oz', settings.packaging_oz,
    'shipping_cents', case when packed <= 16 then settings.light_cents else settings.heavy_cents end);
end $$;

create or replace function public.reserve_shipping_checkout(
  request_id uuid, requested jsonb, customer jsonb, checkout_config jsonb
) returns jsonb language plpgsql set search_path = '' as $$
declare hold public.shipping_checkouts%rowtype; quote jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(request_id::text, 0));
  select * into hold from public.shipping_checkouts where id = request_id;
  if found then
    if hold.state <> 'held' or hold.requested <> requested or hold.customer <> customer
      or hold.expires_at <= extract(epoch from clock_timestamp()) then
      return jsonb_build_object('error', 'This checkout has ended or changed. Start a new checkout.');
    end if;
    return to_jsonb(hold);
  end if;
  -- Lock every item before validating the basket so competing carts cannot reserve the same last unit.
  perform p.id from public.products p
    where p.id in (select entry->>'id' from jsonb_array_elements(requested) as entry)
    order by p.id for update;
  quote := public.shipping_quote(requested);
  if quote ? 'error' then return quote; end if;
  update public.products p set quantity = p.quantity - x.quantity
    from jsonb_to_recordset(quote->'items') as x(id text, quantity integer) where p.id = x.id;
  insert into public.shipping_checkouts(id, items, requested, customer, checkout_config, packed_oz, shipping_cents, expires_at)
  values (request_id, quote->'items', requested, customer, checkout_config,
    (quote->>'packed_oz')::numeric, (quote->>'shipping_cents')::integer,
    floor(extract(epoch from clock_timestamp()))::bigint + 2700)
  returning * into hold;
  return to_jsonb(hold);
end $$;

create or replace function public.record_shipping_session(request_id uuid, session_id text, url text)
returns jsonb language plpgsql set search_path = '' as $$
begin
  update public.shipping_checkouts set stripe_session = session_id, session_url = url
    where id = request_id and (stripe_session is null or stripe_session = session_id);
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.finish_shipping_checkout(
  request_id uuid, session_id text, is_paid boolean, subtotal integer, shipping integer,
  tax integer, total integer, currency text, test_mode boolean
) returns jsonb language plpgsql set search_path = '' as $$
declare hold public.shipping_checkouts%rowtype; expected bigint; item record; delivery text;
begin
  select * into hold from public.shipping_checkouts where id = request_id for update;
  if not found or (hold.stripe_session is not null and hold.stripe_session <> session_id) then
    return jsonb_build_object('ok', false);
  end if;
  if hold.state <> 'held' then
    return jsonb_build_object('ok', hold.state = case when is_paid then 'paid' else 'expired' end);
  end if;
  if is_paid then
    select sum(quantity * cents::bigint) into expected
      from jsonb_to_recordset(hold.items) as x(quantity integer, cents integer);
    if subtotal is distinct from expected or shipping is distinct from hold.shipping_cents
      or tax is null or tax < 0 or total is distinct from expected + hold.shipping_cents + tax
      or currency is distinct from 'usd' then return jsonb_build_object('ok', false); end if;
    delivery := concat_ws(', ', hold.customer->>'name', hold.customer->'address'->>'line1',
      nullif(hold.customer->'address'->>'line2', ''), hold.customer->'address'->>'city',
      hold.customer->'address'->>'state', hold.customer->'address'->>'postal_code', 'US');
    insert into public.orders(customer_name, customer_contact, source, item_name, item_id,
      quantity, unit_price, pack_status, pay_status, notes, shipping_amount, tax_amount, checkout_reference)
    select hold.customer->>'name', concat_ws(' · ', hold.customer->>'email', hold.customer->>'phone'),
      'online', name, id, quantity, cents / 100.0, 'Pending', 'Paid',
      case when test_mode then 'TEST · ' else '' end || 'USPS shipping · Ship to: ' || delivery || ' · Stripe ' || session_id,
      case when row_number() over(order by id) = 1 then hold.shipping_cents / 100.0 else 0 end,
      case when row_number() over(order by id) = 1 then tax / 100.0 else 0 end, session_id
    from jsonb_to_recordset(hold.items) as x(id text, name text, quantity integer, cents integer);
  else
    for item in select * from jsonb_to_recordset(hold.items) as x(id text, quantity integer) order by id loop
      update public.products p set quantity = p.quantity + item.quantity where p.id = item.id;
      if not found then raise exception 'Held product no longer exists'; end if;
    end loop;
  end if;
  update public.shipping_checkouts set state = case when is_paid then 'paid' else 'expired' end,
    stripe_session = session_id, tax_cents = case when is_paid then tax else null end,
    total_cents = case when is_paid then total else null end where id = request_id;
  return jsonb_build_object('ok', true);
end $$;

-- Releases only unlinked, stale holds. The server MUST first check Stripe for matching sessions.
create or replace function public.release_unlinked_checkout(request_id uuid, kind text)
returns jsonb language plpgsql set search_path = '' as $$
declare basket jsonb; item record;
begin
  if kind = 'shipping' then
    select h.items into basket from public.shipping_checkouts h where h.id = request_id and h.state = 'held'
      and h.stripe_session is null and h.expires_at < extract(epoch from clock_timestamp()) - 900 for update;
  elsif kind = 'pickup' then
    select h.items into basket from public.pickup_checkouts h where h.id = request_id and h.state = 'held'
      and h.stripe_session is null and h.expires_at < extract(epoch from clock_timestamp()) - 900 for update;
  else return jsonb_build_object('ok', false); end if;
  if not found then return jsonb_build_object('ok', false); end if;
  for item in select * from jsonb_to_recordset(basket) as x(id text, quantity integer) order by id loop
    update public.products p set quantity = p.quantity + item.quantity where p.id = item.id;
    if not found then raise exception 'Held product no longer exists'; end if;
  end loop;
  if kind = 'shipping' then update public.shipping_checkouts set state = 'expired' where id = request_id;
  else update public.pickup_checkouts set state = 'expired' where id = request_id; end if;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.shipping_quote(jsonb) from public, anon, authenticated;
revoke execute on function public.reserve_shipping_checkout(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.record_shipping_session(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.finish_shipping_checkout(uuid, text, boolean, integer, integer, integer, integer, text, boolean) from public, anon, authenticated;
revoke execute on function public.release_unlinked_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.shipping_quote(jsonb) to service_role;
grant execute on function public.reserve_shipping_checkout(uuid, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.record_shipping_session(uuid, text, text) to service_role;
grant execute on function public.finish_shipping_checkout(uuid, text, boolean, integer, integer, integer, integer, text, boolean) to service_role;
grant execute on function public.release_unlinked_checkout(uuid, text) to service_role;
notify pgrst, 'reload schema';
commit;
