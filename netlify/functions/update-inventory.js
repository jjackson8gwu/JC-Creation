// Netlify Function: update-inventory
// Called at checkout to:
//   1. Reduce product quantities in products.json via GitHub API.
//   2. Notify the Google Apps Script Web App to reduce the same items in Google Sheets.
// Env vars required in Netlify site settings:
//   GITHUB_TOKEN  — GitHub personal access token with repo scope
//   SHEET_URL     — Google Apps Script Web App URL (optional; skipped if not set)

const https = require('https');

const GITHUB_OWNER = 'jjackson8gwu';
const GITHUB_REPO  = 'JC-Creation';
const FILE_PATH    = 'resources/products.json';

// Promisified HTTPS POST to an arbitrary URL (used for Apps Script notification).
// Follows up to 5 redirects (Google Apps Script may redirect on first call).
function httpsPost(url, payload, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const body   = JSON.stringify(payload);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || 443,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'JCCreations-Inventory-Bot'
      }
    };
    const req = https.request(options, res => {
      // Follow redirects (Apps Script sometimes issues a 302 on first POST)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume(); // drain the response
        const method = res.statusCode === 307 || res.statusCode === 308 ? 'POST' : 'POST';
        resolve(httpsPost(res.headers.location, payload, redirectsLeft - 1));
        return;
      }
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Promisified HTTPS request
function githubRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization':        `Bearer ${token}`,
        'Accept':               'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent':           'JCCreations-Inventory-Bot',
        'Content-Type':         'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN is not set in Netlify environment variables.');
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server configuration error — GITHUB_TOKEN missing.' }) };
  }

  let orderItems;
  try {
    const parsed = JSON.parse(event.body || '{}');
    orderItems = parsed.items;
    if (!Array.isArray(orderItems) || orderItems.length === 0) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'No items provided.' }) };
    }
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  // ── 1. Fetch current products.json from GitHub ──────────────────────────────
  let fileResult;
  try {
    fileResult = await githubRequest('GET', `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`, token);
    if (fileResult.status !== 200) {
      throw new Error(`GitHub GET returned ${fileResult.status}: ${JSON.stringify(fileResult.body)}`);
    }
  } catch (e) {
    console.error('Failed to fetch products.json:', e.message);
    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Could not read inventory file from GitHub.' }) };
  }

  // ── 2. Decode JSON, reduce quantities ─────────────────────────────────────
  let catalog;
  try {
    const decoded = Buffer.from(fileResult.body.content, 'base64').toString('utf8');
    catalog = JSON.parse(decoded);
  } catch (e) {
    console.error('Failed to parse products.json:', e.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Could not parse inventory file.' }) };
  }

  const updated = [];
  orderItems.forEach(orderItem => {
    const product = catalog.products.find(p =>
      (orderItem.id && p.id === orderItem.id) ||
      p.name.toLowerCase() === (orderItem.name || '').toLowerCase()
    );
    if (product) {
      const before = product.quantity;
      product.quantity = Math.max(0, product.quantity - (orderItem.quantity || 1));
      updated.push({ name: product.name, before, after: product.quantity });
      console.log(`Updated ${product.name}: ${before} → ${product.quantity}`);
    } else {
      console.warn(`No match for: id="${orderItem.id}" name="${orderItem.name}"`);
    }
  });

  if (updated.length === 0) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'No matching products — inventory unchanged.' }) };
  }

  // ── 3. Commit updated file back to GitHub ────────────────────────────────────
  const newContent = Buffer.from(JSON.stringify(catalog, null, 2)).toString('base64');
  const names      = updated.map(u => u.name).join(', ');

  try {
    const putResult = await githubRequest(
      'PUT',
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`,
      token,
      {
        message: `Auto-reduce inventory: ${names}`,
        content: newContent,
        sha:     fileResult.body.sha
      }
    );
    if (putResult.status !== 200 && putResult.status !== 201) {
      throw new Error(`GitHub PUT returned ${putResult.status}: ${JSON.stringify(putResult.body)}`);
    }
  } catch (e) {
    console.error('Failed to commit inventory update:', e.message);
    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Could not save inventory update to GitHub.' }) };
  }

  // ── 4. Notify Apps Script to reduce the same items in Google Sheets ────────
  const sheetUrl = process.env.SHEET_URL;
  if (sheetUrl) {
    try {
      // Send the original order items so the sheet can match by name and subtract qty
      const sheetItems = orderItems.map(item => ({
        name: item.name || (updated.find(u => u.id === item.id || u.name === item.name) || {}).name || '',
        quantity: item.quantity || 1
      }));
      const sheetRes = await httpsPost(sheetUrl, { items: sheetItems });
      console.log(`Apps Script notified — status ${sheetRes.status}: ${sheetRes.body.slice(0, 200)}`);
    } catch (e) {
      // Non-fatal: GitHub commit already succeeded, just log the sheet error
      console.warn('Could not notify Apps Script (sheet will sync on next hourly trigger):', e.message);
    }
  } else {
    console.log('SHEET_URL not configured — skipping Google Sheets notification.');
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ success: true, updated })
  };
};
