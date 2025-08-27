let cart = [];

// Carousel auto-scroll
document.addEventListener("DOMContentLoaded", () => {
  const carousel = document.getElementById("carousel");
  if (carousel) {
    const images = carousel.querySelectorAll("img");
    let scrollIndex = 0;
    const totalImages = images.length;

    // Ensure carousel container scrolls horizontally
    carousel.style.display = "flex";
    carousel.style.overflowX = "hidden";

    setInterval(() => {
      scrollIndex = (scrollIndex + 1) % totalImages;
      const offset = images[scrollIndex].offsetLeft;
      carousel.scrollTo({ left: offset, behavior: "smooth" });
    }, 3000);
  }

  // Handle pickup change for shipping note
  const pickupSelect = document.getElementById("pickup");
  if (pickupSelect) {
    pickupSelect.addEventListener("change", (e) => {
      const note = document.getElementById("shipping-note");
      if (e.target.value === "no") {
        note.classList.remove("hidden");
      } else {
        note.classList.add("hidden");
      }
    });
  }

  // Initialize cart count in header if cart exists
  updateCartCount();
});

// Add items to cart
function addToCart(item) {
  cart.push(item);
  alert(item + " added to cart!");
  updateCartCount();
}

// Update cart count display in header
function updateCartCount() {
  const countElem = document.getElementById("cart-count");
  if (countElem) {
    countElem.textContent = cart.length;
  }
}

// Open checkout modal
const cartIcon = document.getElementById("cart-icon");
if (cartIcon) {
  cartIcon.addEventListener("click", (e) => {
    e.preventDefault();
    openCheckout();
  });
}

function openCheckout() {
  const modal = document.getElementById("checkout-modal");
  const cartTextarea = document.getElementById("cart-items");
  if (modal && cartTextarea) {
    cartTextarea.value = cart.join(", ");
    modal.style.display = "flex";
  }
}

// Close checkout modal
function closeCheckout() {
  const modal = document.getElementById("checkout-modal");
  if (modal) {
    modal.style.display = "none";
  }
}

// Close modal if user clicks outside the content
window.addEventListener("click", (e) => {
  const modal = document.getElementById("checkout-modal");
  if (modal && e.target === modal) {
    closeCheckout();
  }
});
