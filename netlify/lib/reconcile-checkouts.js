const { rpc } = require('./checkout');
const { stripeRequest } = require('./stripe');
const { finalizeSession } = require('./finalize-checkout');

async function matchingSessions(hold, kind) {
  const field = kind === 'shipping' ? 'shipping_reservation_id' : 'reservation_id';
  if (hold.stripe_session) {
    const session = await stripeRequest(`checkout/sessions/${encodeURIComponent(hold.stripe_session)}`);
    if (session.metadata?.[field] !== hold.id) throw new Error('Session metadata does not match the reservation');
    return [session];
  }
  const query = new URLSearchParams({ limit: '100', 'created[gte]': String(hold.expires_at - 3000),
    'created[lte]': String(hold.expires_at + 300) });
  const matches = [];
  for (let page = 0; page < 10; page++) {
    const result = await stripeRequest(`checkout/sessions?${query}`);
    if (!Array.isArray(result.data) || typeof result.has_more !== 'boolean') throw new Error('Incomplete Stripe session list');
    matches.push(...result.data.filter(session => session.metadata?.[field] === hold.id));
    if (!result.has_more) return matches;
    if (!result.data.length) throw new Error('Incomplete Stripe pagination');
    query.set('starting_after', result.data[result.data.length - 1].id);
  }
  throw new Error('Too many sessions to verify safely; review in Stripe');
}

async function reconcileHold(hold, kind) {
  // Grace period also prevents a delayed session-creation response from racing cleanup.
  if (hold.expires_at >= Math.floor(Date.now() / 1000) - 900) return 'Still within the reservation period';
  if (kind === 'shipping') {
    const account = await stripeRequest('account');
    const live = /^[sr]k_live_/.test(process.env.STRIPE_SECRET_KEY.trim());
    if (!hold.checkout_config || hold.checkout_config.stripe_account_id !== account.id || hold.checkout_config.livemode !== live) {
      throw new Error('Reservation belongs to a different Stripe account or mode');
    }
  } else if (!hold.stripe_session && !/^[sr]k_test_/.test(process.env.STRIPE_SECRET_KEY.trim())) {
    // Older pickup records did not store the account/mode. Never infer absence using live keys.
    throw new Error('Unlinked legacy pickup reservations require manual review outside test mode');
  }
  const sessions = await matchingSessions(hold, kind);
  const closed = [];
  for (let session of sessions) {
    if (session.status === 'open') {
      try {
        session = await stripeRequest(`checkout/sessions/${encodeURIComponent(session.id)}/expire`, { method: 'POST' });
      } catch (error) {
        if (error.status !== 400) throw error;
        session = await stripeRequest(`checkout/sessions/${encodeURIComponent(session.id)}`);
      }
    }
    closed.push(session);
  }
  const paid = closed.filter(session => session.payment_status === 'paid');
  if (paid.length > 1 || closed.some(session => session.payment_status !== 'paid' && session.status !== 'expired')) {
    throw new Error('Review these sessions in Stripe before adjusting stock');
  }
  if (closed.length) {
    const session = paid[0] || closed[0];
    const result = await finalizeSession(session, kind);
    if (!result.ok) throw new Error('The reservation could not be finalized; review in Stripe');
    return paid.length ? 'Paid order recorded; stock kept deducted' : 'Expired unpaid checkout; stock restored';
  }
  const result = await rpc('release_unlinked_checkout', { request_id: hold.id, kind });
  if (!result.ok) return 'Reservation changed; no adjustment made';
  return 'No matching Stripe session found; expired reservation stock restored';
}

module.exports = { matchingSessions, reconcileHold };
