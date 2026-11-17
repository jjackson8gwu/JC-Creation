const { json, rpc } = require('../lib/checkout');

// Stripe messages can echo submitted values, including a rejected API key.
// Expose only constrained identifiers and explanations written here.
function stripeFailure(response, session) {
  const error = session?.error || {};
  const isSecret = value => /(?:sk_|rk_|pk_|whsec_|sb_secret_)/.test(value);
  const token = value => typeof value === 'string' && /^[a-z_]{1,80}$/.test(value) && !isSecret(value) ? value : undefined;
  const param = typeof error.param === 'string' && /^[a-z0-9_\[\]]{1,150}$/.test(error.param) && !isSecret(error.param)
    ? error.param : undefined;
  const reference = response.headers?.get('request-id');
  const request = typeof reference === 'string' && /^req_[a-zA-Z0-9]{1,80}$/.test(reference)
    ? reference : undefined;
  let hint;
  if (response.status === 401 || error.code === 'api_key_expired' || error.code === 'secret_key_required') {
    hint = 'Check STRIPE_SECRET_KEY in Netlify: use the Stripe sandbox secret key, then redeploy the preview.';
  } else if (response.status === 403) {
    hint = 'The Stripe key or account does not have permission to create Checkout Sessions. Check the failed request in Stripe.';
  } else if (param === 'expires_at') {
    hint = 'Stripe rejected the checkout expiration time. This needs a checkout code correction.';
  } else if (error.code === 'stripe_tax_inactive' || /activate.*stripe tax|stripe tax.*activat/i.test(error.message || '')) {
    hint = 'Automatic tax requires Stripe Tax setup. Check STRIPE_AUTOMATIC_TAX and your Stripe Tax settings.';
  } else if (/business name|account name|business profile/i.test(error.message || '')) {
    hint = 'Stripe requires business profile information. Open the failed request in Stripe for the exact account field.';
  } else if (error.code === 'amount_too_small') {
    hint = 'The order total is below Stripe\'s minimum payment amount.';
  }
  return { status: response.status, type: token(error.type), code: token(error.code), param, request, hint };
}

exports.handler = async (event) => {
  const { STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: webhook, STRIPE_CHECKOUT_ORIGIN: origin,
    STRIPE_PICKUP_PRODUCTS: products, STRIPE_PICKUP_ENABLED: enabled } = process.env;
  const missing = Object.entries({
    STRIPE_SECRET_KEY: key,
    STRIPE_WEBHOOK_SECRET: webhook,
    STRIPE_CHECKOUT_ORIGIN: origin,
    STRIPE_PICKUP_PRODUCTS: products,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY
  }).filter(([, value]) => !value).map(([name]) => name);
  const enabledExactly = enabled === 'true';
  const available = enabledExactly && missing.length === 0;
  const preview = event.rawUrl?.startsWith('https://deploy-preview-2--jccreations.netlify.app/');
  if (event.httpMethod === 'GET') {
    if (!available && preview) {
      const problems = [...missing];
      if (!enabledExactly) problems.push('STRIPE_PICKUP_ENABLED must be exactly true');
      console.warn('Checkout preview configuration:', problems.join(', '));
      return json(200, { available, configurationIssues: problems });
    }
    return json(200, { available });
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });
  if (!available) return json(503, { error: 'Online checkout is currently unavailable.' });

  let stage = 'checkout request';
  try {
    const { items, requestId } = JSON.parse(event.body || '{}');
    const allowed = new Set(products.split(',').map(id => id.trim()));
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId || '') || !Array.isArray(items) ||
        items.length < 1 || items.length > 25 ||
        items.some(item => !item || !allowed.has(item.id) ||
          !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20)) {
      return json(400, { error: 'One or more items require an order request. Use Submit Order instead.' });
    }
    stage = 'checkout origin';
    const returnUrl = new URL('/order/', origin);
    if (returnUrl.protocol !== 'https:') throw new Error('Checkout requires HTTPS');
    stage = 'Supabase inventory reservation';
    const reservation = await rpc('reserve_pickup_checkout', {
      request_id: requestId, requested: items.map(({ id, quantity }) => ({ id, quantity }))
    });
    if (reservation.error) return json(409, { error: reservation.error });
    stage = 'Stripe session creation';
    const params = new URLSearchParams({
      mode: 'payment', 'allowed_payment_method_types[0]': 'card',
      success_url: `${returnUrl}?checkout=returned`, cancel_url: `${returnUrl}?checkout=canceled`,
      'metadata[reservation_id]': requestId, expires_at: String(reservation.expires_at),
      'automatic_tax[enabled]': process.env.STRIPE_AUTOMATIC_TAX === 'true' ? 'true' : 'false',
      'billing_address_collection': 'required'
    });
    reservation.items.forEach((item, index) => {
      const prefix = `line_items[${index}]`;
      params.set(`${prefix}[quantity]`, item.quantity);
      params.set(`${prefix}[price_data][currency]`, 'usd');
      params.set(`${prefix}[price_data][unit_amount]`, item.cents);
      params.set(`${prefix}[price_data][product_data][name]`, item.name);
    });
    const sendSession = async (body, idempotencyKey, version = '2026-10-28.endive') => {
      const headers = { Authorization: `Bearer ${key.trim()}`, 'Idempotency-Key': idempotencyKey,
        'Content-Type': 'application/x-www-form-urlencoded' };
      if (version) headers['Stripe-Version'] = version;
      const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST', headers, body
      });
      return { response, session: await response.json() };
    };
    let { response, session } = await sendSession(params, requestId);
    if (session?.error?.type === 'idempotency_error') {
      // Replay the pre-Endive request before issuing a replacement. If it actually
      // created a session, reuse that session rather than creating a second one.
      const legacyParams = new URLSearchParams(params);
      legacyParams.delete('allowed_payment_method_types[0]');
      legacyParams.set('payment_method_types[0]', 'card');
      const legacy = await sendSession(legacyParams, requestId, null);
      if (legacy.response.ok && legacy.session.url) {
        return json(200, { url: legacy.session.url });
      }
      // Only the known, definitive rejection of the removed field is safe to
      // replace. Keep the inventory reservation and a stable replacement key.
      if (legacy.response.status === 400 && legacy.session?.error?.type === 'invalid_request_error' &&
          legacy.session.error.param === 'payment_method_types') {
        ({ response, session } = await sendSession(params, `${requestId}:endive-v1`));
      }
    }
    if (!response.ok || !session.url) {
      const failure = stripeFailure(response, session);
      console.error('Stripe session creation failed', requestId, failure);
      const message = 'Checkout could not start. Retry this checkout or contact us.';
      const detail = ['Stripe', `HTTP ${failure.status}`, failure.type, failure.code,
        failure.param && `field ${failure.param}`, failure.request].filter(Boolean).join(' · ');
      return json(502, { error: preview
        ? `${message} [${detail}]${failure.hint ? ` ${failure.hint}` : ''}` : message });
    }
    return json(200, { url: session.url });
  } catch (error) {
    const detail = [stage, error.status && `HTTP ${error.status}`, error.code].filter(Boolean).join(' · ');
    console.error('Checkout failed:', detail);
    const message = 'Checkout could not start. Please try again or contact us.';
    return json(500, { error: preview ? `${message} [${detail}]` : message });
  }
};
