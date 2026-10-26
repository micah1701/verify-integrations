# Known Issues, Gaps & Doc/Code Mismatches

Verified against the code when this file was written. Fix or update an entry when you touch the area. Security-relevant items first.

---

## Security-relevant

### Admin proxy routes are unauthenticated
`GET /bigcommerce/api/customers|orders[...]` (`server/bigcommerce/proxy.ts`) authorise only by `?storeHash=`; anyone who knows or guesses a store hash can read that store's customer/order lists (names, emails, order totals) through our OAuth token. The `/load` JWT is verified once but nothing binds the later API calls to that session. A fix would issue a short-lived signed session token from `/load` (e.g., HS256 with a server secret or a cookie/`Authorization` header injected into `AdHocAdminConfig`) and require it in the proxy routes. Until then: don't add proxy routes that expose more than the existing ones, and don't describe them as protected.

### OAuth access token is embedded in the admin HTML
`/load` injects `storeAccessToken` (the OAuth token) into `window.AdHocAdminConfig`. The admin SPA doesn't actually use it (it calls our proxy, which reads the token from `tokens.json`). Removing it from the config would shrink the exposure. `AdHocAdminConfig.storeAccessToken` is typed but unused by pages.

### Store-level API token is delivered to every shopper
`storeAccessToken` (Carts + Customers read/write) is stored in `integration_config` and returned by `get-template-config` to anyone holding the (public) Integration Key from an allowed origin, and is sent in the body of every `bc-metafields` call. This is inherent to the serverless-storefront design; mitigate by giving the BC store-level account the **minimum scopes** and relying on the domain allowlist. Don't widen the scopes.

### `bc-metafields` is an open relay for any BC token
It validates only shape (`storeHash` alnum, token present). Anyone with a valid store hash + token can use it, which is acceptable (they already hold the token), but it also means it should not be given any secret of ours.

### Checkout blocking is client-side only
`checkout-block.ts` disables the Place Order button in the browser. Orders can still be placed by scripted requests. Merchants who need hard enforcement must act on the order's `Ad-Hoc Verify` metafield (admin lists / order status workflow).

### Admin state ignores the merchant's ruleset
`server/bigcommerce/proxy.ts` evaluates `verificationState` with `DEFAULT_RULESET` (everything off), so any completed verification shows **Verified** in the admin lists even if the storefront ruleset (age / face-match minimum) would have judged it `invalid`. Only `pending_review` / `incomplete` / `unverified` are accurate. Fix: have the admin pass the template ruleset (it fetches it on the Integration Config tab) or evaluate in the SPA with `src/core/verification-state.ts`.

---

## Order verification may be written to cart, read from order
`saveOrderMetafield` → `bc-metafields` (`resource:'order'`) resolves `order → cart_id` and writes **cart** metafields. The admin proxy reads `/v2/orders/{id}/metafields` (order-level) and falls back to the customer. Guest orders may therefore appear as unverified in the admin even though the cart carries the record. **Spec-verified:** the v2 orders API has **no** `/v2/orders/{id}/metafields` endpoint (check: `npm run bc:api -- paths admin-management-orders`); order metafields exist only in v3 (`GET /v3/orders/{order_id}/metafields`, spec `admin-management-order-operations`). So the admin proxy's order-level read almost certainly always returns nothing and the rows fall through to the customer fallback. Fix options: read `/v3/orders/{id}/metafields`, or read the order's `cart_id` cart metafields. Still unverified against a live store (details in [`../integrations/bigcommerce/server.md`](../integrations/bigcommerce/server.md)).

## Duplicated evaluation logic
`proxy.ts` re-declares types and `evaluateVerificationState` because `server/` can't import `src/`. Any change to `src/core/verification-state.ts` or the matching types in `src/core/types.ts` must be mirrored by hand (or the duplication removed by widening `rootDir`/path mapping).

## Storefront bundle URL in docs vs router
`README.md` / `INTEGRATION.md` snippets use `https://verify-integrations.ad-hoc.app/storefront/bigcommerce.js`; the router serves it at `/bigcommerce/storefront/bigcommerce.js`. Confirm which one production actually serves (Apache/Cloudflare rewrite?) before telling a merchant a URL.

## `pages` default documented inconsistently
Code default: `['cart','checkout']` (README config table is right). `INTEGRATION.md`'s plugin table says `['cart']`. `entry.ts` falls back to `['cart']` only if `config.pages` isn't an array. `IntegrationConfig.pages` exists in the type and the sanitizer, but the admin form has no Pages field and the storefront ignores remote `pages` (by design — see design-decisions). Set `pages` in the script tag only.

## `PORT` default
`.env.example` says `PORT=3000` and the code defaults to 3000; README dev instructions and production use 3033. Set `PORT` explicitly.

## `CLAUDE.md` / `README.md` file names
Both mention `CustomerVerificationPage.tsx` / `OrderVerificationPage.tsx`. Actual files are `CustomersPage.tsx` / `OrdersPage.tsx`; `server/bigcommerce/proxy.ts` and `src/bigcommerce/admin/api/bc-proxy.ts` are missing from their trees. The `.ai/` docs use the real names.

## Storefront UX rough edges (not bugs per se)
- `handleVerifyClick` uses `alert()` on failure to start verification.
- `removeShippingNameNotice()` exists but is never called, and `_nameMatchState` is assigned but never read.
- `handleOrderConfirmationPage` has a redundant duplicate `if (!orderId)` check.
- `watchCartTrigger()` wraps `window.fetch` and `XMLHttpRequest` globally (only when trigger mode ≠ `always`); `installOrderIdCapture()` wraps `fetch` again on checkout. Wrappers stack; keep them side-effect-free and always return the original response.
- `checkout-block.ts` `renderCheckoutWarn` uses a `position:fixed` full-width banner; `renderCheckoutBlock` inserts inline. Different placement by design.
- Svelte 4 imports rely on `svelte.config.js`; `tsconfig` types list is `["svelte"]` only.

## Token store limits
`db.ts` has no locking and reads the whole file on every call. Concurrent writes from two processes would lose updates. pm2 must stay in single-instance (fork) mode.

## No automated tests
There is no test runner or CI config in the repo. See "Testing / Verification" in [`rules.md`](rules.md).
