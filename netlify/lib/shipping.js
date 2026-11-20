const states = {
  AL: 'Alabama', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
};

function parseItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 25) throw new Error('Review your cart first.');
  const grouped = new Map();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 200 ||
      !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) {
      throw new Error('Review your cart quantities first.');
    }
    grouped.set(item.id, (grouped.get(item.id) || 0) + item.quantity);
    if (grouped.get(item.id) > 20) throw new Error('Please request a quote for larger quantities.');
  }
  return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([id, quantity]) => ({ id, quantity }));
}

function parseCustomer(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('Enter your shipping contact details.');
  const text = (value, max) => {
    const result = typeof value === 'string' ? value.trim() : '';
    if (result.length > max) throw new Error('A shipping address or contact field is too long. Please shorten it.');
    return result;
  };
  const customer = {
    name: text(input.name, 120), email: text(input.email, 254).toLowerCase(), phone: text(input.phone, 40),
    address: {
      line1: text(input.address?.line1, 150), line2: text(input.address?.line2, 150),
      city: text(input.address?.city, 100), state: text(input.address?.state, 80).toUpperCase(),
      postal_code: text(input.address?.postal_code, 10), country: 'US'
    }
  };
  const region = customer.address.state;
  customer.address.state = Object.keys(states).find(code => code === region || states[code].toUpperCase() === region) || '';
  const zip = Number(customer.address.postal_code.slice(0, 5));
  // Exclude territories, military mail and Alaska/Hawaii even if the submitted state was misleading.
  const unsupportedZip = zip < 1000 && zip !== 501 && zip !== 544 || zip >= 99500 ||
    zip >= 9000 && zip <= 9999 || zip >= 96200 && zip <= 96999;
  if (!customer.address.state || input.address?.country && input.address.country !== 'US' ||
      !/^\d{5}(?:-\d{4})?$/.test(customer.address.postal_code) || unsupportedZip) {
    throw new Error('Standard shipping is available only to the contiguous 48 states and Washington, DC. Check your state and ZIP code.');
  }
  if (!customer.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) ||
      !customer.address.line1 || !customer.address.city || !customer.phone) {
    throw new Error('Enter your name, email, phone number, and complete shipping address.');
  }
  return customer;
}

function customerParams(hold) {
  const { customer } = hold;
  const params = new URLSearchParams({ name: customer.name, email: customer.email, phone: customer.phone,
    'shipping[name]': customer.name, 'shipping[phone]': customer.phone,
    'metadata[shipping_reservation_id]': hold.id });
  for (const [key, value] of Object.entries(customer.address)) {
    params.set(`address[${key}]`, value);
    params.set(`shipping[address][${key}]`, value);
  }
  return params;
}

function sessionParams(hold, customerId) {
  const returnUrl = new URL('/order/', hold.checkout_config.origin);
  const address = hold.customer.address;
  const destination = [hold.customer.name, address.line1, address.line2, address.city, address.state,
    address.postal_code].filter(Boolean).join(', ');
  const params = new URLSearchParams({
    mode: 'payment', customer: customerId, 'allowed_payment_method_types[0]': 'card',
    success_url: `${returnUrl}?checkout=returned&fulfillment=shipping`,
    cancel_url: `${returnUrl}?checkout=canceled&fulfillment=shipping`,
    expires_at: String(hold.expires_at), 'metadata[shipping_reservation_id]': hold.id,
    'payment_intent_data[metadata][shipping_reservation_id]': hold.id,
    'automatic_tax[enabled]': hold.checkout_config.automatic_tax ? 'true' : 'false',
    billing_address_collection: 'required', 'customer_update[address]': 'auto',
    'payment_intent_data[shipping][name]': hold.customer.name,
    'payment_intent_data[shipping][phone]': hold.customer.phone,
    'shipping_options[0][shipping_rate_data][type]': 'fixed_amount',
    'shipping_options[0][shipping_rate_data][fixed_amount][amount]': String(hold.shipping_cents),
    'shipping_options[0][shipping_rate_data][fixed_amount][currency]': 'usd',
    'shipping_options[0][shipping_rate_data][display_name]': 'Standard USPS shipping',
    'shipping_options[0][shipping_rate_data][tax_behavior]': 'exclusive',
    'custom_text[submit][message]': `Ship to: ${destination}. We’ll contact you when your order is ready to ship. To change the shipping address, return to the store before paying.`
  });
  for (const [key, value] of Object.entries(address)) params.set(`payment_intent_data[shipping][address][${key}]`, value);
  hold.items.forEach((item, index) => {
    const prefix = `line_items[${index}]`;
    params.set(`${prefix}[quantity]`, item.quantity);
    params.set(`${prefix}[price_data][currency]`, 'usd');
    params.set(`${prefix}[price_data][unit_amount]`, item.cents);
    params.set(`${prefix}[price_data][tax_behavior]`, 'exclusive');
    params.set(`${prefix}[price_data][product_data][name]`, item.name);
  });
  return params;
}

module.exports = { parseItems, parseCustomer, customerParams, sessionParams };
