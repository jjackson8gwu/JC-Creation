# USPS shipping preview setup — J&C Creations

This adds a separate shipping checkout to the working pickup pilot. It is disabled until `STRIPE_SHIPPING_ENABLED` is set to `true`. No live deployment or Supabase migration was performed by the coding agent.

## Agreed rules

- Ship from ZIP **28150** to the contiguous 48 states and Washington, DC. No Alaska, Hawaii, territories, military mail, or international addresses.
- Standard packaging allowance: **7 oz**, added once to the entire cart.
- Packed weight **up to and including 16 oz: $10** shipping.
- Packed weight **over 16 oz through 32 oz: $13** shipping.
- Above 32 oz, unmeasured items, pickup-only items, and items marked quote required use the existing order-request route.
- Custom options, color selections, made-to-order items, variable prices, and promotional discounts still require order requests in this pilot.
- Fees are your flat shipping charges, not live Pirate Ship quotes. Buy the USPS label in Pirate Ship after payment as you do now. No Pirate Ship credentials or integration are required.
- Standard eligibility means the owner has checked packaging suitability. The calculator estimates weight; it does not solve how a mixed cart fits into a box. Keep bulky items/bundles on the quote route.

## 1. Apply the shipping database setup

Use the Supabase project connected to the preview. The preview admin client currently targets project `ldgdubwptbxqrtjghxau`; server `SUPABASE_URL` must match it. Keep Stripe in the working sandbox/test environment during these steps.

1. Open https://supabase.com/dashboard/project/ldgdubwptbxqrtjghxau.
2. In the left sidebar, click **SQL Editor**.
3. Click **New query** or **+**.
4. Open `stripe_shipping.sql` from this repository (a local copy is supplied with these instructions). Copy the entire file, from its introductory comment through `commit;`.
5. Paste it into the new SQL query. Do not paste into Table Editor, Netlify, or Stripe.
6. Click **Run**. Expect **Success. No rows returned**.
7. If there is an error, stop and send the error text. Do not rerun the old orders schema or disable RLS.

The new file is additive. It adds shipping fields, a settings row, a private shipping-checkout ledger, server-only functions, and shipping/tax amounts on orders. It does not change inventory quantities or replace existing product/order security policies. Rerunning it preserves existing nonempty weights and shipping eligibility.

It fills estimates only where `shipping_weight_oz` is empty:

| Product group | Item weight | One item plus packaging |
|---|---:|---:|
| $1/$2/$3 minis | 1 oz | 8 oz |
| Dragon-named products in Dragons & Animals | 5 oz | 12 oz |
| Pokeballs | 8 oz | 15 oz |
| Fidgets | 4 oz | 11 oz |
| Other products | Blank; owner supplies weight | Quote required |

These are conservative estimates, not measured values for every individual product. All products initially require a quote until the owner enables standard shipping. Previously edited shipping modes remain unchanged.

## 2. Wait for the preview deployment

1. Open Netlify and select **jccreations**.
2. Click **Deploys**.
3. Find the newest **Deploy Preview #2** for the `stripe-pickup-checkout` branch, titled **Add weight-based USPS shipping checkout and admin controls**.
4. Wait for a successful deployment.
5. Open https://deploy-preview-2--jccreations.netlify.app/admin.html, refresh, and sign in with the website admin credentials you already created.

## 3. Enable one product for the first test

1. In **Inventory**, find an in-stock item without color choices, custom options, variable pricing, or made-to-order status.
2. Its new **Shipping** column should show an estimated weight. Correct the weight if needed.
3. Change its eligibility from **Quote required** to **Standard shipping**, provided it fits your standard packaging.
4. Click **Save Changes** at the top, or **Save All Changes** in the bottom changes bar.
5. Refresh and confirm the weight and shipping eligibility were saved.

You can also use **Edit → Shipping**. The editor provides 1, 4, 5, and 8 oz presets and a field for a custom weight. New products start on quote required.

After the first checkout test passes, you can stage changes for a category:

1. Choose the category in the inventory filter, such as **$1 Minis**.
2. Under **Set shipping for the products in this filter**, choose **Standard shipping**.
3. Click **Apply to filtered products**.
4. Review the rows. This stages unsaved changes and skips unmeasured/custom items. Bulky exceptions should stay quote required.
5. Click **Save Changes**. Repeat only for groups you have checked for packaging suitability.

## 4. Enable shipping in the Deploy Preview context

Keep the existing working Stripe/Supabase variables. This feature uses the same sandbox keys and the existing webhook destination.

1. In Netlify, open **jccreations → Project configuration → Environment variables**.
2. Click **Add a variable → Add a single variable**.
3. Set **Key** to `STRIPE_SHIPPING_ENABLED`.
4. Set its value for **Deploy Previews** to `true` (lowercase). Keep the production value `false` or unset. Use context-specific values rather than a global live setting.
5. If scopes are selectable, include **Functions**. Save the variable.
6. Return to **Deploys**, open the latest **Deploy Preview #2**, and use **Retry deploy → Deploy latest branch commit**. Wait for it to finish.
7. Open https://deploy-preview-2--jccreations.netlify.app/.netlify/functions/shipping-checkout. It should show `{"available":true}`. This confirms the setting is present; the actual checkout test below verifies the database and Stripe integration.

## 5. Test the shipping payment

Use a new private window (Shift–Command–N) for each independent purchase test, so you do not reuse a completed checkout.

