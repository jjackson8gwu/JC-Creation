begin;

create table if not exists public.pickup_checkouts (
  id uuid primary key,
  items jsonb not null,
  requested jsonb not null,
  expires_at bigint not null,
  state text not null default 'held' check (state in ('held', 'paid', 'expired')),
  stripe_session text unique
);
alter table public.pickup_checkouts enable row level security;
revoke all on public.pickup_checkouts from public, anon, authenticated;
grant select, insert, update on public.pickup_checkouts to service_role;

create or replace function public.reserve_pickup_checkout(request_id uuid, requested jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  hold public.pickup_checkouts%rowtype;
  product public.products%rowtype;
  item record;
  basket jsonb := '[]';
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(request_id::text, 0));
  select * into hold from public.pickup_checkouts where id = request_id;
  if found then
    if hold.state <> 'held' or hold.requested <> requested or
      hold.expires_at <= extract(epoch from clock_timestamp()) then
      return jsonb_build_object('error', 'This checkout has already ended or changed. Reopen the order form.');
    end if;
    return jsonb_build_object('items', hold.items, 'expires_at', hold.expires_at);
  end if;

  for item in select entry->>'id' as id, sum((entry->>'quantity')::integer) as qty
    from jsonb_array_elements(requested) as entry group by 1 order by 1
  loop
    select p.* into product from public.products p where p.id = item.id for update;
    if not found or product.quantity is null or item.qty not between 1 and 20
      or product.quantity < item.qty or coalesce(product.price, 0) <= 0
      or coalesce(product.made_to_order, false) or coalesce(product.price_varies, false)
      or coalesce(product.requires_color, false)
      or coalesce(jsonb_array_length(to_jsonb(product.custom_options)), 0) > 0 then
      return jsonb_build_object('error', 'An item is unavailable for pickup checkout. Review your cart or submit a request.');
    end if;
    basket := basket || jsonb_build_array(jsonb_build_object(
      'id', product.id, 'name', product.name, 'quantity', item.qty, 'cents', round(product.price * 100)::integer
    ));
  end loop;
  for item in select * from jsonb_to_recordset(basket) as x(id text, quantity integer)
  loop
    update public.products p set quantity = p.quantity - item.quantity where p.id = item.id;
  end loop;
  insert into public.pickup_checkouts (id, items, requested, expires_at)
  values (request_id, basket, requested, floor(extract(epoch from clock_timestamp()))::bigint + 2700)
  returning * into hold;
  return jsonb_build_object('items', hold.items, 'expires_at', hold.expires_at);
end $$;

create or replace function public.finish_pickup_checkout(
  request_id uuid, stripe_session text, is_paid boolean, subtotal integer, currency text,
  buyer_name text, buyer_email text, test_mode boolean
) returns jsonb language plpgsql set search_path = '' as $$
declare
  hold public.pickup_checkouts%rowtype;
  item record;
  expected bigint;
begin
  select * into hold from public.pickup_checkouts where id = request_id for update;
  if not found or (hold.stripe_session is not null and hold.stripe_session <> $2) then
    return jsonb_build_object('ok', false);
  end if;
  if hold.state <> 'held' then
    return jsonb_build_object('ok', hold.state = case when is_paid then 'paid' else 'expired' end);
  end if;
  if is_paid then
    select sum(quantity * cents::bigint) into expected
    from jsonb_to_recordset(hold.items) as x(quantity integer, cents integer);
    if subtotal is distinct from expected or currency is distinct from 'usd' then
      return jsonb_build_object('ok', false);
    end if;
    insert into public.orders (customer_name, customer_contact, source, item_name, item_id,
      quantity, unit_price, pack_status, pay_status, notes)
    select buyer_name, buyer_email, 'online', name, id, quantity, cents / 100.0, 'Pending', 'Paid',
      case when test_mode then 'TEST · ' else '' end || 'Local pickup · Stripe ' || $2
    from jsonb_to_recordset(hold.items) as x(id text, name text, quantity integer, cents integer);
  else
    for item in select * from jsonb_to_recordset(hold.items) as x(id text, quantity integer) order by id
    loop
      update public.products p set quantity = p.quantity + item.quantity where p.id = item.id;
      if not found then raise exception 'Held product no longer exists'; end if;
    end loop;
  end if;
  update public.pickup_checkouts
  set state = case when is_paid then 'paid' else 'expired' end, stripe_session = $2
  where id = request_id;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.reserve_pickup_checkout(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.finish_pickup_checkout(uuid, text, boolean, integer, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.reserve_pickup_checkout(uuid, jsonb) to service_role;
grant execute on function public.finish_pickup_checkout(uuid, text, boolean, integer, text, text, text, boolean) to service_role;

-- Replace legacy order and catalog policies. Only owner-tagged Supabase accounts may edit.
alter table public.orders enable row level security;
alter table public.products enable row level security;
do $$
declare entry record;
begin
  for entry in select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('orders', 'products')
  loop
    execute format('drop policy %I on public.%I', entry.policyname, entry.tablename);
  end loop;
end $$;
create policy "Store owner manages orders" on public.orders for all to authenticated
  using (auth.jwt()->'app_metadata'->>'jcc_admin' = 'true')
  with check (auth.jwt()->'app_metadata'->>'jcc_admin' = 'true');
create policy "Public reads catalog" on public.products for select to anon, authenticated using (true);
create policy "Store owner manages catalog" on public.products for all to authenticated
  using (auth.jwt()->'app_metadata'->>'jcc_admin' = 'true')
  with check (auth.jwt()->'app_metadata'->>'jcc_admin' = 'true');
commit;
