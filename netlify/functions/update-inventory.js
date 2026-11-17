// Order requests no longer deduct stock. Paid checkout uses the reservation RPC.
exports.handler = async () => ({
  statusCode: 410,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ error: "Inventory updates moved to checkout and admin." })
});
