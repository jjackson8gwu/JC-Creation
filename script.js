let cart = [];

// Carousel auto-scroll
document.addEventListener("DOMContentLoaded", () => {
  const carousel = document.querySelector(".carousel-container");
  if (carousel) {
    let scrollAmount = 0;
    setInterval(() => {
      scrollAmount += carousel.clientWidth;
      if (scrollAmount >= carousel.scrollWidth) {
        scrollAmount = 0;
      }
      carousel.scrollTo({ left: scrollAmount, behavior: "smooth" });
    }, 3000);
  }
});

// Add items to cart
function addToCart(item) {
  cart.push(item);
  alert(item + " added to cart!");
}

// Open checkout modal
document.getElementById("cart-icon").addEventListener("click", (e) => {
  e.preventDefault();
  openCheckout();
});

function openCheckout() {
  document.getElementById("checkout-modal").style.display = "flex";
  document.getElementById("cart-items").value = cart.join(", ");
}

function closeCheckout() {
  document.getElementById("checkout-modal").style.display = "none";
}

// Show shipping note
document.addEventListener("change", (e) => {
  if (e.target.id === "pickup") {
    const note = document.getElementById("shipping-note");
    note.classList.toggle("hidden", e.target.value !== "no");
  }
});