1. Open https://deploy-preview-2--jccreations.netlify.app.
2. Add the product you marked standard shipping.
3. Open **Cart → Proceed to Checkout**.
4. Fill out your contact information and a real, valid shipping address in the contiguous US. This address will be saved in Supabase and Stripe for fulfillment.
5. Choose **Shipping** in **Delivery Method**.
6. Click **Calculate shipping**. It should show the packed weight and shipping charge, along with the items-plus-shipping total before any applicable tax.
7. Check the address. Click **Pay by card with shipping**. Do not click **Submit Order** for this payment test; that button sends an unpaid order request through Formspree.
8. On Stripe, confirm the items, shipping, any tax, and the fixed delivery address shown in the checkout message. To change the delivery address, return to the store and correct it before paying. Stripe's separate billing address can be different.
9. Complete the payment in the same sandbox/test mode used for the successful pickup test.
10. Open the preview admin's **Orders** tab. Confirm `Paid`, correct items/contact, and the shipping/tax amounts. Expand **Delivery details** to see the shipping address. Shipping and tax are attached to the first product line only, so a multi-item order total counts them once.
11. In Supabase, `shipping_checkouts` should show `paid`; inventory should decrease once. This feature uses a separate ledger from `pickup_checkouts`.

Example checks, when enough stock is available and the products are enabled:

| Cart | Estimated packed weight | Shipping |
|---|---:|---:|
| One 8 oz Pokeball | 15 oz | $10 |
| Two 8 oz Pokeballs | 23 oz | $13 |
| Four 8 oz Pokeballs | 39 oz | Quote required |
| Nine 1 oz minis | 16 oz | $10 |
| Ten 1 oz minis | 17 oz | $13 |

Also test an Alaska/Hawaii/territory address: checkout should reject it before stock is reserved. Standard US region/ZIP checks are not a complete carrier address-validation service; confirm addresses when buying labels.

## 6. Test expiry and recover the old test reservation

To test automatic expiration, the test MUST reach Stripe's payment page. A cart-only test does not reserve stock.

1. Record an eligible item's inventory count.
2. In a fresh private window, create a shipping checkout and stop at Stripe's payment page.
3. Do not pay; close that window.
4. After 45 minutes plus webhook delivery time, confirm that `shipping_checkouts.state` becomes `expired` and the stock returns once. No paid order should be created for that attempt.

For an old Frog Hatchling test reservation:

1. Keep the current sandbox/test Stripe keys in the preview.
2. Open preview **Admin → Inventory**.
3. Click **Check expired checkout reservations**.
4. Read the confirmation and confirm only when the preview is connected to the same Stripe account used for the old tests. Do not manually add stock back first.
5. The tool searches Stripe for matching sessions. Paid sessions are finalized as orders; unpaid open sessions must be expired before stock is returned. A stale hold with no matching Stripe session can be released after a full successful search and a 15-minute grace period.
6. Read the report for that reservation ID, then refresh inventory and the read-only hold report. If verification fails, the tool leaves the hold for review rather than guessing.

New shipping reservations save their Stripe account/mode. The hourly recovery job operates on matching shipping reservations only and can recover failed session creation or missed expiry events. Netlify schedules run automatically only on published deploys; the preview uses the admin recovery button or Netlify's scheduled-function **Run now** control. Legacy unlinked pickup holds can be checked through the test-mode admin tool; they are not automatically released with live keys.

## 7. Alerts and labels

- Enable successful-payment alerts for the Stripe user associated with your chosen owner email under https://dashboard.stripe.com/settings/communication-preferences. The website code does not change that account preference or send custom email by itself.
- Keep Formspree notifications for unpaid order requests. Card-payment orders are recorded by the Stripe webhook; they do not submit Formspree.
- Enable customer receipts separately under https://dashboard.stripe.com/settings/emails. Automatic receipts apply to live payments; test receipts must be sent manually.
- Use the address under admin **Delivery details** when purchasing your USPS label in Pirate Ship. Label buying and tracking updates are still manual.
- Pickup messaging says you will contact the buyer to arrange pickup when ready. Shipping messaging says you will contact the buyer when the order is ready to ship.

## Before going live

The original successful payment tests covered pickup only. Local checks covered shipping calculation, database functions, signed webhook routing, recovery guards, and customer/admin screens using fictional data. A real Stripe sandbox shipping payment and expiry test remain required after this setup.

Keep shipping disabled in production until those tests pass, the old stock holds are reconciled, public pickup/shipping policies are settled, and live Stripe keys/webhook/tax settings are configured. The existing `STRIPE_AUTOMATIC_TAX` setting is preserved. For shipping, a Stripe Customer is created with the saved delivery address so Stripe Tax can use that destination even when the payer enters a different billing address.

The delivery address is captured and validated on the website before checkout, then shown as fixed fulfillment information in Stripe. Billing address edits do not change the order's delivery address. The current checkout does not allow changing the delivery address inside Stripe.

## Developer validation

Run `node --test tests/*.test.js` for the JavaScript tests. Database integration checks use a temporary PGlite installation and the `PGLITE_TEST_MODULE` environment variable pointing at that package. They exercise the real SQL migrations and functions without connecting to Supabase. The database test is explicitly skipped if PGlite is not configured. No test uses real API keys or customer data.

Sources: https://docs.stripe.com/tax/checkout/page and https://docs.netlify.com/build/functions/scheduled-functions/.
