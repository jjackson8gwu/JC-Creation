// ---- CART STORAGE HELPERS ---- //
function loadCart() {
  const cartData = localStorage.getItem("cart");
  return cartData ? JSON.parse(cartData) : [];
}

function saveCart(cart) {
  localStorage.setItem("cart", JSON.stringify(cart));
}

let cart = loadCart();
let currentSlide = 0;
let productsData = null;

// ── Google Sheets Inventory Sync ─────────────────────────────────────────────
// Paste your deployed Apps Script Web App URL here after setup.
// Leave blank to use only the quantities already in products.json.
const INVENTORY_SHEET_URL = '';   // e.g. 'https://script.google.com/macros/s/ABC123.../exec'

// Color selection variables
let pendingItem = null;

// ── Promo code state ────────────────────────────────────────────────────────
// appliedPromo = the validated promo row from Supabase, or null.
let appliedPromo = null;

// Look up which category a cart item belongs to (for category-scoped codes).
function cartItemCategory(item) {
  if (!productsData || !item.id) return '';
  const p = productsData.products.find(x => x.id === item.id);
  return p ? (p.category || '') : '';
}

// Subtotal the promo actually applies to (whole cart, or one category).
function promoEligibleSubtotal(promo) {
  if (!promo || !promo.category) {
    return cart.reduce((s, i) => s + i.price * i.quantity, 0);
  }
  const target = promo.category.toLowerCase();
  return cart.reduce((s, i) => {
    return cartItemCategory(i).toLowerCase() === target
      ? s + i.price * i.quantity
      : s;
  }, 0);
}

// Returns { discount, subtotal, total } for the current cart + applied promo.
function calcCartTotals() {
  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  let discount = 0;

  if (appliedPromo) {
    const eligible = promoEligibleSubtotal(appliedPromo);
    if (appliedPromo.discount_type === 'percent') {
      discount = eligible * (parseFloat(appliedPromo.discount_value) / 100);
    } else {
      discount = Math.min(parseFloat(appliedPromo.discount_value), eligible);
    }
    // Never discount below zero, never exceed the cart
    discount = Math.max(0, Math.min(discount, subtotal));
  }

  return {
    subtotal,
    discount,
    total: Math.max(0, subtotal - discount),
  };
}

// Validates a code against all the rules. Returns {ok:true, promo} or {ok:false, reason}.
async function validatePromoCode(rawCode) {
  const code = (rawCode || '').trim().toUpperCase();
  if (!code) return { ok: false, reason: 'Please enter a promo code.' };
  if (typeof window.lookupPromoCode !== 'function') {
    return { ok: false, reason: 'Promo codes are unavailable right now.' };
  }

  let promo;
  try {
    promo = await window.lookupPromoCode(code);
  } catch (e) {
    console.error(e);
    return { ok: false, reason: 'Could not check that code. Please try again.' };
  }

  if (!promo)        return { ok: false, reason: 'That code isn’t valid.' };
  if (!promo.active) return { ok: false, reason: 'That code is no longer active.' };

  if (promo.expires_at) {
    const today = new Date().toISOString().slice(0, 10);
    if (promo.expires_at < today) return { ok: false, reason: 'That code has expired.' };
  }

  if (promo.max_uses > 0 && (promo.uses_count || 0) >= promo.max_uses) {
    return { ok: false, reason: 'That code has reached its usage limit.' };
  }

  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  if (promo.min_order > 0 && subtotal < parseFloat(promo.min_order)) {
    const need = (parseFloat(promo.min_order) - subtotal).toFixed(2);
    return { ok: false, reason: `Requires a $${parseFloat(promo.min_order).toFixed(2)} minimum — add $${need} more.` };
  }

  if (promo.category && promoEligibleSubtotal(promo) <= 0) {
    const pretty = promo.category.replace(/_/g, ' ');
    return { ok: false, reason: `This code only applies to ${pretty} items.` };
  }

  return { ok: true, promo };
}

async function applyPromoCode() {
  const input  = document.getElementById('promo-code-input');
  const msgEl  = document.getElementById('promo-message');
  const btn    = document.getElementById('apply-promo-btn');
  if (!input) return;

  btn.disabled = true;
  btn.textContent = 'Checking…';
  msgEl.textContent = '';

  const result = await validatePromoCode(input.value);

  btn.disabled = false;
  btn.textContent = 'Apply';

  if (!result.ok) {
    appliedPromo = null;
    msgEl.style.color = '#c62828';
    msgEl.textContent = result.reason;
    updateCartDisplay();
    return;
  }

  appliedPromo = result.promo;
  msgEl.style.color = '#2e7d32';
  msgEl.textContent = `✓ Code "${appliedPromo.code}" applied!`;
  input.value = appliedPromo.code;
  updateCartDisplay();
}

function removePromoCode() {
  appliedPromo = null;
  const input = document.getElementById('promo-code-input');
  const msgEl = document.getElementById('promo-message');
  if (input) input.value = '';
  if (msgEl)  msgEl.textContent = '';
  updateCartDisplay();
}

// Re-checks the applied code after the cart changes (qty/removal can break
// a minimum-order or category rule). Silently drops it if it no longer fits.
async function revalidateAppliedPromo() {
  if (!appliedPromo) return;
  const result = await validatePromoCode(appliedPromo.code);
  if (!result.ok) {
    appliedPromo = null;
    const msgEl = document.getElementById('promo-message');
    if (msgEl) {
      msgEl.style.color = '#c62828';
      msgEl.textContent = result.reason + ' Code removed.';
    }
    updateCartDisplay();
  }
}

