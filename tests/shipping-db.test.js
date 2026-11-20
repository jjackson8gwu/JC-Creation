const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

test('shipping database: weights, reservations, totals, expiry and permissions', {
  skip: !process.env.PGLITE_TEST_MODULE, timeout: 60000
}, async () => {
  const { PGlite } = require(process.env.PGLITE_TEST_MODULE);
  const db = new PGlite();
  const file = name => readFileSync(path.join(__dirname, '..', name), 'utf8');
  const call = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args)).rows[0].result;
  const stock = async id => (await db.query('select quantity from public.products where id=$1', [id])).rows[0].quantity;
  const customer = { name: 'Test buyer', email: 'buyer@example.com', phone: '5551234567',
    address: { line1: '123 Test St', line2: '', city: 'Shelby', state: 'NC', postal_code: '28150', country: 'US' } };
  const config = { recipe: 'shipping-v1', origin: 'https://example.com', automatic_tax: false, stripe_account_id: 'acct_test', livemode: false };
  const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.jwt() returns jsonb language sql as $f$ select '{}'::jsonb $f$;
      grant usage on schema auth to authenticated;
      create table public.products(id text primary key, name text, category text, quantity integer,
        price numeric(10,2), made_to_order boolean default false, price_varies boolean default false,
        requires_color boolean default false, custom_options jsonb default '[]');
      insert into public.products(id,name,category,quantity,price) values
        ('mini','Small animal','2_dollar_minis',30,2), ('dragon','Crystal Dragon','Dragons_and_Animals',10,15),
        ('ball','Pokeball','Pokeballs',10,10), ('fidget','Fidget','Fidgets',10,5),
        ('unknown','Unmeasured item','Seasonal',10,7);
    `);
    await db.exec(file('orders_schema.sql'));
    await db.exec(file('stripe_pickup.sql'));
    await db.exec(file('stripe_shipping.sql'));
    await db.exec(file('stripe_shipping.sql')); // reruns preserve estimates and eligibility
    const defaults = (await db.query('select id,shipping_weight_oz,shipping_mode from public.products order by id')).rows;
    assert.equal(Number(defaults.find(p => p.id === 'dragon').shipping_weight_oz), 5);
    assert.equal(Number(defaults.find(p => p.id === 'mini').shipping_weight_oz), 1);
    assert.equal(defaults.find(p => p.id === 'unknown').shipping_weight_oz, null);
    assert.ok(defaults.every(p => p.shipping_mode === 'quote'));
    assert.ok((await call('shipping_quote', [[{ id: 'mini', quantity: 1 }]])).error);
    await db.exec("update public.products set shipping_mode='standard' where shipping_weight_oz is not null");
    for (const [item, quantity, expectedWeight, expectedCents] of [
      ['dragon', 1, 12, 1000], ['ball', 1, 15, 1000], ['ball', 2, 23, 1300],
      ['mini', 9, 16, 1000], ['mini', 10, 17, 1300], ['ball', 3, 31, 1300]
    ]) {
      const quote = await call('shipping_quote', [[{ id: item, quantity }]]);
      assert.equal(Number(quote.packed_oz), expectedWeight);
      assert.equal(quote.shipping_cents, expectedCents);
    }
    assert.ok((await call('shipping_quote', [[{ id: 'ball', quantity: 4 }]])).error);
    assert.ok((await call('shipping_quote', [[{ id: 'unknown', quantity: 1 }]])).error);
    const requested = [{ id: 'dragon', quantity: 1 }, { id: 'mini', quantity: 1, cents: 1 }];
    const hold = await call('reserve_shipping_checkout', [id(1), requested, customer, config]);
    assert.equal(await stock('dragon'), 9);
    assert.equal(hold.items.find(p => p.id === 'mini').cents, 200);
    await db.exec("update public.products set price=99, shipping_weight_oz=6 where id='dragon'");
    const again = await call('reserve_shipping_checkout', [id(1), requested, customer, { ...config, automatic_tax: true }]);
    assert.equal(await stock('dragon'), 9);
    assert.deepEqual(again.items, hold.items);
    assert.equal(again.checkout_config.automatic_tax, false);
    const subtotal = hold.items.reduce((sum, p) => sum + p.cents * p.quantity, 0);
    assert.deepEqual(await call('finish_shipping_checkout', [id(1), 'cs_first', true, subtotal, 1300, 0, subtotal + 1300, 'usd', true]), { ok: false });
    assert.deepEqual(await call('record_shipping_session', [id(1), 'cs_first', 'https://checkout.stripe.com/test']), { ok: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.deepEqual(await call('finish_shipping_checkout', [id(1), 'cs_first', true, subtotal, 1000, 123, subtotal + 1123, 'usd', true]), { ok: true });
    }
    const orders = (await db.query('select * from public.orders')).rows;
    assert.equal(orders.length, 2);
    assert.equal(orders.reduce((sum, o) => sum + Number(o.shipping_amount), 0), 10);
    assert.equal(orders.reduce((sum, o) => sum + Number(o.tax_amount), 0), 1.23);
    assert.match(orders[0].notes, /TEST.*Ship to:.*123 Test St.*28150/);
    assert.equal(await stock('dragon'), 9);
    // One stock return, even when Stripe retries the expiry event.
    await call('reserve_shipping_checkout', [id(2), [{ id: 'ball', quantity: 2 }], customer, config]);
    assert.equal(await stock('ball'), 8);
    for (let attempt = 0; attempt < 2; attempt++) await call('finish_shipping_checkout', [id(2), 'cs_expired', false, null, null, null, null, null, true]);
    assert.equal(await stock('ball'), 10);
    // Failed baskets do not partly deduct stock.
    assert.ok((await call('reserve_shipping_checkout', [id(3), [{ id: 'mini', quantity: 1 }, { id: 'unknown', quantity: 1 }], customer, config])).error);
    assert.equal(await stock('mini'), 29);
    await db.exec("update public.products set quantity=1 where id='fidget'");
    await call('reserve_shipping_checkout', [id(4), [{ id: 'fidget', quantity: 1 }], customer, config]);
    assert.ok((await call('reserve_shipping_checkout', [id(5), [{ id: 'fidget', quantity: 1 }], customer, config])).error);
    assert.equal(await stock('fidget'), 0);
    // Recovery cannot release fresh, paid, or linked reservations.
    assert.deepEqual(await call('release_unlinked_checkout', [id(4), 'shipping']), { ok: false });
    await db.query('update public.shipping_checkouts set expires_at=$1 where id=$2', [Math.floor(Date.now()/1000)-3600, id(4)]);
    assert.deepEqual(await call('release_unlinked_checkout', [id(4), 'shipping']), { ok: true });
    assert.deepEqual(await call('release_unlinked_checkout', [id(4), 'shipping']), { ok: false });
    assert.equal(await stock('fidget'), 1);
    assert.deepEqual(await call('release_unlinked_checkout', [id(1), 'shipping']), { ok: false });
    // Public clients cannot read customer addresses or invoke reservation/recovery functions.
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.shipping_checkouts'), /permission denied/);
    await assert.rejects(call('shipping_quote', [[{ id: 'mini', quantity: 1 }]]), /permission denied/);
    await assert.rejects(call('release_unlinked_checkout', [id(4), 'shipping']), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});
