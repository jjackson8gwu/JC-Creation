const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body)
});

async function database(path, { method = 'GET', body } = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY.trim();
  const base = process.env.SUPABASE_URL.trim().replace(/\/+$/, '');
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = new Error('Checkout database request failed');
    error.status = response.status;
    if (typeof body?.code === 'string' && /^(?:PGRST\d{3}|[0-9A-Z]{5})$/.test(body.code)) {
      error.code = body.code;
    }
    throw error;
  }
  return response.json();
}

const rpc = (name, data) => database(`rpc/${name}`, { method: 'POST', body: data });
module.exports = { json, rpc, database };
