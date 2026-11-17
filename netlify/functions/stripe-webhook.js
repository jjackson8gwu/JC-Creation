const { createHmac, timingSafeEqual } = require('node:crypto');
const { json, rpc } = require('../lib/checkout');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json(503, { error: 'Webhook unavailable' });
  const raw = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8');
  const header = event.headers['stripe-signature'] || '';
  const parts = header.split(',').map(part => part.trim().split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  if (!/^\d+$/.test(timestamp || '') || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return json(400, { error: 'Invalid webhook signature' });
  }
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest();
  if (!parts.some(([key, value]) => key === 'v1' && /^[a-f0-9]{64}$/i.test(value || '') &&
      timingSafeEqual(expected, Buffer.from(value, 'hex')))) {
    return json(400, { error: 'Invalid webhook signature' });
  }
  try {
    const notice = JSON.parse(raw.toString('utf8'));
    const session = notice.data.object;
    const id = session.metadata?.reservation_id;
    if (!id) return json(200, { received: true });
    const paid = notice.type === 'checkout.session.completed' && session.payment_status === 'paid';
    const expired = notice.type === 'checkout.session.expired';
    if (paid || expired) {
      const result = await rpc('finish_pickup_checkout', {
        request_id: id, stripe_session: session.id, is_paid: paid,
        subtotal: session.amount_subtotal, currency: session.currency,
        buyer_name: session.customer_details?.name || 'Online customer',
        buyer_email: session.customer_details?.email || '', test_mode: !notice.livemode
      });
      if (!result.ok) throw new Error('Checkout not finalized');
    }
    return json(200, { received: true });
  } catch {
    return json(500, { error: 'Could not finalize checkout' });
  }
};
