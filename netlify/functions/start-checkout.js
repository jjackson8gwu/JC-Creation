const { json, rpc } = require('../lib/checkout');

exports.handler = async (event) => {
  const { STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: webhook, STRIPE_CHECKOUT_ORIGIN: origin,
    STRIPE_PICKUP_PRODUCTS: products, STRIPE_PICKUP_ENABLED: enabled } = process.env;
  const available = enabled === 'true' && Boolean(key && webhook && origin && products &&
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
  if (event.httpMethod === 'GET') return json(200, { available });
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });
  if (!available) return json(503, { error: 'Online checkout is currently unavailable.' });

  try {
    const { items, requestId } = JSON.parse(event.body || '{}');
    const allowed = new Set(products.split(',').map(id => id.trim()));
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId || '') || !Array.isArray(items) ||
        items.length < 1 || items.length > 25 ||
        items.some(item => !item || !allowed.has(item.id) ||
          !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20)) {
      return json(400, { error: 'One or more items require an order request. Use Submit Order instead.' });
    }
    const returnUrl = new URL('/order/', origin);
    if (returnUrl.protocol !== 'https:') throw new Error('Checkout requires HTTPS');
    const reservation = await rpc('reserve_pickup_checkout', {
      request_id: requestId, requested: items.map(({ id, quantity }) => ({ id, quantity }))
    });
    if (reservation.error) return json(409, { error: reservation.error });
    const params = new URLSearchParams({
      mode: 'payment', 'payment_method_types[0]': 'card',
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
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Idempotency-Key': requestId,
        'Content-Type': 'application/x-www-form-urlencoded' }, body: params
    });
    const session = await response.json();
    if (!response.ok || !session.url) {
      console.error('Stripe session creation failed', requestId, response.status);
      return json(502, { error: 'Checkout could not start. Retry this checkout or contact us.' });
    }
    return json(200, { url: session.url });
  } catch {
    return json(500, { error: 'Checkout could not start. Please try again or contact us.' });
  }
};
