const { json, rpc } = require('../lib/checkout');
const { stripeRequest } = require('../lib/stripe');
const { parseItems, parseCustomer, customerParams, sessionParams } = require('../lib/shipping');

exports.handler = async event => {
  const configured = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET', 'STRIPE_CHECKOUT_ORIGIN'].every(key => process.env[key]?.trim());
  const available = configured && process.env.STRIPE_SHIPPING_ENABLED === 'true';
  if (event.httpMethod === 'GET') return json(200, { available });
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });
  if (!available) return json(503, { error: 'Online shipping checkout is currently unavailable. Please submit an order request.' });
  let input, items, customer;
  try {
    input = JSON.parse(event.body || '{}');
    items = parseItems(input.items);
    if (!['quote', 'checkout'].includes(input.action)) throw new Error('Choose a shipping action.');
    if (input.action === 'checkout') {
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.requestId || '')) {
        throw new Error('Refresh the page and start checkout again.');
      }
      customer = parseCustomer(input.customer);
    }
  } catch (error) { return json(400, { error: error.message }); }
  let stage = 'shipping quote';
  try {
    if (input.action === 'quote') {
      const quote = await rpc('shipping_quote', { requested: items });
      if (quote.error) return json(409, { error: quote.error });
      return json(200, { shippingCents: quote.shipping_cents, packedOz: Number(quote.packed_oz),
        itemSubtotalCents: quote.items.reduce((sum, item) => sum + item.cents * item.quantity, 0) });
    }
    const origin = new URL(process.env.STRIPE_CHECKOUT_ORIGIN.trim());
    if (origin.protocol !== 'https:') throw new Error('HTTPS required');
    const mode = /^[sr]k_(test|live)_/.exec(process.env.STRIPE_SECRET_KEY.trim())?.[1];
    if (!mode) throw new Error('Stripe secret key required');
    stage = 'Stripe shipping account';
    const account = await stripeRequest('account');
    if (!/^acct_[a-zA-Z0-9]+$/.test(account.id || '')) throw new Error('Could not identify Stripe account');
    stage = 'shipping reservation';
    const hold = await rpc('reserve_shipping_checkout', {
      request_id: input.requestId, requested: items, customer,
      checkout_config: { recipe: 'shipping-v1', origin: origin.origin,
        stripe_account_id: account.id, livemode: mode === 'live',
        automatic_tax: process.env.STRIPE_AUTOMATIC_TAX === 'true' }
    });
    if (hold.error) return json(409, { error: hold.error });
    if (hold.checkout_config.stripe_account_id !== account.id || hold.checkout_config.livemode !== (mode === 'live')) {
      throw new Error('Reservation belongs to a different Stripe account or mode');
    }
    if (hold.session_url) return json(200, { url: hold.session_url });
    // All request values come from the saved snapshot, so retries survive price/settings changes.
    stage = 'Stripe shipping customer';
    const stripeCustomer = await stripeRequest('customers', { method: 'POST', params: customerParams(hold),
      idempotencyKey: `shipping-v1:${hold.id}:customer` });
    stage = 'Stripe shipping session';
    const session = await stripeRequest('checkout/sessions', { method: 'POST', params: sessionParams(hold, stripeCustomer.id),
      idempotencyKey: `shipping-v1:${hold.id}:session` });
    if (!session.url) throw new Error('Missing checkout URL');
    stage = 'saving shipping session';
    const saved = await rpc('record_shipping_session', { request_id: hold.id, session_id: session.id, url: session.url });
    if (!saved.ok) throw new Error('Session not recorded');
    return json(200, { url: session.url });
  } catch (error) {
    const detail = [stage, error.status && `HTTP ${error.status}`, error.type, error.code, error.param, error.requestId].filter(Boolean).join(' · ');
    console.error('Shipping checkout failed:', detail);
    const preview = event.rawUrl?.startsWith('https://deploy-preview-2--jccreations.netlify.app/');
    return json(502, { error: `Shipping checkout could not start. Please try again or submit an order request.${preview ? ` [${detail}]` : ''}` });
  }
};
