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

  // Cart icon opens checkout
  const cartIcon = document.getElementById("cart-icon");
  if (cartIcon) {
    cartIcon.addEventListener("click", (e) => {
      e.preventDefault();
      openCheckout();
    });
  }
});

// Add items to cart
function addToCart(item) {
  cart.push(item);
  alert(item + " added to cart!");
}

// Open checkout modal
function openCheckout() {
  const modal = document.getElementById("checkout-modal");
  const cartTextarea = document.getElementById("cart-items");
  if (modal && cartTextarea) {
    cartTextarea.value = cart.join(", ");
    modal.classList.add("show");
  }
}

// Close checkout modal
function closeCheckout() {
  const modal = document.getElementById("checkout-modal");
  if (modal) {
    modal.classList.remove("show");
  }
}

// Close modal if user clicks outside the content
window.addEventListener("click", (e) => {
  const modal = document.getElementById("checkout-modal");
  if (modal && e.target === modal) {
    closeCheckout();
  }
});
