let cart = [];

// Carousel auto-scroll
document.addEventListener("DOMContentLoaded", () => {
  const carousel = document.getElementById("carousel");
  if (carousel) {
    const images = carousel.querySelectorAll("img");
    let scrollIndex = 0;
    const totalImages = images.length;

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

  updateCartCount();
});

// Add items to cart
function addToCart(item) {
  cart.push(item);
  alert(item + " added to cart!");
  updateCartCount();
}

// Update cart count in header
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
  const modal = document.get
