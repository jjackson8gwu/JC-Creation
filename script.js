let cart = [];
let currentSlide = 0;

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
        updateCartDisplay();
        closeOrderForm();
      }, 100);
    });
  }
}

// Quantity control functions
function increaseQuantity(button) {
  const input = button.parentNode.querySelector(".quantity-input");
  const currentValue = parseInt(input.value);
  if (currentValue < 99) {
    input.value = currentValue + 1;
  }
}

function decreaseQuantity(button) {
  const input = button.parentNode.querySelector(".quantity-input");
  const currentValue = parseInt(input.value);
  if (currentValue > 1) {
    input.value = currentValue - 1;
  }
}

// Enhanced add to cart function
function addToCart(itemName, price, buttonElement) {
  const quantityInput = buttonElement.parentNode.querySelector(".quantity-input");
  const quantity = parseInt(quantityInput.value) || 1;
  
  // Check if item already exists in cart
  const existingItemIndex = cart.findIndex(item => item.name === itemName);
  
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
  
  // Update cart display
  updateCartDisplay();
  
  // Show success message
  showNotification(`${quantity} x ${itemName} added to cart!`);
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
        
        cartHTML += `
          <div class="cart-item">
            <span class="item-name">${item.name}</span>
            <span class="item-details">$${item.price.toFixed(2)} x ${item.quantity}</span>
            <span class="item-total">$${itemTotal.toFixed(2)}</span>
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
      formText += `${item.name} - Quantity: ${item.quantity} - Price: $${item.price.toFixed(2)} each - Subtotal: $${itemTotal.toFixed(2)}\n`;
    });
    
    formText += `\nTOTAL: $${total.toFixed(2)}`;
    cartItemsForm.value = formText;
  }
}

// Remove item from cart
function removeFromCart(index) {
  const removedItem = cart[index];
  cart.splice(index, 1);
  updateCartDisplay();
  showNotification(`${removedItem.name} removed from cart`);
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
  // Remove any existing notifications
  const existingNotification = document.querySelector(".notification-popup");
  if (existingNotification) {
    existingNotification.remove();
  }
  
  // Create new notification
  const notification = document.createElement("div");
  notification.className = "notification-popup";
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // Show notification
  setTimeout(() => {
    notification.classList.add("show");
  }, 10);
  
  // Hide notification after 3 seconds
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
  
  if (e.target === checkoutModal) {
    closeCheckout();
  } else if (e.target === orderModal) {
    closeOrderForm();
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
  const headerLogo = document.getElementById("header-logo");
  const headerLogoOrder = document.getElementById("header-logo-order");
  const welcomeLogo = document.getElementById("welcome-logo");
  
  // Handle header logo on home page
  if (headerLogo) {
    headerLogo.addEventListener("error", () => {
      headerLogo.style.display = "none";
    });
    headerLogo.addEventListener("load", () => {
      headerLogo.style.display = "block";
    });
  }
  
  // Handle header logo on order page
  if (headerLogoOrder) {
    headerLogoOrder.addEventListener("error", () => {
      headerLogoOrder.style.display = "none";
    });
    headerLogoOrder.addEventListener("load", () => {
      headerLogoOrder.style.display = "block";
    });
  }
  
  // Handle welcome logo on home page
  if (welcomeLogo) {
    welcomeLogo.addEventListener("error", () => {
      welcomeLogo.style.display = "none";
    });
    welcomeLogo.addEventListener("load", () => {
      welcomeLogo.style.display = "block";
    });
  }
}
