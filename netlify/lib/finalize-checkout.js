const { rpc } = require('./checkout');

async function finalizeSession(session, kind, live = session.livemode) {
  const paid = session.payment_status === 'paid';
  if (!paid && session.status !== 'expired') return { ok: false };
  if (kind === 'shipping') {
    return rpc('finish_shipping_checkout', {
      request_id: session.metadata.shipping_reservation_id, session_id: session.id, is_paid: paid,
      subtotal: session.amount_subtotal, shipping: session.total_details?.amount_shipping,
      tax: session.total_details?.amount_tax, total: session.amount_total,
      currency: session.currency, test_mode: !live
    });
  }
  return rpc('finish_pickup_checkout', {
    request_id: session.metadata.reservation_id, stripe_session: session.id, is_paid: paid,
    subtotal: session.amount_subtotal, currency: session.currency,
    buyer_name: session.customer_details?.name || 'Online customer',
    buyer_email: session.customer_details?.email || '', test_mode: !live
  });
}

module.exports = { finalizeSession };
