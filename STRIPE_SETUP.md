# Test Stripe pickup checkout

Use a Netlify deploy preview with a separate Supabase project containing a test catalog and the existing orders schema. The storefront and admin currently have a Supabase project URL and public key in their client code. Point those copies at the test project too. Do not test by connecting a preview to production stock.

1. Create an admin user in the test Supabase project and set its **app metadata** to include `{"jcc_admin": true}`. Use a unique password and sign in fresh after setting the metadata.
2. Review the existing Supabase policies before applying `stripe_pickup.sql`. The migration replaces all policies on `products` and `orders`, gives the public read access to the catalog, and limits writes and order access to the owner account and server. Check other integrations that currently write to these tables. Confirm admin image uploads still work under your storage policies.
3. Add these Netlify environment variables to the deploy preview. Keep secrets in Netlify. Put no keys in Git or public JavaScript.

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Test project URL |
| `SUPABASE_SERVICE_KEY` | Test project's server-only service role key |
| `STRIPE_SECRET_KEY` | Stripe test-mode secret key |
| `STRIPE_WEBHOOK_SECRET` | The test endpoint's signing secret |
| `STRIPE_CHECKOUT_ORIGIN` | HTTPS origin of the preview storefront |
| `STRIPE_PICKUP_PRODUCTS` | Comma-separated Supabase product IDs. Start with one low-price, in-stock item without custom options. |
| `STRIPE_AUTOMATIC_TAX` | Set to `true` after configuring Stripe Tax if using automatic tax. Confirm the intended tax treatment before accepting live orders. |
| `STRIPE_PICKUP_ENABLED` | `true` when ready to try the preview |

4. In Stripe test mode, register the preview's `/.netlify/functions/stripe-webhook` endpoint for `checkout.session.completed` and `checkout.session.expired`. Save its signing secret in Netlify and redeploy the preview.
5. Test a successful payment, a declined card, reopening a cancelled checkout, and expiry. Verify the Orders tab contains exactly one paid line per item on success and that expired sessions return their stock. Verify two checkout attempts competing for the last unit cannot both reserve it. Check that the Forms­pree order-request path still works for shipping and special orders. Also verify that the admin can sign in, reject stale stock counts, and upload an image.

## Before using live keys

- Confirm pickup instructions and the tax treatment. Enable Stripe receipts if you want Stripe to send the customer a payment receipt. The pilot records paid items in the existing Orders tab. Its unit prices show the item subtotal, and Stripe remains the record for the full charge and any tax.
- Review legacy promotion, customer data, and storage policies. The migration replaces the order and product policies only.
- Keep dashboard access handy for the pilot. A session creation failure after a stock hold can leave stock held without a Stripe expiry event. Check the reservation ID in the Netlify log against Stripe before releasing anything. Confirm that no Stripe session can still accept payment, then restore stock and mark the hold expired in one database transaction. Do not modify or delete catalog items while a hold is open. A refund does not automatically restock an item.
- Use separate live credentials and a live webhook only after the preview checks pass. Continue using order requests for shipping, color choices, discounts, and custom work until those flows have their own checkout rules.
