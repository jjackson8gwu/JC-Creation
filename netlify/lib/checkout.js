const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body)
});

async function rpc(name, data) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error('Checkout database request failed');
  return response.json();
}

module.exports = { json, rpc };
