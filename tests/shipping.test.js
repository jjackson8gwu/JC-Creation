const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCustomer, parseItems, sessionParams } = require('../netlify/lib/shipping');
const { handler } = require('../netlify/functions/shipping-checkout');
const { reconcileHold } = require('../netlify/lib/reconcile-checkouts');
const { createHmac } = require('node:crypto');
const webhook = require('../netlify/functions/stripe-webhook').handler;
const recoveryEndpoint = require('../netlify/functions/reconcile-checkouts').handler;

const customer = { name: 'Test buyer', email: 'Buyer@example.com', phone: '5551234567', address: {
  line1: '123 Test St', line2: 'Unit 2', city: 'Shelby', state: 'North Carolina', postal_code: '28150', country: 'US'
} };
const requestId = '11111111-1111-4111-8111-111111111111';
const hold = { id: requestId, customer: parseCustomer(customer), items: [{ id: 'dragon', name: 'Dragon', cents: 1500, quantity: 1 }],
  shipping_cents: 1000, packed_oz: 12, expires_at: Math.floor(Date.now()/1000) + 2700,
  checkout_config: { origin: 'https://example.com', automatic_tax: false, stripe_account_id: 'acct_test', livemode: false } };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status,
  headers: new Headers(), json: async () => body });

test('shipping validates addresses and uses immutable server-side amounts', () => {
  assert.equal(parseCustomer(customer).address.state, 'NC');
  assert.equal(parseCustomer(customer).email, 'buyer@example.com');
  for (const [state, zip] of [['AK','99501'],['HI','96813'],['PR','00901'],['AE','09012'],['NC','96701'],['NC','00000']]) {
    assert.throws(() => parseCustomer({ ...customer, address: { ...customer.address, state, postal_code: zip } }), /contiguous/);
  }
  assert.throws(() => parseCustomer({ ...customer, address: { ...customer.address, country: 'CA' } }), /contiguous/);
  assert.throws(() => parseCustomer({ ...customer, address: { ...customer.address, line1: 'x'.repeat(151) } }), /too long/);
  assert.deepEqual(parseItems([{ id: 'b', quantity: 1, cents: 1 }, { id: 'a', quantity: 1 }, { id: 'a', quantity: 2 }]),
    [{ id: 'a', quantity: 3 }, { id: 'b', quantity: 1 }]);
  assert.throws(() => parseItems([{ id: 'a', quantity: 20 }, { id: 'a', quantity: 1 }]), /larger quantities/);
  const params = sessionParams(hold, 'cus_test');
  assert.equal(params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'), '1000');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '1500');
  assert.equal(params.get('payment_intent_data[shipping][address][state]'), 'NC');
  assert.equal(params.has('shipping_address_collection[allowed_countries][0]'), false); // fixed validated destination
  assert.match(params.get('custom_text[submit][message]'), /123 Test St/);
});

test('shipping endpoint quotes without reserving and creates retry-safe Checkout', async () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_KEY: 'sb_secret_test',
    STRIPE_SECRET_KEY: 'sk_test_private', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_CHECKOUT_ORIGIN: 'https://example.com',
    STRIPE_SHIPPING_ENABLED: 'true', STRIPE_AUTOMATIC_TAX: 'false' });
  const calls = [];
  let existing = false;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/rpc/shipping_quote')) return response({ items: hold.items, shipping_cents: 1000, packed_oz: 12 });
    if (url.endsWith('/account')) return response({ id: 'acct_test' });
    if (url.endsWith('/rpc/reserve_shipping_checkout')) {
      const body = JSON.parse(options.body);
      assert.equal(body.requested[0].cents, undefined);
      assert.equal(body.customer.address.state, 'NC');
      return response(existing ? { ...hold, session_url: 'https://checkout.stripe.com/existing' } : hold);
    }
    if (url.endsWith('/customers')) {
      assert.equal(options.headers['Idempotency-Key'], `shipping-v1:${requestId}:customer`);
      assert.equal(options.body.get('shipping[address][postal_code]'), '28150');
      return response({ id: 'cus_test' });
    }
    if (url.endsWith('/checkout/sessions')) {
      assert.equal(options.headers['Idempotency-Key'], `shipping-v1:${requestId}:session`);
      assert.equal(options.headers['Stripe-Version'], '2026-10-28.endive');
      assert.equal(options.body.get('allowed_payment_method_types[0]'), 'card');
      return response({ id: 'cs_test', url: 'https://checkout.stripe.com/new' });
    }
    if (url.endsWith('/rpc/record_shipping_session')) return response({ ok: true });
    throw new Error(`Unexpected call: ${url}`);
  };
  const event = body => ({ httpMethod: 'POST', body: JSON.stringify(body) });
  try {
    let result = await handler(event({ action: 'quote', items: [{ id: 'dragon', quantity: 1 }] }));
    assert.equal(JSON.parse(result.body).shippingCents, 1000);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith('shipping_quote'));
    calls.length = 0;
    const input = { action: 'checkout', requestId, customer, items: [{ id: 'dragon', quantity: 1, cents: 1, weight: 0 }] };
    result = await handler(event(input));
    assert.equal(JSON.parse(result.body).url, 'https://checkout.stripe.com/new');
    assert.equal(calls.length, 5);
    existing = true;
    calls.length = 0;
    result = await handler(event(input));
    assert.equal(JSON.parse(result.body).url, 'https://checkout.stripe.com/existing');
    assert.equal(calls.filter(call => call.url.endsWith('/checkout/sessions')).length, 0);
    calls.length = 0;
    result = await handler(event({ ...input, customer: { ...customer, address: { ...customer.address, state: 'HI' } } }));
    assert.equal(result.statusCode, 400);
    assert.equal(calls.length, 0);
    process.env.STRIPE_SHIPPING_ENABLED = 'false';
    assert.equal(JSON.parse((await handler({ httpMethod: 'GET' })).body).available, false);
    assert.equal((await handler(event(input))).statusCode, 503);
  } finally { global.fetch = originalFetch; process.env = originalEnv; }
});

