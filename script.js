// === Carousel Auto Scroll ===
let carouselIndex = 0;
const carousel = document.getElementById("carousel");
const slides = carousel?.children;

function showSlide() {
  if (!slides) return;
  for (let i = 0; i < slides.length; i++) {
    slides[i].style.display = "none";
  }
  carouselIndex++;
  if (carouselIndex > slides.length) carouselIndex = 1;
  slides[carouselIndex - 1].style.display = "block";
  setTimeout(showSlide, 3000); // change every 3s
}

if (carousel) {
  showSlide();
}

// === Shopping Cart Logic ===
let cart = [];

function addToCart(item) {
  cart.push(item);
  document.getElementById("cart-items").innerHTML =
    cart.map(i => `<li>${i}</li>`).join("");
}

function checkout() {
  document.getElementById("checkout-form").classList.remove("hidden");
  document.getElementById("cartData").value = cart.join(", ");
}

function closeModal() {
  document.getElementById("checkout-form").classList.add("hidden");
}

document.getElementById("delivery")?.addEventListener("change", (e) => {
  if (e.target.value === "shipping") {
    alert("Shipping will be calculated when invoice is sent.");
  }
});

// === Handle Formspree Submission ===
document.getElementById("orderForm")?.addEventListener("submit", function(e) {
  e.preventDefault();
  const form = this;

  fetch(form.action, {
    method: form.method,
    body: new FormData(form),
    headers: { 'Accept': 'application/json' }
  }).then(response => {
    if (response.ok) {
      alert("✅ Order submitted!\n\nPlease pay via:\nVenmo: @YourVenmo\nCashApp: $YourCashApp\nOr cash at pickup.");
      cart = [];
      document.getElementById("cart-items").innerHTML = "";
      document.getElementById("checkout-form").classList.add("hidden");
      form.reset();
    } else {
      alert("❌ There was a problem submitting your order. Please try again.");
    }
  }).catch(() => {
    alert("❌ Could not connect to server. Please try again later.");
  });
});

// === Close Modal by Clicking Outside ===
document.getElementById("checkout-form")?.addEventListener("click", (e) => {
  if (e.target.id === "checkout-form") {
    closeModal();
  }
});
