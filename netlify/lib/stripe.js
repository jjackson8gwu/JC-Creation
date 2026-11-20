async function stripeRequest(path, { method = 'GET', params, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY.trim()}`,
    'Stripe-Version': '2026-10-28.endive' };
  if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers, body: params,
    signal: AbortSignal.timeout(8000) });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error('Stripe request failed');
    error.status = response.status;
    const safe = value => typeof value === 'string' && /^[a-z_]{1,80}$/.test(value) &&
      !/(?:sk_|rk_|pk_|whsec_|sb_secret_)/.test(value) ? value : undefined;
    error.code = safe(body?.error?.code);
    error.type = safe(body?.error?.type);
    const param = body?.error?.param;
    error.param = typeof param === 'string' && /^[a-z0-9_\[\]]{1,150}$/.test(param) &&
      !/(?:sk_|rk_|pk_|whsec_|sb_secret_)/.test(param) ? param : undefined;
    const reference = response.headers?.get('request-id');
    error.requestId = typeof reference === 'string' && /^req_[a-zA-Z0-9]{1,80}$/.test(reference) ? reference : undefined;
    throw error;
  }
  return body;
}

module.exports = { stripeRequest };
