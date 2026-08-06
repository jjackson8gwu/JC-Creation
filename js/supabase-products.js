// ============================================================
// J&C Creations — Supabase product loader
// Loaded before script.js on every page.
// Exposes: window.loadCatalog() → Promise<{ products: [] }>
// ============================================================

(function () {
  const SUPABASE_URL = 'https://ldgdubwptbxqrtjghxau.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxkZ2R1YndwdGJ4cXJ0amdoeGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NjQ0MDgsImV4cCI6MjA5NzE0MDQwOH0.DjAaIinhAeWkrciogJa1Dv-_Sw4NrE-8BIBAOrwHrnk';
  const REST_URL     = `${SUPABASE_URL}/rest/v1/products`;

  // Map Supabase snake_case → camelCase to match the rest of script.js
  function mapRow(row) {
    return {
      id:             row.id,
      name:           row.name,
      description:    row.description   || '',
      price:          row.price          || 0,
      quantity:       row.quantity       || 0,
      category:       row.category       || '',
      requiresColor:  row.requires_color  || false,
      colorCount:     row.color_count     || 1,
      madeToOrder:    row.made_to_order   || false,
      priceVaries:    row.price_varies    || false,
      priceEach:      row.price_each      || false,
      images:         row.images          || [],
      customOptions:  row.custom_options  || [],
    };
  }

  const authHeaders = {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
  };

  window.loadCatalog = async function () {
    const url = `${REST_URL}?order=display_order.asc,name.asc&limit=1000`;
    const res  = await fetch(url, { headers: authHeaders });
    if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
    const rows = await res.json();
    return { products: rows.map(mapRow) };
  };

  // ── Promo codes ───────────────────────────────────────────────────────────
  // Looks up a single code. Returns the row, or null if not found.
  window.lookupPromoCode = async function (code) {
    const clean = (code || '').trim().toUpperCase();
    if (!clean) return null;
    const url = `${SUPABASE_URL}/rest/v1/promo_codes?code=eq.${encodeURIComponent(clean)}&limit=1`;
    const res = await fetch(url, { headers: authHeaders });
    if (!res.ok) throw new Error(`Promo lookup failed: ${res.status}`);
    const rows = await res.json();
    return rows.length ? rows[0] : null;
  };

  // How many times this email has already redeemed this code.
  // Uses a HEAD request with an exact count so we never download the rows.
  window.countCustomerRedemptions = async function (code, email) {
    const c = (code  || '').trim().toUpperCase();
    const e = (email || '').trim().toLowerCase();
    if (!c || !e) return 0;
    const url = `${SUPABASE_URL}/rest/v1/promo_redemptions`
              + `?code=eq.${encodeURIComponent(c)}`
              + `&customer_email=eq.${encodeURIComponent(e)}`
              + `&select=id`;
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { ...authHeaders, 'Prefer': 'count=exact', 'Range': '0-0' },
    });
    if (!res.ok) throw new Error(`Redemption count failed: ${res.status}`);
    // Content-Range comes back as "0-0/12" — the part after the slash is the count.
    const range = res.headers.get('content-range') || '';
    const total = parseInt(range.split('/')[1], 10);
    return isNaN(total) ? 0 : total;
  };

  // Records a redemption and bumps the usage counter. Best-effort.
  window.recordPromoRedemption = async function (payload) {
    try {
      // Store the email lowercase so per-customer counting is case-insensitive.
      const body = {
        ...payload,
        customer_email: (payload.customer_email || '').trim().toLowerCase(),
      };
      await fetch(`${SUPABASE_URL}/rest/v1/promo_redemptions`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_promo_use`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ promo_code: payload.code }),
      });
    } catch (e) {
      console.error('Promo redemption logging failed:', e);
    }
  };
})();