// Injects the promo input into the checkout modal (so we don't have to edit
// every HTML page). Runs once, the first time the cart is opened.
function injectPromoUI() {
  if (document.getElementById('promo-box')) return;
  const totalEl = document.getElementById('cart-total');
  if (!totalEl || !totalEl.parentNode) return;

  const box = document.createElement('div');
  box.id = 'promo-box';
  box.style.cssText = 'margin:14px 0;padding:14px;border:1px dashed #bbb;border-radius:10px;background:#fafafa';
  box.innerHTML = `
    <label style="display:block;font-weight:bold;font-size:0.9rem;margin-bottom:8px;color:#1a4054">
      Have a promo code?
    </label>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input type="text" id="promo-code-input" placeholder="Enter code"
        style="flex:1;min-width:130px;padding:9px 12px;border:2px solid #ddd;border-radius:8px;font-size:14px;text-transform:uppercase;letter-spacing:0.05em"
        onkeydown="if(event.key==='Enter'){event.preventDefault();applyPromoCode()}">
      <button type="button" id="apply-promo-btn" onclick="applyPromoCode()"
        style="padding:9px 20px;border:none;border-radius:8px;background:#D2762B;color:white;font-weight:bold;cursor:pointer;font-size:14px">
        Apply
      </button>
    </div>
    <div id="promo-message" style="font-size:0.85rem;margin-top:8px;min-height:18px"></div>`;

  totalEl.parentNode.insertBefore(box, totalEl);
}

// Available colors list
const availableColors = [
  'Amolen-Black-Red', 'Bambu_Green', 'Black', 'Blue-Gray', 'Blue', 'BrightGreen',
  'Brown', 'CocoaBrown', 'Cookiecad-DarkMagic', 'Cookiecad-Fairy-Floss',
  'Cookiecad-Green-Apple', 'Cookiecad-Mint-Green-Elixir', 'Cookiecad-Pastel-Rainbow',
  'Cyan', 'Elegoo-Beige', 'Gold', 'Glow-Green', 'Gray', 'HotPink', 'IndigoPurple',
  'iSANMATE-Blue-Green-Pink', 'iSANMATE-Bluish-Green-Purple', 'iSANMATE-Gradient_Red-Orange',
  'Light_Gray', 'Magenta', 'MaroonRed', 'Matte-Apple-Green', 'Matte-Caramel',
  'Matte-Dark-Blue', 'Matte-Dark-Green', 'Matte-Desert-Tan', 'Matte-Grass-Green',
  'Matte-Ice-Blue', 'Matte-Latte-Brown', 'Matte-Lemon-Yellow', 'Matte-Lilac-Purple',
  'Matte-Plum', 'Matte-Sakura-Pink', 'Matte-Sky-Blue', 'Orange', 'Purple', 'Red',
  'Silver', 'SunflowerYellow', 'Sunlu-Purple-Green-Matte', 'Sunlu-Yellow-Cyan-Matte',
  'Turquoise', 'White', 'Yellow', 'Ziro-Colorful_Mist-Matte', 'Ziro-Matcha-Matte',
  'Ziro-Meadow_Mirage-Matte', 'Ziro-Neon-Matte', 'Ziro-Northern_Lights-Matte',
  'Ziro-Rainbow_Blaze-Matte', 'Ziro-Rosy-Cloud-Matte', 'Ziro-Rusted_Jungle-Matte',
  'Ziro-Vibrant_Coral-Matte'
];

// Initialize everything when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  initializeCarousel();
  initializeEventListeners();
  updateCartDisplay();
  handleLogoError();
  loadProducts();
  initLightbox();
});

// Load products from Supabase
async function loadProducts() {
  try {
    productsData = await window.loadCatalog();

    const currentPage = getCurrentPageCategory();
    if (currentPage) {
      displayProducts(currentPage);
    }
  } catch (error) {
    console.error('Error loading products:', error);
  }
}

// Get current page category from URL
// Uses lowercase comparison so it works whether the host preserves or
// lowercases the URL (Netlify lowercases; GitHub Pages does not).
function getCurrentPageCategory() {
  const path = window.location.pathname.toLowerCase();

  if (path.includes('1_dollar_minis')) return '1_dollar_minis';
  if (path.includes('2_dollar_minis')) return '2_dollar_minis';
  if (path.includes('3_dollar_minis')) return '3_dollar_minis';
  if (path.includes('4_dollar_minis')) return '4_dollar_minis';
  if (path.includes('dragons_and_animals')) return 'Dragons_and_Animals';
  if (path.includes('fan_art'))           return 'Fan_Art';
  if (path.includes('custom_designs'))    return 'Custom_Designs';
  if (path.includes('fidgets'))           return 'Fidgets';
  if (path.includes('pokeballs'))         return 'Pokeballs';
  if (path.includes('clickers'))          return 'Clickers';
  if (path.includes('keychains'))         return 'Keychains';
  if (path.includes('mystery_bag'))       return 'Mystery_Bag';
  if (path.includes('pen_holders'))       return 'Pen_Holders';
  if (path.includes('seasonal'))          return 'Seasonal';

  return null;
}

// Display products for current category
function displayProducts(category) {
  const productsSection = document.querySelector('.products');
  if (!productsSection || !productsData) return;

  // Filter products by category, respecting madeToOrder / visibility rules
  // Case-insensitive so admin-panel categories always match
  const catLower = category.toLowerCase();
  const categoryProducts = productsData.products.filter(p => {
    if ((p.category || '').toLowerCase() !== catLower) return false;
    // Mystery Bag items are always shown (informational preview, not purchasable individually)
    if (catLower === 'mystery_bag') return true;
    // Always show: price-varies items and everything in Custom_Designs (even at qty=0)
    if (p.priceVaries || catLower === 'custom_designs') return true;
    // Hide out-of-stock items unless explicitly marked as made-to-order
    if (p.quantity === 0 && !p.madeToOrder) return false;
    return true;
  });

  // Sort alphabetically by name
  categoryProducts.sort((a, b) => a.name.localeCompare(b.name));

  // Clear existing products
  productsSection.innerHTML = '';

  // Generate HTML for each product
  categoryProducts.forEach(product => {
    const productHTML = createProductHTML(product, category);
    productsSection.innerHTML += productHTML;
  });

  // Re-attach event listeners after products are added
  attachProductEventListeners();

  // Freeze any GIF images so they only animate on hover
  freezeGifs();
}

