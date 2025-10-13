// ---- CART STORAGE HELPERS ---- //
function loadCart() {
  const cartData = localStorage.getItem("cart");
  return cartData ? JSON.parse(cartData) : [];
}

function saveCart(cart) {
  localStorage.setItem("cart", JSON.stringify(cart));
}

let cart = loadCart(); // Initialize cart from localStorage
let currentSlide = 0;

// Color selection variables
let pendingItem = null;

// Available colors list
const availableColors = [
  'Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple', 'Pink', 
  'Black', 'White', 'Gray', 'Silver', 'Gold', 'Clear/Transparent', 
  'Glow in the Dark', 'Wood Fill', 'Metal Fill', 'Carbon Fiber', 
  'Rainbow/Multi-color', 'Custom Color (specify in notes)'
];

// Initialize everything when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  initializeCarousel();
  initializeEventListeners();
  updateCartDisplay();
  handleLogoError();
});

// Carousel functionality
function initializeCarousel() {
  const carousel = document.getElementById("carousel");
  if (!carousel) return;
  
  const images = carousel.querySelectorAll(".carousel-image");
  const totalImages = images.length;
  
  if (totalImages === 0) return;
  
  // Create dots for carousel navigation
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
  
  // Auto-scroll carousel every 4 seconds
  setInterval(() => {
    currentSlide = (currentSlide + 1) % totalImages;
    updateCarousel();
  }, 4000);
  
  // Navigation buttons
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
  
  // Calculate the percentage to move based on current slide
  const movePercentage = (100 / images.length) * currentSlide;
  carousel.style.transform = `translateX(-${movePercentage}%)`;
  
  // Update dots
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
  // Cart icon click handler
  const cartIcon = document.getElementById("cart-icon");
  if (cartIcon) {
    cartIcon.addEventListener("click", (e) => {
      e.preventDefault();
      openCheckout();
    });
  }
  
  // Pickup/shipping selection handler
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
  
  // Proceed to checkout button
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
  
  // Form submission handler
  const checkoutForm = document.getElementById("checkout-form");
  if (checkoutForm) {
    checkoutForm.addEventListener("submit", (e) => {
      const pickupSelect = document.getElementById("pickup");
      if (!pickupSelect.value) {
        e.preventDefault();
        alert("Please select a delivery method.");
        return;
      }
      
      // Show confirmation message
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

// ✅ Quantity control functions (fixed with min/max support)
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

// User quantity input validation
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

// ✅ NEW: Simple addToCart function for items without color selection
function addToCart(itemName, price, buttonElement) {
  const quantityInput = buttonElement.parentNode.querySelector(".quantity-input");
  const quantity = parseInt(quantityInput.value) || 1;
  
  // Check if item already exists in cart
  const existingItemIndex = cart.findIndex(item => item.name === itemName && !item.colors);
  
  if (existingItemIndex !== -1) {
    // Update existing item quantity
    cart[existingItemIndex].quantity += quantity;
  } else {
    // Add new item to cart
    cart.push({
      name: itemName,
      price: price,
      quantity: quantity
    });
  }
  
  // Reset quantity input to 1
  quantityInput.value = 1;
  
  // Save cart and update UI
  saveCart(cart);
  updateCartDisplay();
  
  // Show success message
  showNotification(`${quantity} x ${itemName} added to cart!`);
}

// Enhanced Color Selection Functions for Multi-Color Support
function openColorSelection(itemName, price, buttonElement, colorCount = 1) {
  const quantityInput = buttonElement.parentNode.querySelector(".quantity-input");
  const quantity = parseInt(quantityInput.value) || 1;
  
  // Store pending item data
  pendingItem = {
    name: itemName,
    price: price,
    quantity: quantity,
    buttonElement: buttonElement,
    colorCount: colorCount
  };
  
  // Update modal content
  document.getElementById('selected-product-name').textContent = itemName;
  document.getElementById('selected-quantity').textContent = quantity;
  document.getElementById('selected-total').textContent = (price * quantity).toFixed(2);
  
  // Reset color selections
  document.getElementById('color-select-1').value = '';
  document.getElementById('color-select-2').value = '';
  
  // Show/hide second color dropdown based on colorCount
  const secondColorGroup = document.getElementById('second-color-group');
  if (colorCount >= 2) {
    secondColorGroup.style.display = 'block';
    // Update labels for clarity
    document.querySelector('label[for="color-select-1"]').textContent = 'Choose Primary Color:';
    document.querySelector('label[for="color-select-2"]').textContent = 'Choose Secondary Color:';
  } else {
    secondColorGroup.style.display = 'none';
    document.querySelector('label[for="color-select-1"]').textContent = 'Choose Color:';
  }
  
  // Show modal
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
  
  // Validate required color selections
  if (!primaryColor) {
    alert('Please select a primary color before adding to cart.');
    return;
  }
  
  if (pendingItem.colorCount >= 2 && !secondaryColor) {
    alert('Please select a secondary color before adding to cart.');
    return;
  }
  
  // Create color information
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
  
  // Check if item with same name and colors already exists
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
    // Update existing item quantity
    cart[existingItemIndex].quantity += pendingItem.quantity;
  } else {
    // Add new item to cart
    cart.push({
      name: pendingItem.name,
      price: pendingItem.price,
      quantity: pendingItem.quantity,
      colors: colorInfo,
      colorCount: pendingItem.colorCount
    });
  }
  
  // Reset quantity input to 1
  const quantityInput = pendingItem.buttonElement.parentNode.querySelector(".quantity-input");
  quantityInput.value = 1;
  
  // Save cart and update UI
  saveCart(cart);
  updateCartDisplay();
  
  // Show success message
  showNotification(`${pendingItem.quantity} x ${pendingItem.name} (${colorInfo.display}) added to cart!`);
  
  // Close modal
  closeColorSelection();
}

// Update cart display and count
function updateCartDisplay() {
  const cartCount = document.getElementById("cart-count");
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  
  if (cartCount) {
    cartCount.textContent = totalItems;
  }
  
  // Update cart modal content
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
        
        // Handle both old single-color format and new multi-color format
        let colorDisplay = '';
        if (item.colors) {
          colorDisplay = `<div class="item-color">Color${item.colorCount >= 2 ? 's' : ''}: ${item.colors.display}</div>`;
        } else if (item.color) {
          // Legacy support for old format
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
  
  // Update form textarea
  const cartItemsForm = document.getElementById("cart-items-form");
  if (cartItemsForm) {
    let formText = "ORDER SUMMARY:\n";
    let total = 0;
    
    cart.forEach(item => {
      const itemTotal = item.price * item.quantity;
      total += itemTotal;
      
      // Handle both items with and without colors
      let colorInfo = '';
      if (item.colors) {
        if (item.colorCount >= 2) {
          colorInfo = ` - Colors: Primary: ${item.colors.primary}, Secondary: ${item.colors.secondary}`;
        } else {
          colorInfo = ` - Color: ${item.colors.primary}`;
        }
      } else if (item.color) {
        // Legacy support for old format
        colorInfo = ` - Color: ${item.color}`;
      }
      
      formText += `${item.name}${colorInfo} - Quantity: ${item.quantity} - Price: $${item.price.toFixed(2)} each - Subtotal: $${itemTotal.toFixed(2)}\n`;
    });
    
    formText += `\nTOTAL: $${total.toFixed(2)}`;
    cartItemsForm.value = formText;
  }
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

// Handle logo error - hide if image doesn't exist
function handleLogoError() {
  const headerLogoOrder = document.getElementById("header-logo-order");
  
  if (headerLogoOrder) {
    headerLogoOrder.addEventListener("error", () => headerLogoOrder.style.display = "none");
    headerLogoOrder.addEventListener("load", () => headerLogoOrder.style.display = "block");
  }
}

// Hamburger Menu Functionality
document.addEventListener("DOMContentLoaded", () => {
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
    
    // Close menu when clicking a link (except cart)
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        if (link.id !== 'mobile-cart-link') {
          toggleMenu();
        }
      });
    });
    
    // Mobile cart link functionality
    if (mobileCartLink) {
      mobileCartLink.addEventListener('click', (e) => {
        e.preventDefault();
        toggleMenu();
        setTimeout(() => openCheckout(), 300);
      });
    }
  }
  
  // Update mobile cart count
  updateMobileCartCount();
});

// Update mobile cart count function
function updateMobileCartCount() {
  const mobileCartCount = document.getElementById('mobile-cart-count');
  const desktopCartCount = document.getElementById('cart-count');
  if (mobileCartCount && desktopCartCount) {
    mobileCartCount.textContent = desktopCartCount.textContent;
  }
}

// Modify your existing updateCartDisplay function to include mobile cart update
// Find your updateCartDisplay function and add this line at the end:
// updateMobileCartCount();