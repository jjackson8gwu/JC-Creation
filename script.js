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

// Color selection variables
let pendingItem = null;

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
});

// Load products from JSON
async function loadProducts() {
  try {
    const response = await fetch('../products.json');
    productsData = await response.json();
    
    // Get current page category from the URL
    const currentPage = getCurrentPageCategory();
    
    if (currentPage) {
      displayProducts(currentPage);
    }
  } catch (error) {
    console.error('Error loading products:', error);
  }
}

// Get current page category from URL
function getCurrentPageCategory() {
  const path = window.location.pathname;
  
  if (path.includes('1_dollar_minis.html')) return '1_dollar_minis';
  if (path.includes('2_dollar_minis.html')) return '2_dollar_minis';
  if (path.includes('3_dollar_minis.html')) return '3_dollar_minis';
  if (path.includes('Dragons_and_Animals.html')) return 'Dragons_and_Animals';
  if (path.includes('Characters.html')) return 'Characters';
  if (path.includes('Custom_Designs.html')) return 'Custom_Designs';
  if (path.includes('Fidgets.html')) return 'Fidgets';
  if (path.includes('Pokeballs.html')) return 'Pokeballs';
  
  return null;
}

// Display products for current category
function displayProducts(category) {
  const productsSection = document.querySelector('.products');
  if (!productsSection || !productsData) return;
  
  // Filter products by category
  const categoryProducts = productsData.products.filter(p => p.category === category);
  
  // Sort alphabetically by name
  categoryProducts.sort((a, b) => a.name.localeCompare(b.name));
  
  // Clear existing products
  productsSection.innerHTML = '';
  
  // Generate HTML for each product
  categoryProducts.forEach(product => {
    const productHTML = createProductHTML(product);
    productsSection.innerHTML += productHTML;
  });
  
  // Re-attach event listeners after products are added
  attachProductEventListeners();
}

// Create HTML for a single product
function createProductHTML(product) {
  const isVideo = product.image.toLowerCase().endsWith('.mp4') || 
                  product.image.toLowerCase().endsWith('.webm');
  
  const mediaHTML = isVideo 
    ? `<video muted loop playsinline>
         <source src="${product.image}" type="video/mp4">
       </video>`
    : `<img src="${product.image}" alt="${product.name}">`;
  
  const addToCartFunction = product.requiresColor
    ? `openColorSelection('${product.name}', ${product.price}, this, ${product.colorCount})`
    : `addToCart('${product.name}', ${product.price}, this)`;
  
  return `
    <div class="product" data-product-id="${product.id}">
      ${mediaHTML}
      <h3>${product.name}</h3>
      <p class="price">$${product.price.toFixed(2)}</p>
      <div class="quantity-controls">
        <button onclick="decreaseQuantity(this)">-</button>
        <input type="number" class="quantity-input" value="1" min="1" max="${product.quantity}">
        <button onclick="increaseQuantity(this)">+</button>
      </div>
      <button onclick="${addToCartFunction}" class="add-to-cart-btn">Add to Cart</button>
    </div>
  `;
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
    checkoutForm.addEventListener("submit", (e) => {
      const pickupSelect = document.getElementById("pickup");
      if (!pickupSelect.value) {
        e.preventDefault();
        alert("Please select a delivery method.");
        return;
      }
      
      setTimeout(() => {
        alert("Order submitted successfully! We'll contact you shortly with payment details and order confirmation.");
        cart = [];
        saveCart(cart);
        updateCartDisplay();
        closeOrderForm();
      }, 100);
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

// Simple addToCart function for items without color selection
function addToCart(itemName, price, buttonElement) {
  const quantityInput = buttonElement.parentNode.querySelector(".quantity-input");
  const quantity = parseInt(quantityInput.value) || 1;
  
  const existingItemIndex = cart.findIndex(item => item.name === itemName && !item.colors);
  
  if (existingItemIndex !== -1) {
    cart[existingItemIndex].quantity += quantity;
  } else {
    cart.push({
      name: itemName,
      price: price,
      quantity: quantity
    });
  }
  
  quantityInput.value = 1;
  
  saveCart(cart);
  updateCartDisplay();
  
  showNotification(`${quantity} x ${itemName} added to cart!`);
}

// Enhanced Color Selection Functions for Multi-Color Support
function openColorSelection(itemName, price, buttonElement, colorCount = 1) {
  const quantityInput = buttonElement.parentNode.querySelector(".quantity-input");
  const quantity = parseInt(quantityInput.value) || 1;
  
  pendingItem = {
    name: itemName,
    price: price,
    quantity: quantity,
    buttonElement: buttonElement,
    colorCount: colorCount
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

function closeColorSelection() {
  const modal = document.getElementById("color-selection-modal");
  modal.classList.remove("show");
  document.body.style.overflow = "auto";
  pendingItem = null;
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
      name: pendingItem.name,
      price: pendingItem.price,
      quantity: pendingItem.quantity,
      colors: colorInfo,
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
        if (item.colors) {
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
      
      if (cartTotal) {
        cartTotal.innerHTML = `<strong>Total: $${total.toFixed(2)}</strong>`;
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
      if (item.colors) {
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
    
    formText += `\nTOTAL: $${total.toFixed(2)}`;
    cartItemsForm.value = formText;
  }
  
  updateMobileCartCount();
}

// Remove item from cart
function removeFromCart(index) {
  const removedItem = cart[index];
  cart.splice(index, 1);
  saveCart(cart);
  updateCartDisplay();
  
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

function openOrderForm() {
  const modal = document.getElementById("order-modal");
  if (modal) {
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