// GIF freeze: show the GIF immediately (may animate briefly while loading),
// then capture frame 0 via canvas and freeze it. Hover replays the animation.
function freezeGifs() {
  document.querySelectorAll('.products img[data-gif-src]').forEach(img => {
    if (img.dataset.gifSetup) return;
    img.dataset.gifSetup = 'true';
    const gifSrc = img.dataset.gifSrc;

    // Show the GIF right away so there's no blank period
    img.src = gifSrc;

    const freeze = () => {
      if (!img.naturalWidth) return;
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      try {
        canvas.getContext('2d').drawImage(img, 0, 0);
        const frozen = canvas.toDataURL('image/png');
        img.dataset.gifFrozen = frozen;
        if (!img.dataset.hovered) img.src = frozen;
      } catch(e) { /* leave as live GIF if canvas capture fails */ }
    };

    if (img.complete && img.naturalWidth > 0) {
      freeze(); // already cached — freeze immediately
    } else {
      img.addEventListener('load', freeze, { once: true });
    }

    img.addEventListener('mouseenter', () => {
      img.dataset.hovered = 'true';
      img.src = gifSrc;
    });
    img.addEventListener('mouseleave', () => {
      img.dataset.hovered = '';
      if (img.dataset.gifFrozen) img.src = img.dataset.gifFrozen;
    });
  });
}

// Create HTML for a single product (supports multiple images via gallery)
function createProductHTML(product, category) {
  // Support both 'images' array (multi) and legacy 'image' string (single)
  const imageList = (product.images && product.images.length > 0)
    ? product.images
    : (product.image ? [product.image] : []);

  let mediaHTML = '';

  // Transparent 1px placeholder — GIFs never auto-play; they load only on hover
  const GIF_BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  if (imageList.length > 1) {
    // ── Multi-image gallery ──────────────────────────────────────────────
    const slides = imageList.map((src, i) => {
      const isVid = /\.(mp4|webm)$/i.test(src);
      const isGif = /\.gif$/i.test(src);
      const cls = `gallery-slide${i === 0 ? ' active' : ''}`;
      if (isVid) return `<video class="${cls}" muted loop playsinline><source src="${src}" type="video/mp4"></video>`;
      if (isGif) return `<img class="${cls}" src="${GIF_BLANK}" data-gif-src="${src}" alt="${product.name}">`;
      return `<img class="${cls}" src="${src}" alt="${product.name}">`;
    }).join('\n        ');

    const dots = imageList.map((_, i) =>
      `<button class="gallery-dot${i === 0 ? ' active' : ''}" onclick="galleryGoTo(this,${i})"></button>`
    ).join('');

    mediaHTML = `
      <div class="product-gallery" data-current="0" data-total="${imageList.length}">
        ${slides}
        <button class="gallery-prev" onclick="galleryPrev(this)">&#8249;</button>
        <button class="gallery-next" onclick="galleryNext(this)">&#8250;</button>
        <div class="gallery-dots">${dots}</div>
      </div>`;
  } else if (imageList.length === 1) {
    // ── Single image / video (legacy) ────────────────────────────────────
    const isVideo = /\.(mp4|webm)$/i.test(imageList[0]);
    const isGif   = /\.gif$/i.test(imageList[0]);
    mediaHTML = isVideo
      ? `<video muted loop playsinline><source src="${imageList[0]}" type="video/mp4"></video>`
      : isGif
        ? `<img src="${GIF_BLANK}" data-gif-src="${imageList[0]}" alt="${product.name}">`
        : `<img src="${imageList[0]}" alt="${product.name}">`;
  }

  // ── Determine display category (fall back to product's own field) ─────────
  const cat = category || product.category || '';
  const isMysteryBag   = cat === 'Mystery_Bag';
  // priceVaries field is the authoritative flag — category name alone does NOT force "varies"
  const isPriceVaries  = product.priceVaries === true;

  // ── Price block ───────────────────────────────────────────────────────────
  const isPriceEach = product.priceEach === true;
  let priceHTML = '';
  if (isPriceVaries) {
    priceHTML = '<p class="price price-varies">Price Varies by Order</p>';
  } else if (!isMysteryBag) {
    const eachLabel = isPriceEach ? ' <span class="price-each-label">each</span>' : '';
    priceHTML = `<p class="price">$${(product.price || 0).toFixed(2)}${eachLabel}</p>`;
  }

  // ── Stock / Made-to-Order label ───────────────────────────────────────────
  let stockLabel = '';
  if (product.quantity === 0 && product.madeToOrder) {
    stockLabel = '<p class="out-of-stock">Made to Order</p>';
  }

  // ── Action section (qty + button) ────────────────────────────────────────
  let actionHTML = '';
  if (isMysteryBag) {
    // Mystery Bag items are display-only — no price, no cart button
    actionHTML = '';
  } else if (isPriceVaries) {
    // Price-varies items: open the custom design request modal
    const safeName = (product.name || '').replace(/'/g, "\\'");
    actionHTML = `<button onclick="openQuoteModal('${safeName}')" class="add-to-cart-btn request-quote-btn">Request a Quote</button>`;
  } else {
    const maxQty = product.quantity > 0 ? product.quantity : 99;
    const safeId = (product.id || '').replace(/'/g, "\\'");
    let addFn;
    if (product.customOptions && product.customOptions.length > 0) {
      addFn = `openOptionsSelection('${safeId}', this)`;
    } else if (product.requiresColor) {
      addFn = `openColorSelection('${product.name.replace(/'/g,"\\'")}', ${product.price}, this, ${product.colorCount || 1}, '${safeId}')`;
    } else {
      addFn = `addToCart('${product.name.replace(/'/g,"\\'")}', ${product.price}, this, '${safeId}')`;
    }
    actionHTML = `
      <div class="quantity-controls">
        <button onclick="decreaseQuantity(this)">-</button>
        <input type="number" class="quantity-input" value="1" min="1" max="${maxQty}">
        <button onclick="increaseQuantity(this)">+</button>
      </div>
      <button onclick="${addFn}" class="add-to-cart-btn">Add to Cart</button>`;
  }

  return `
    <div class="product${isMysteryBag ? ' mystery-preview-item' : ''}" data-product-id="${product.id}">
      ${mediaHTML}
      <h3>${product.name}</h3>
      ${priceHTML}
      ${stockLabel}
      ${actionHTML}
    </div>
  `;
}

// ── Gallery navigation functions ─────────────────────────────────────────────
function galleryPrev(btn) {
  navigateGallery(btn.closest('.product-gallery'), -1);
}
function galleryNext(btn) {
  navigateGallery(btn.closest('.product-gallery'), 1);
}
function galleryGoTo(dot, index) {
  setGallerySlide(dot.closest('.product-gallery'), index);
}
function navigateGallery(gallery, dir) {
  const total = parseInt(gallery.dataset.total);
  const current = parseInt(gallery.dataset.current) || 0;
  setGallerySlide(gallery, (current + dir + total) % total);
}
function setGallerySlide(gallery, index) {
  gallery.querySelectorAll('.gallery-slide').forEach((s, i) => {
    s.classList.toggle('active', i === index);
    // Pause/play videos
    if (s.tagName === 'VIDEO') { i === index ? s.play().catch(()=>{}) : s.pause(); }
  });
  gallery.querySelectorAll('.gallery-dot').forEach((d, i) => {
    d.classList.toggle('active', i === index);
  });
  gallery.dataset.current = index;
}

// Attach event listeners to products after they're added to DOM
function attachProductEventListeners() {
  // Quantity input validation
  let items = document.querySelectorAll("input[type=number]");
  for(let item of items){
    item.addEventListener("keyup", (e) => {
      var max = parseInt(item.getAttribute("max"), 10);
      var currentValue = parseInt(item.value, 10);
      
      if (!isNaN(currentValue) && currentValue > max) {
        item.value = max;
        alert(`Only ${max} of this item available.`);
      }
      
      var min = parseInt(item.getAttribute("min"), 10) || 1;
      if (!isNaN(currentValue) && currentValue < min) {
        item.value = min;
      }
    });
  }
  
  // Video hover effects
  const productVideos = document.querySelectorAll('.product video');
  productVideos.forEach(video => {
    video.pause();
    video.currentTime = 0;
    
    const productCard = video.closest('.product');
    
    productCard.addEventListener('mouseenter', function() {
      video.play().catch(err => {
        console.log('Video play failed:', err);
      });
    });
    
    productCard.addEventListener('mouseleave', function() {
      video.pause();
      video.currentTime = 0;
    });
  });
}

// Carousel functionality
function initializeCarousel() {
  const carousel = document.getElementById("carousel");
  if (!carousel) return;
  
  const images = carousel.querySelectorAll(".carousel-image");
  const totalImages = images.length;
  
  if (totalImages === 0) return;
  
  const dotsContainer = document.getElementById("carousel-dots");
  if (dotsContainer) {
    for (let i = 0; i < totalImages; i++) {
      const dot = document.createElement("span");
      dot.classList.add("dot");
      if (i === 0) dot.classList.add("active");
      dot.addEventListener("click", () => goToSlide(i));
      dotsContainer.appendChild(dot);
    }
  }
  
  setInterval(() => {
    currentSlide = (currentSlide + 1) % totalImages;
    updateCarousel();
  }, 4000);
  
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      currentSlide = currentSlide === 0 ? totalImages - 1 : currentSlide - 1;
      updateCarousel();
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      currentSlide = (currentSlide + 1) % totalImages;
      updateCarousel();
    });
  }
}

