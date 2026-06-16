// ============================================================
// Netlify Function: update-inventory
// Called at checkout — decrements product quantities in Supabase.
// Env var required in Netlify site settings:
//   SUPABASE_SERVICE_KEY  — service role key (secret, never in client code)
// ============================================================

const https = require('https');

const SUPABASE_URL = 'https://ldgdubwptbxqrtjghxau.supabase.co';

// Promisified HTTPS request to Supabase REST API
function supabaseRequest(method, path, key, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'ldgdubwptbxqrtjghxau.supabase.co',
      path,
      method,
      headers: {
        'apikey':          key,
        'Authorization':   `Bearer ${key}`,
        'Content-Type':    'application/json',
        'Prefer':          'return=representation',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) {
    console.error('SUPABASE_SERVICE_KEY is not set.');
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Server configuration error.' }) };
  }

  let orderItems;
  try {
    const parsed = JSON.parse(event.body || '{}');
    orderItems = parsed.items;
    if (!Array.isArray(orderItems) || orderItems.length === 0) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'No items provided.' }) };
    }
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  const updated = [];
  const errors  = [];

  for (const item of orderItems) {
    const qty = item.quantity || 1;

    try {
      // 1. Fetch current quantity for this product (match by id, then by name)
      let fetchPath = `/rest/v1/products?select=id,name,quantity`;
      if (item.id) {
        fetchPath += `&id=eq.${encodeURIComponent(item.id)}&limit=1`;
      } else {
        fetchPath += `&name=ilike.${encodeURIComponent(item.name)}&limit=1`;
      }

      const fetchRes = await supabaseRequest('GET', fetchPath, key);
      if (fetchRes.status !== 200 || !fetchRes.body.length) {
        console.warn(`No product found for id="${item.id}" name="${item.name}"`);
        errors.push({ item: item.name || item.id, reason: 'not found' });
        continue;
      }

      const product   = fetchRes.body[0];
      const newQty    = Math.max(0, product.quantity - qty);

      // 2. PATCH new quantity
      const patchPath = `/rest/v1/products?id=eq.${encodeURIComponent(product.id)}`;
      const patchRes  = await supabaseRequest('PATCH', patchPath, key, { quantity: newQty });

      if (patchRes.status < 200 || patchRes.status >= 300) {
        throw new Error(`PATCH returned ${patchRes.status}`);
      }

      updated.push({ id: product.id, name: product.name, before: product.quantity, after: newQty });
      console.log(`${product.name}: ${product.quantity} → ${newQty}`);

    } catch (e) {
      console.error(`Failed to update "${item.name || item.id}":`, e.message);
      errors.push({ item: item.name || item.id, reason: e.message });
    }
  }

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({ success: true, updated, errors })
  };
};