test('signed shipping webhook validates completion and ignores invalid signatures', async () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_KEY: 'sb_secret_test', STRIPE_WEBHOOK_SECRET: 'whsec_test' });
  const calls = [];
  global.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return response({ ok: true }); };
  const session = { id: 'cs_test', status: 'complete', payment_status: 'paid', metadata: { shipping_reservation_id: requestId },
    amount_subtotal: 1500, amount_total: 2700, total_details: { amount_shipping: 1000, amount_tax: 200 }, currency: 'usd' };
  const event = type => {
    const body = JSON.stringify({ type, livemode: false, data: { object: session } });
    const time = Math.floor(Date.now()/1000);
    const signature = createHmac('sha256', 'whsec_test').update(`${time}.${body}`).digest('hex');
    return { httpMethod: 'POST', body, headers: { 'stripe-signature': `t=${time},v1=${signature}` } };
  };
  try {
    assert.equal((await webhook({ ...event('checkout.session.completed'), body: '{}' })).statusCode, 400);
    assert.equal(calls.length, 0);
    assert.equal((await webhook(event('checkout.session.completed'))).statusCode, 200);
    assert.ok(calls[0].url.endsWith('finish_shipping_checkout'));
    assert.equal(calls[0].body.shipping, 1000);
    assert.equal(calls[0].body.tax, 200);
    assert.equal(calls[0].body.test_mode, true);
    session.status = 'expired'; session.payment_status = 'unpaid';
    assert.equal((await webhook(event('checkout.session.expired'))).statusCode, 200);
    assert.equal(calls[1].body.is_paid, false);
    session.metadata = { reservation_id: requestId };
    assert.equal((await webhook(event('checkout.session.expired'))).statusCode, 200);
    assert.ok(calls[2].url.endsWith('finish_pickup_checkout'));
  } finally { global.fetch = originalFetch; process.env = originalEnv; }
});