function updateCarousel() {
  const carousel = document.getElementById("carousel");
  const dots = document.querySelectorAll(".dot");
  
  if (!carousel) return;
  
  const images = carousel.querySelectorAll(".carousel-image");
  if (images.length === 0) return;
  
  const movePercentage = (100 / images.length) * currentSlide;
  carousel.style.transform = `translateX(-${movePercentage}%)`;
  
  dots.forEach((dot, index) => {
    dot.classList.toggle("active", index === currentSlide);
  });
}

function goToSlide(index) {
  currentSlide = index;
  updateCarousel();
}

// Initialize event listeners
function initializeEventListeners() {
  const cartIcon = document.getElementById("cart-icon");
  if (cartIcon) {
    cartIcon.addEventListener("click", (e) => {
      e.preventDefault();
      openCheckout();
    });
  }
  
  const pickupSelect = document.getElementById("pickup");
  if (pickupSelect) {
    pickupSelect.addEventListener("change", (e) => {
      const note = document.getElementById("shipping-note");
      if (note) {
        if (e.target.value === "shipping") {
          note.classList.remove("hidden");
        } else {
          note.classList.add("hidden");
        }
      }
    });
  }
  
  document.addEventListener("click", (e) => {
    if (e.target.id === "proceed-checkout") {
      if (cart.length === 0) {
        alert("Your cart is empty!");
        return;
      }
      closeCheckout();
      openOrderForm();
    }
  });
  
  const checkoutForm = document.getElementById("checkout-form");
  if (checkoutForm) {
    checkoutForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const pickupSelect = document.getElementById("pickup");
      if (!pickupSelect.value) {
        alert("Please select a delivery method.");
        return;
      }

      // Disable submit button to prevent double-submission
      const submitBtn = checkoutForm.querySelector('button[type="submit"], input[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }

      // ── 1. Fire inventory update (best-effort, non-blocking) ──────────────
      const orderItems = cart.map(item => ({
        id:       item.id || '',
        name:     item.name,
        quantity: item.quantity
      }));
      fetch('/.netlify/functions/update-inventory', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ items: orderItems })
      }).catch(err => console.warn('Inventory update failed (non-critical):', err));

      // ── 2. Submit order form to Formspree via AJAX ────────────────────────
      try {
        const formData = new FormData(checkoutForm);
        const res = await fetch(checkoutForm.action, {
          method: 'POST',
          body:   formData,
          headers: { 'Accept': 'application/json' }
        });

        if (res.ok) {
          // ── 3. Log the promo redemption (best-effort, non-blocking) ────────
          if (appliedPromo && typeof window.recordPromoRedemption === 'function') {
            const t = calcCartTotals();
            window.recordPromoRedemption({
              code:            appliedPromo.code,
              customer_name:   formData.get('name')  || '',
              customer_email:  formData.get('email') || '',
              order_subtotal:  Number(t.subtotal.toFixed(2)),
              discount_amount: Number(t.discount.toFixed(2)),
              order_total:     Number(t.total.toFixed(2)),
            });
          }

          alert("Order submitted successfully! We'll contact you shortly with payment details and order confirmation.");
          cart = [];
          saveCart(cart);
          appliedPromo = null;
          const promoInput = document.getElementById('promo-code-input');
          const promoMsg   = document.getElementById('promo-message');
          if (promoInput) promoInput.value = '';
          if (promoMsg)   promoMsg.textContent = '';
          updateCartDisplay();
          closeOrderForm();
          checkoutForm.reset();
        } else {
          const data = await res.json().catch(() => ({}));
          const msg  = data.errors ? data.errors.map(err => err.message).join(', ') : 'Unknown error';
          alert(`There was a problem submitting your order: ${msg}. Please try again.`);
        }
      } catch (err) {
        console.error('Order submission error:', err);
        alert('Could not submit your order. Please check your connection and try again.');
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Place Order'; }
      }
    });
  }
}

