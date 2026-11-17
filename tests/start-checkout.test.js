const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/start-checkout');

test('checkout reports safe Stripe diagnostics only on the test preview', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const originalError = console.error;
  const logs = [];
  Object.assign(process.env, {
    STRIPE_SECRET_KEY: ' sk_test_private_value ', STRIPE_WEBHOOK_SECRET: 'whsec_private',
    STRIPE_CHECKOUT_ORIGIN: 'https://deploy-preview-2--jccreations.netlify.app',
    STRIPE_PICKUP_ENABLED: 'true', STRIPE_PICKUP_PRODUCTS: 'frog',
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'sb_secret_private'
  });
  console.error = (...args) => logs.push(args);
  let stripeError;
  let status;
  global.fetch = async (url, options) => {
    if (url.includes('/rest/v1/rpc/')) return {
      ok: true, json: async () => ({ items: [{ name: 'Frog', quantity: 1, cents: 500 }],
        expires_at: Math.floor(Date.now() / 1000) + 2700 })
    };
    assert.equal(options.headers.Authorization, 'Bearer sk_test_private_value');
    return { ok: false, status, headers: new Headers({ 'request-id': 'req_example123' }),
      json: async () => ({ error: stripeError }) };
  };
  const event = {
    httpMethod: 'POST', rawUrl: 'https://deploy-preview-2--jccreations.netlify.app/.netlify/functions/start-checkout',
    body: JSON.stringify({ requestId: '11111111-1111-4111-8111-111111111111', items: [{ id: 'frog', quantity: 1 }] })
  };
  try {
    status = 401;
    stripeError = { type: 'invalid_request_error', message: 'Invalid API Key provided: sk_test_private_value' };
    let result = await handler(event);
    assert.equal(result.statusCode, 502);
    assert.match(result.body, /HTTP 401/);
    assert.match(result.body, /STRIPE_SECRET_KEY/);
    assert.match(result.body, /req_example123/);
    assert.doesNotMatch(result.body, /sk_test_private_value/);
    status = 400;
    stripeError = { type: 'invalid_request_error', param: 'expires_at', code: 'parameter_invalid_integer' };
    result = await handler(event);
    assert.match(result.body, /field expires_at/);
    assert.match(result.body, /code correction/);
    result = await handler({ ...event, rawUrl: 'https://www.jccreations.xyz/.netlify/functions/start-checkout' });
    assert.equal(JSON.parse(result.body).error, 'Checkout could not start. Retry this checkout or contact us.');
    stripeError = { type: 'sk_test_private_value', param: 'sk_test_private_value!', message: 'sk_test_private_value' };
    result = await handler(event);
    assert.doesNotMatch(result.body, /sk_test_private_value/);
    assert.doesNotMatch(JSON.stringify(logs), /sk_test_private_value/);
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
    console.error = originalError;
  }
});
