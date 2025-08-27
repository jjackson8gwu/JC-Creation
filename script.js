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

document.getElementById("delivery")?.addEventListener("change", (e) => {
  if (e.target.value === "shipping") {
    alert("Shipping will be calculated when invoice is sent.");
  }
});

// Example using Formspree for email
document.getElementById("orderForm")?.addEventListener("submit", function(e) {
  e.preventDefault();
  fetch("https://formspree.io/f/yourFormID", {
    method: "POST",
    body: new FormData(this),
    headers: { 'Accept': 'application/json' }
  }).then(() => {
    alert("Order submitted! Please pay via Venmo: @YourVenmo or CashApp: $YourCashApp");
    cart = [];
    document.getElementById("cart-items").innerHTML = "";
    document.getElementById("checkout-form").classList.add("hidden");
  });
});
// Auto-scrolling carousel
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