// Quantity control functions
function increaseQuantity(button) {
  const input = button.parentNode.querySelector(".quantity-input");
  let value = parseInt(input.value, 10);
  const max = parseInt(input.max, 10);

  if (value < max) {
    input.value = value + 1;
  } else {
    input.value = max;
  }
}

function decreaseQuantity(button) {
  const input = button.parentNode.querySelector(".quantity-input");
  let value = parseInt(input.value, 10);
  const min = parseInt(input.min, 10);

  if (value > min) {
    input.value = value - 1;
  } else {
    input.value = min;
  }
}

// Mystery Bag add-to-cart (fixed $5, no color selection needed)
function addMysteryBagToCart(buttonElement) {
  const existingIndex = cart.findIndex(item => item.name === 'Mystery Bag');
  if (existingIndex !== -1) {
    cart[existingIndex].quantity += 1;
  } else {
    cart.push({ name: 'Mystery Bag', price: 5.00, quantity: 1 });
  }
  saveCart(cart);
  updateCartDisplay();
  showNotification('Mystery Bag added to cart!');
}

// Simple addToCart function for items without color selection
function addToCart(itemName, price, buttonElement, itemId) {
  const quantityInput = buttonElement.parentNode.querySelector(".quantity-input");
  const quantity = parseInt(quantityInput.value) || 1;

  const existingItemIndex = cart.findIndex(item => item.name === itemName && !item.colors);

  if (existingItemIndex !== -1) {
    cart[existingItemIndex].quantity += quantity;
  } else {
    cart.push({
      id:       itemId || '',
      name:     itemName,
      price:    price,
      quantity: quantity
    });
  }
  
  quantityInput.value = 1;
  
  saveCart(cart);
  updateCartDisplay();
  
  showNotification(`${quantity} x ${itemName} added to cart!`);
}

// Enhanced Color Selection Functions for Multi-Color Support
function openColorSelection(itemName, price, buttonElement, colorCount = 1, itemId = '') {
  const quantityInput = buttonElement.parentNode.querySelector(".quantity-input");
  const quantity = parseInt(quantityInput.value) || 1;

  pendingItem = {
    id:            itemId,
    name:          itemName,
    price:         price,
    quantity:      quantity,
    buttonElement: buttonElement,
    colorCount:    colorCount
  };
  
  document.getElementById('selected-product-name').textContent = itemName;
  document.getElementById('selected-quantity').textContent = quantity;
  document.getElementById('selected-total').textContent = (price * quantity).toFixed(2);
  
  document.getElementById('color-select-1').value = '';
  document.getElementById('color-select-2').value = '';
  
  const secondColorGroup = document.getElementById('second-color-group');
  if (colorCount >= 2) {
    secondColorGroup.style.display = 'block';
    document.querySelector('label[for="color-select-1"]').textContent = 'Choose Primary Color:';
    document.querySelector('label[for="color-select-2"]').textContent = 'Choose Secondary Color:';
  } else {
    secondColorGroup.style.display = 'none';
    document.querySelector('label[for="color-select-1"]').textContent = 'Choose Color:';
  }
  
  const modal = document.getElementById("color-selection-modal");
  modal.classList.add("show");
  document.body.style.overflow = "hidden";
}

// ── Custom Options Selection (Intensity / Size / Style / etc.) ───────────────

let pendingOptionsItem = null;

