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

  window.loadCatalog = async function () {
    const url = `${REST_URL}?order=display_order.asc,name.asc&limit=1000`;
    const res  = await fetch(url, {
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      }
    });
    if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
    const rows = await res.json();
    return { products: rows.map(mapRow) };
  };
})();