test('recovery verifies all Stripe pages, preserves paid stock and refuses ambiguous results', async () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  process.env.STRIPE_SECRET_KEY = 'sk_test_private';
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'sb_secret_test';
  const oldHold = { id: requestId, expires_at: Math.floor(Date.now()/1000) - 3600 };
  const closed = { id: 'cs_paid', metadata: { reservation_id: requestId }, status: 'complete', payment_status: 'paid',
    amount_subtotal: 1500, currency: 'usd', customer_details: { name: 'Buyer', email: 'buyer@example.com' }, livemode: false };
  let scenario = 'empty';
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/checkout/sessions?')) {
      if (scenario === 'failure') return response({ error: { type: 'api_error' } }, 500);
      if (scenario === 'pages' && !url.includes('starting_after')) return response({ data: [{ id: 'cs_other', metadata: {} }], has_more: true });
      if (scenario === 'paid' || scenario === 'pages') return response({ data: [closed], has_more: false });
      if (scenario === 'double') return response({ data: [closed, { ...closed, id: 'cs_otherpaid' }], has_more: false });
      return response({ data: [], has_more: false });
    }
    if (url.includes('/rpc/')) return response({ ok: true });
    throw new Error(`Unexpected call ${url}`);
  };
  try {
    assert.match(await reconcileHold(oldHold, 'pickup'), /stock restored/);
    assert.ok(calls.at(-1).url.endsWith('release_unlinked_checkout'));
    for (const choice of ['paid', 'pages']) {
      scenario = choice; calls.length = 0;
      assert.match(await reconcileHold(oldHold, 'pickup'), /Paid order recorded/);
      assert.ok(calls.at(-1).url.endsWith('finish_pickup_checkout'));
      assert.equal(JSON.parse(calls.at(-1).options.body).is_paid, true);
      assert.equal(calls.some(call => call.url.endsWith('release_unlinked_checkout')), false);
    }
    for (const choice of ['failure', 'double']) {
      scenario = choice; calls.length = 0;
      await assert.rejects(reconcileHold(oldHold, 'pickup'));
      assert.equal(calls.some(call => call.url.includes('/rpc/')), false);
    }
    process.env.STRIPE_SECRET_KEY = 'sk_live_private'; calls.length = 0;
    await assert.rejects(reconcileHold(oldHold, 'pickup'), /manual review/);
    assert.equal(calls.length, 0);
  } finally { global.fetch = originalFetch; process.env = originalEnv; }
});

test('reservation recovery requires a verified admin, not just a supplied token', async () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_KEY: 'sb_secret_test', STRIPE_SECRET_KEY: 'sk_test_private' });
  let admin = false;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) return response({ app_metadata: { jcc_admin: admin } });
    assert.ok(url.includes('/rest/v1/'));
    return response([]);
  };
  try {
    assert.equal((await recoveryEndpoint({ httpMethod: 'POST', headers: {} })).statusCode, 401);
    assert.equal(calls.length, 0);
    const event = { httpMethod: 'POST', headers: { authorization: 'Bearer fixture-token' } };
    assert.equal((await recoveryEndpoint(event)).statusCode, 403);
    assert.equal(calls.length, 1);
    admin = true;
    assert.deepEqual(JSON.parse((await recoveryEndpoint(event)).body), { report: [] });
  } finally { global.fetch = originalFetch; process.env = originalEnv; }
});

test('scheduled shipping recovery limits itself to the configured account and mode', async () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const job = (await import('../netlify/functions/recover-shipping-checkouts.mjs')).default;
  Object.assign(process.env, { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_KEY: 'sb_secret_test',
    STRIPE_SECRET_KEY: 'sk_test_private', STRIPE_SHIPPING_ENABLED: 'false' });
  const calls = [];
  global.fetch = async url => { calls.push(url); return response(url.endsWith('/account') ? { id: 'acct_test' } : []); };
  try {
    await job();
    assert.equal(calls.length, 0);
    process.env.STRIPE_SHIPPING_ENABLED = 'true';
    await job();
    assert.equal(calls.length, 2);
    assert.match(calls[1], /stripe_account_id=eq.acct_test/);
    assert.match(calls[1], /livemode=eq.false/);
    assert.equal(calls.some(url => url.includes('pickup_checkouts')), false);
  } finally { global.fetch = originalFetch; process.env = originalEnv; }
});