function injectOptionsModal() {
  if (document.getElementById('options-selection-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'options-selection-modal';
  modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:3000;align-items:center;justify-content:center;overflow-y:auto;padding:20px';
  modal.innerHTML = `
    <div style="background:white;border-radius:16px;padding:28px;max-width:460px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.25)">
      <h2 style="color:#1a4054;margin-bottom:6px;font-size:1.3rem">Select Options</h2>
      <h3 id="options-product-name" style="margin-bottom:20px;font-size:1rem;color:#555;font-weight:normal"></h3>
      <div id="options-selects-container"></div>
      <div style="display:flex;gap:10px;margin-top:22px;justify-content:flex-end">
        <button onclick="closeOptionsSelection()"
          style="padding:10px 20px;border-radius:8px;border:2px solid #ccc;background:white;cursor:pointer;font-size:14px">
          Cancel
        </button>
        <button onclick="confirmOptionsSelection()"
          style="padding:10px 22px;border-radius:8px;background:#D2762B;color:white;border:none;font-weight:bold;cursor:pointer;font-size:14px">
          Add to Cart
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function openOptionsSelection(itemId, buttonElement) {
  if (!productsData) return;
  const product = productsData.products.find(p => p.id === itemId);
  if (!product) return;

  const quantityInput = buttonElement.parentNode.querySelector('.quantity-input');
  const quantity = parseInt(quantityInput.value) || 1;

  pendingOptionsItem = { product, quantity, buttonElement };

  injectOptionsModal();

  document.getElementById('options-product-name').textContent = product.name;

  const container = document.getElementById('options-selects-container');
  container.innerHTML = product.customOptions.map((opt, idx) => `
    <div style="margin-bottom:16px">
      <label style="display:block;font-weight:bold;margin-bottom:6px;color:#1a4054">${opt.label}</label>
      <select id="opt-sel-${idx}"
        style="width:100%;padding:9px 12px;border:2px solid #ddd;border-radius:8px;font-size:14px">
        <option value="">— Select ${opt.label} —</option>
        ${opt.values.map(v => `<option value="${v}">${v}</option>`).join('')}
      </select>
    </div>`).join('');

  const modal = document.getElementById('options-selection-modal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeOptionsSelection() {
  const modal = document.getElementById('options-selection-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = 'auto';
  pendingOptionsItem = null;
}

function confirmOptionsSelection() {
  if (!pendingOptionsItem) return;
  const { product, quantity, buttonElement } = pendingOptionsItem;
  const selections = {};

  for (let i = 0; i < product.customOptions.length; i++) {
    const el  = document.getElementById(`opt-sel-${i}`);
    const val = el ? el.value : '';
    if (!val) {
      alert(`Please select a ${product.customOptions[i].label} before adding to cart.`);
      return;
    }
    selections[product.customOptions[i].label] = val;
  }

  const selKey = JSON.stringify(selections);
  const existIdx = cart.findIndex(item =>
    item.id === product.id && JSON.stringify(item.selections || {}) === selKey
  );

  if (existIdx !== -1) {
    cart[existIdx].quantity += quantity;
  } else {
    cart.push({
      id:         product.id,
      name:       product.name,
      price:      product.price,
      quantity,
      selections,
    });
  }

  buttonElement.parentNode.querySelector('.quantity-input').value = 1;
  saveCart(cart);
  updateCartDisplay();

  const selText = Object.entries(selections).map(([k,v]) => `${k}: ${v}`).join(', ');
  showNotification(`${quantity} x ${product.name} (${selText}) added to cart!`);
  closeOptionsSelection();
}

// ── End Custom Options ────────────────────────────────────────────────────────

function closeColorSelection() {
  const modal = document.getElementById("color-selection-modal");
  modal.classList.remove("show");
  document.body.style.overflow = "auto";
  pendingItem = null;
}

// ── Custom Design Quote Modal ─────────────────────────────────────────────────
function openQuoteModal(productName) {
  const modal = document.getElementById('quote-modal');
  if (!modal) return;
  // Pre-fill the design name if a specific product was clicked
  const nameField = document.getElementById('quote-design-name');
  if (nameField) nameField.value = productName || '';
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';

  // Show a confirmation alert once after the form submits
  const form = document.getElementById('quote-form');
  if (form && !form.dataset.listenerAdded) {
    form.dataset.listenerAdded = 'true';
    form.addEventListener('submit', () => {
      setTimeout(() => {
        closeQuoteModal();
        form.reset();
        alert("Your request has been sent! We'll be in touch within 1–2 business days.");
      }, 800);
    });
  }
}

function closeQuoteModal() {
  const modal = document.getElementById('quote-modal');
  if (modal) modal.classList.remove('show');
  document.body.style.overflow = 'auto';
}

function confirmAddToCart() {
  if (!pendingItem) return;
  
  const colorSelect1 = document.getElementById('color-select-1');
  const colorSelect2 = document.getElementById('color-select-2');
  const primaryColor = colorSelect1.value;
  const secondaryColor = colorSelect2.value;
  
  if (!primaryColor) {
    alert('Please select a primary color before adding to cart.');
    return;
  }
  
  if (pendingItem.colorCount >= 2 && !secondaryColor) {
    alert('Please select a secondary color before adding to cart.');
    return;
  }
  
  let colorInfo;
  if (pendingItem.colorCount >= 2) {
    colorInfo = {
      primary: primaryColor,
      secondary: secondaryColor,
      display: `${primaryColor} & ${secondaryColor}`
    };
  } else {
    colorInfo = {
      primary: primaryColor,
      display: primaryColor
    };
  }
  
  const existingItemIndex = cart.findIndex(item => {
    if (item.name !== pendingItem.name) return false;
    if (pendingItem.colorCount >= 2) {
      return item.colors && 
             item.colors.primary === colorInfo.primary && 
             item.colors.secondary === colorInfo.secondary;
    } else {
      return item.colors && item.colors.primary === colorInfo.primary;
    }
  });
  
  if (existingItemIndex !== -1) {
    cart[existingItemIndex].quantity += pendingItem.quantity;
  } else {
    cart.push({
      id:         pendingItem.id || '',
      name:       pendingItem.name,
      price:      pendingItem.price,
      quantity:   pendingItem.quantity,
      colors:     colorInfo,
      colorCount: pendingItem.colorCount
    });
  }
  
  const quantityInput = pendingItem.buttonElement.parentNode.querySelector(".quantity-input");
  quantityInput.value = 1;
  
  saveCart(cart);
  updateCartDisplay();
  
  showNotification(`${pendingItem.quantity} x ${pendingItem.name} (${colorInfo.display}) added to cart!`);
  
  closeColorSelection();
}

// Update cart display and count
function updateCartDisplay() {
  const cartCount = document.getElementById("cart-count");
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  
  if (cartCount) {
    cartCount.textContent = totalItems;
  }
  
  const cartDisplay = document.getElementById("cart-display");
  const cartTotal = document.getElementById("cart-total");
  
  if (cartDisplay) {
    if (cart.length === 0) {
      cartDisplay.innerHTML = "<p>Your cart is empty</p>";
    } else {
      let cartHTML = "<div class='cart-items'>";
      let total = 0;
      
      cart.forEach((item, index) => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;
        
        let colorDisplay = '';
        if (item.selections && Object.keys(item.selections).length > 0) {
          const selText = Object.entries(item.selections).map(([k,v]) => `${k}: ${v}`).join(', ');
          colorDisplay = `<div class="item-color">${selText}</div>`;
        } else if (item.colors) {
          colorDisplay = `<div class="item-color">Color${item.colorCount >= 2 ? 's' : ''}: ${item.colors.display}</div>`;
        } else if (item.color) {
          colorDisplay = `<div class="item-color">Color: ${item.color}</div>`;
        }
        
        cartHTML += `
          <div class="cart-item">
            <div class="item-info">
              <div class="item-name">${item.name}</div>
              <div class="item-details">$${item.price.toFixed(2)} x ${item.quantity}</div>
              ${colorDisplay}
            </div>
            <div class="item-total">$${itemTotal.toFixed(2)}</div>
            <button class="remove-item" onclick="removeFromCart(${index})">×</button>
          </div>
        `;
      });
      
      cartHTML += "</div>";
      cartDisplay.innerHTML = cartHTML;

      injectPromoUI();

      if (cartTotal) {
        const t = calcCartTotals();
        if (t.discount > 0 && appliedPromo) {
          const scope = appliedPromo.category
            ? ` (${appliedPromo.category.replace(/_/g, ' ')})`
            : '';
          cartTotal.innerHTML = `
            <div style="display:flex;justify-content:space-between;padding:4px 0;color:#555">
              <span>Subtotal:</span><span>$${t.subtotal.toFixed(2)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:4px 0;color:#2e7d32;font-weight:bold">
              <span>
                Discount — ${appliedPromo.code}${scope}
                <button type="button" onclick="removePromoCode()" title="Remove code"
                  style="background:none;border:none;color:#c62828;cursor:pointer;font-size:0.85rem;padding:0 0 0 6px;text-decoration:underline">remove</button>
              </span>
              <span>−$${t.discount.toFixed(2)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 0 0;border-top:2px solid #ddd;margin-top:6px;font-size:1.1rem">
              <strong>Total:</strong><strong>$${t.total.toFixed(2)}</strong>
            </div>`;
        } else {
          cartTotal.innerHTML = `<strong>Total: $${t.subtotal.toFixed(2)}</strong>`;
        }
      }
    }
  }
  
  const cartItemsForm = document.getElementById("cart-items-form");
  if (cartItemsForm) {
    let formText = "ORDER SUMMARY:\n";
    let total = 0;
    
    cart.forEach(item => {
      const itemTotal = item.price * item.quantity;
      total += itemTotal;
      
      let colorInfo = '';
      if (item.selections && Object.keys(item.selections).length > 0) {
        colorInfo = ' - ' + Object.entries(item.selections).map(([k,v]) => `${k}: ${v}`).join(', ');
      } else if (item.colors) {
        if (item.colorCount >= 2) {
          colorInfo = ` - Colors: Primary: ${item.colors.primary}, Secondary: ${item.colors.secondary}`;
        } else {
          colorInfo = ` - Color: ${item.colors.primary}`;
        }
      } else if (item.color) {
        colorInfo = ` - Color: ${item.color}`;
      }

      formText += `${item.name}${colorInfo} - Quantity: ${item.quantity} - Price: $${item.price.toFixed(2)} each - Subtotal: $${itemTotal.toFixed(2)}\n`;
    });

    const t = calcCartTotals();
    if (t.discount > 0 && appliedPromo) {
      const scope = appliedPromo.category ? ` (${appliedPromo.category.replace(/_/g, ' ')} only)` : '';
      const desc  = appliedPromo.discount_type === 'percent'
        ? `${parseFloat(appliedPromo.discount_value)}% off`
        : `$${parseFloat(appliedPromo.discount_value).toFixed(2)} off`;
      formText += `\nSUBTOTAL: $${t.subtotal.toFixed(2)}`;
      formText += `\nPROMO CODE: ${appliedPromo.code} — ${desc}${scope}`;
      formText += `\nDISCOUNT: -$${t.discount.toFixed(2)}`;
      formText += `\nTOTAL: $${t.total.toFixed(2)}`;
    } else {
      formText += `\nTOTAL: $${t.subtotal.toFixed(2)}`;
    }
    cartItemsForm.value = formText;
  }

  // Mirror the promo into hidden form fields so it lands in the Formspree email
  const promoField    = document.getElementById('promo-code-field');
  const discountField = document.getElementById('discount-amount-field');
  const totalField    = document.getElementById('order-total-field');
  if (promoField || discountField || totalField) {
    const t2 = calcCartTotals();
    if (promoField)    promoField.value    = appliedPromo ? appliedPromo.code : '';
    if (discountField) discountField.value = t2.discount.toFixed(2);
    if (totalField)    totalField.value    = t2.total.toFixed(2);
  }
  
  updateMobileCartCount();
}

// Remove item from cart
function removeFromCart(index) {
  const removedItem = cart[index];
  cart.splice(index, 1);
  saveCart(cart);
  updateCartDisplay();
  revalidateAppliedPromo();

  let colorDisplay = '';
  if (removedItem.colors) {
    colorDisplay = ` (${removedItem.colors.display})`;
  } else if (removedItem.color) {
    colorDisplay = ` (${removedItem.color})`;
  }
  
  showNotification(`${removedItem.name}${colorDisplay} removed from cart`);
}

// Modal functions
function openCheckout() {
  const modal = document.getElementById("checkout-modal");
  if (modal) {
    updateCartDisplay();
    modal.classList.add("show");
    document.body.style.overflow = "hidden";
  }
}

function closeCheckout() {
  const modal = document.getElementById("checkout-modal");
  if (modal) {
    modal.classList.remove("show");
    document.body.style.overflow = "auto";
  }
}

// Adds hidden promo fields to the checkout form once, so the promo code,
// discount and final total all appear as their own lines in the order email.
function injectPromoFormFields() {
  const form = document.getElementById('checkout-form');
  if (!form || document.getElementById('promo-code-field')) return;
  [
    ['promo-code-field',      'promo_code'],
    ['discount-amount-field', 'discount_amount'],
    ['order-total-field',     'order_total'],
  ].forEach(([id, name]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.id   = id;
    input.name = name;
    form.appendChild(input);
  });
}

function openOrderForm() {
  const modal = document.getElementById("order-modal");
  if (modal) {
    injectPromoFormFields();
    updateCartDisplay();
    modal.classList.add("show");
    document.body.style.overflow = "hidden";
  }
}

function closeOrderForm() {
  const modal = document.getElementById("order-modal");
  if (modal) {
    modal.classList.remove("show");
    document.body.style.overflow = "auto";
  }
}

// Notification system
function showNotification(message) {
  const existingNotification = document.querySelector(".notification-popup");
  if (existingNotification) {
    existingNotification.remove();
  }
  
  const notification = document.createElement("div");
  notification.className = "notification-popup";
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add("show");
  }, 10);
  
  setTimeout(() => {
    notification.classList.remove("show");
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 300);
  }, 3000);
}

// Close modal when clicking outside
window.addEventListener("click", (e) => {
  const checkoutModal = document.getElementById("checkout-modal");
  const orderModal = document.getElementById("order-modal");
  const colorModal = document.getElementById("color-selection-modal");
  
  if (e.target === checkoutModal) {
    closeCheckout();
  } else if (e.target === orderModal) {
    closeOrderForm();
  } else if (e.target === colorModal) {
    closeColorSelection();
  }
});

// Prevent modal content clicks from closing modal
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-content")) {
    e.stopPropagation();
  }
});

// Handle logo error
function handleLogoError() {
  const headerLogoOrder = document.getElementById("header-logo-order");
  
  if (headerLogoOrder) {
    headerLogoOrder.addEventListener("error", () => headerLogoOrder.style.display = "none");
    headerLogoOrder.addEventListener("load", () => headerLogoOrder.style.display = "block");
  }
}

// Hamburger Menu Functionality
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');
const menuOverlay = document.getElementById('menu-overlay');
const mobileCartLink = document.getElementById('mobile-cart-link');

if (hamburger && mobileMenu && menuOverlay) {
  function toggleMenu() {
    hamburger.classList.toggle('active');
    mobileMenu.classList.toggle('active');
    menuOverlay.classList.toggle('active');
    document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : 'auto';
  }
  
  hamburger.addEventListener('click', toggleMenu);
  menuOverlay.addEventListener('click', toggleMenu);
  
  mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      if (link.id !== 'mobile-cart-link') {
        toggleMenu();
      }
    });
  });
  
  if (mobileCartLink) {
    mobileCartLink.addEventListener('click', (e) => {
      e.preventDefault();
      toggleMenu();
      setTimeout(() => openCheckout(), 300);
    });
  }
}

// Update mobile cart count function
function updateMobileCartCount() {
  const mobileCartCount = document.getElementById('mobile-cart-count');
  const desktopCartCount = document.getElementById('cart-count');
  if (mobileCartCount && desktopCartCount) {
    mobileCartCount.textContent = desktopCartCount.textContent;
  }
}
// ── Lightbox ──────────────────────────────────────────────────────────────────
// Injects a full-screen image viewer. Click any product image to enlarge it.
// Gallery products support left/right navigation inside the lightbox.

function initLightbox() {
  // Build the lightbox DOM once
  const lb = document.createElement('div');
  lb.id = 'lightbox';
  lb.innerHTML = `
    <div id="lb-backdrop"></div>
    <button id="lb-close" aria-label="Close">&#10005;</button>
    <button id="lb-prev"  aria-label="Previous">&#8249;</button>
    <button id="lb-next"  aria-label="Next">&#8250;</button>
    <div id="lb-inner">
      <img id="lb-img" src="" alt="">
      <div id="lb-counter"></div>
    </div>`;
  document.body.appendChild(lb);

  document.getElementById('lb-backdrop').addEventListener('click', closeLightbox);
  document.getElementById('lb-close').addEventListener('click', closeLightbox);
  document.getElementById('lb-prev').addEventListener('click', () => lbStep(-1));
  document.getElementById('lb-next').addEventListener('click', () => lbStep(1));
  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('lb-open')) return;
    if (e.key === 'Escape')     closeLightbox();
    if (e.key === 'ArrowLeft')  lbStep(-1);
    if (e.key === 'ArrowRight') lbStep(1);
  });

  // Delegate clicks on product images (works for dynamically rendered products)
  document.addEventListener('click', e => {
    const img = e.target.closest('.products img:not([data-no-lightbox])');
    if (!img) return;
    // Collect all images in the same product card
    const card = img.closest('.product');
    const srcs = card
      ? [...card.querySelectorAll('img:not([data-no-lightbox])')].map(i => i.dataset.gifSrc || i.src).filter(s => s && !s.startsWith('data:'))
      : [img.dataset.gifSrc || img.src];
    const clicked = img.dataset.gifSrc || img.src;
    const startIdx = srcs.indexOf(clicked) >= 0 ? srcs.indexOf(clicked) : 0;
    openLightbox(srcs, startIdx);
  });
}

let lbImages = [];
let lbIndex  = 0;

function openLightbox(srcs, index) {
  lbImages = srcs;
  lbIndex  = index;
  renderLightbox();
  document.getElementById('lightbox').classList.add('lb-open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('lb-open');
  document.body.style.overflow = '';
}

function lbStep(dir) {
  lbIndex = (lbIndex + dir + lbImages.length) % lbImages.length;
  renderLightbox();
}

function renderLightbox() {
  document.getElementById('lb-img').src = lbImages[lbIndex];
  const counter = document.getElementById('lb-counter');
  const prev    = document.getElementById('lb-prev');
  const next    = document.getElementById('lb-next');
  if (lbImages.length > 1) {
    counter.textContent = `${lbIndex + 1} / ${lbImages.length}`;
    prev.style.display = 'block';
    next.style.display = 'block';
  } else {
    counter.textContent = '';
    prev.style.display = 'none';
    next.style.display = 'none';
  }
}
