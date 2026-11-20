import checkout from '../lib/checkout.js';
import recovery from '../lib/reconcile-checkouts.js';
import stripe from '../lib/stripe.js';

// Netlify invokes this on published deploys. It has no public HTTP endpoint.
export const config = { schedule: '@hourly' };

export default async () => {
  if (process.env.STRIPE_SHIPPING_ENABLED !== 'true' || !process.env.STRIPE_SECRET_KEY ||
      !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return;
  const account = await stripe.stripeRequest('account');
  const mode = /^[sr]k_(test|live)_/.exec(process.env.STRIPE_SECRET_KEY.trim())?.[1];
  if (!mode || !/^acct_[a-zA-Z0-9]+$/.test(account.id)) throw new Error('Could not identify the Stripe account');
  const cutoff = Math.floor(Date.now() / 1000) - 900;
  const holds = await checkout.database(`shipping_checkouts?state=eq.held&expires_at=lt.${cutoff}` +
    `&checkout_config->>stripe_account_id=eq.${account.id}&checkout_config->>livemode=eq.${mode === 'live'}` +
    '&select=id,expires_at,stripe_session,checkout_config&order=expires_at.asc&limit=5');
  for (const hold of holds) {
    try { console.log('Shipping recovery:', hold.id, await recovery.reconcileHold(hold, 'shipping')); }
    catch { console.error('Shipping recovery needs admin review:', hold.id); }
  }
};
