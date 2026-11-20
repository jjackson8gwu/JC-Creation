const { json, database } = require('../lib/checkout');
const { reconcileHold } = require('../lib/reconcile-checkouts');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });
  const authorization = event.headers?.authorization || event.headers?.Authorization || '';
  if (!/^Bearer \S+$/.test(authorization)) return json(401, { error: 'Sign into the website admin first.' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.STRIPE_SECRET_KEY) {
    return json(503, { error: 'Checkout recovery is not configured.' });
  }
  try {
    const response = await fetch(`${process.env.SUPABASE_URL.trim().replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_KEY.trim(), Authorization: authorization }
    });
    if (!response.ok) return json(401, { error: 'Sign in again, then retry.' });
    const user = await response.json();
    if (user.app_metadata?.jcc_admin !== true) return json(403, { error: 'Store admin access is required.' });
    const cutoff = Math.floor(Date.now() / 1000) - 900;
    const report = [];
    // At most 20 holds per click; repeat if more remain. Each hold is checked independently.
    for (const [kind, table] of [['pickup', 'pickup_checkouts'], ['shipping', 'shipping_checkouts']]) {
      const columns = `id,expires_at,stripe_session${kind === 'shipping' ? ',checkout_config' : ''}`;
      const holds = await database(`${table}?state=eq.held&expires_at=lt.${cutoff}&select=${columns}&order=expires_at.asc&limit=10`);
      for (const hold of holds) {
        try { report.push({ id: hold.id, kind, result: await reconcileHold(hold, kind) }); }
        catch { report.push({ id: hold.id, kind, result: 'Could not verify safely; no automatic release. Review in Stripe.' }); }
      }
    }
    return json(200, { report });
  } catch {
    return json(502, { error: 'Could not finish the reservation check. Refresh inventory before retrying. Confirm the shipping SQL setup was applied.' });
  }
};
