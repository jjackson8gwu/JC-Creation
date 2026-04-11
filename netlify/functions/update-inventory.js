// Netlify Function: update-inventory
// Called at checkout to reduce product quantities in products.json via GitHub API.
// Requires GITHUB_TOKEN environment variable set in Netlify site settings.

const GITHUB_OWNER = 'jjackson8gwu';
const GITHUB_REPO  = 'JC-Creation';
const FILE_PATH    = 'resources/products.json';
const API_BASE     = 'https://api.github.com';

exports.handler = async (event) => {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN environment variable is not set.');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
  }

  let orderItems;
  try {
    const body = JSON.parse(event.body || '{}');
    orderItems = body.items;
    if (!Array.isArray(orderItems) || orderItems.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No items provided.' }) };
    }
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept':        'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent':    'JCCreations-Inventory-Bot'
  };

  // ── 1. Fetch current products.json from GitHub ──────────────────────────────
  let fileData;
  try {
    const res = await fetch(`${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`, { headers });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`GitHub GET failed (${res.status}): ${msg}`);
    }
    fileData = await res.json();
  } catch (e) {
    console.error('Failed to fetch products.json from GitHub:', e.message);
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not read inventory file.' }) };
  }

  // ── 2. Decode, update quantities ─────────────────────────────────────────────
  let catalog;
  try {
    const decoded = Buffer.from(fileData.content, 'base64').toString('utf8');
    catalog = JSON.parse(decoded);
  } catch (e) {
    console.error('Failed to parse products.json:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not parse inventory file.' }) };
  }

  const updated = [];
  orderItems.forEach(orderItem => {
    // Match by id first, then fall back to name
    const product = catalog.products.find(p =>
      (orderItem.id && p.id === orderItem.id) ||
      p.name.toLowerCase() === (orderItem.name || '').toLowerCase()
    );
    if (product) {
      const before = product.quantity;
      product.quantity = Math.max(0, product.quantity - (orderItem.quantity || 1));
      updated.push({ name: product.name, before, after: product.quantity });
    } else {
      console.warn(`Product not found in catalog: id="${orderItem.id}" name="${orderItem.name}"`);
    }
  });

  if (updated.length === 0) {
    // Nothing matched — no point committing
    return { statusCode: 200, body: JSON.stringify({ message: 'No matching products found; inventory unchanged.' }) };
  }

  // ── 3. Commit updated file back to GitHub ────────────────────────────────────
  const newContent = Buffer.from(JSON.stringify(catalog, null, 2)).toString('base64');
  const commitMessage = `Auto-reduce inventory after order (${updated.map(u => u.name).join(', ')})`;

  try {
    const res = await fetch(
      `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`,
      {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: commitMessage,
          content: newContent,
          sha:     fileData.sha     // required by GitHub to prevent conflicts
        })
      }
    );
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`GitHub PUT failed (${res.status}): ${msg}`);
    }
  } catch (e) {
    console.error('Failed to commit updated products.json:', e.message);
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not save inventory update.' }) };
  }

  console.log('Inventory updated:', updated);
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, updated })
  };
};
