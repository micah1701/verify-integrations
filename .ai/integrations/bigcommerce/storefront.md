# BigCommerce — Storefront Plugin (`src/bigcommerce/storefront/`)

Svelte 4 + TypeScript compiled to one IIFE (`dist/storefront/bigcommerce.js`). Entry: `entry.ts`. Loaded by Script Manager (footer, all pages):

```html
<script>
  window.AdHocVerifyConfig = { integrationKey: 'ahv_pub_…', templateId: '<uuid>' };
</script>
<script src="https://verify-integrations.ad-hoc.app/bigcommerce/storefront/bigcommerce.js"></script>
```

(See known issues re: the URL path in older docs.) Options: [`config-reference.md`](config-reference.md).

## Files

| File | Role |
|---|---|
| `entry.ts` | Orchestrator: config merge, page guard, init, verify flow, post-verification saves, name match, cart-trigger watcher, order confirmation |
| `bc-adapter.ts` | BC Storefront API + metafield load/save through the proxy, IndexedDB caching, `findVerificationMetafield`, `invalidateMetafieldCache` |
| `checkout-block.ts` | Checkout button blocking, warning banners, shipping-name notice → [`checkout-enforcement.md`](checkout-enforcement.md) |
| `logger.ts` | `setLogging(bool)` / `log()`; no-op unless `config.logging === true` |
| `components/StatusCard.svelte` | Renders state: verified badge / pending text / message + "Verify ID" button (emits `verify`) |
| `components/VerifyModal.svelte` | Overlay + iframe to `${verifyBase}/verify/${id}`; polls every 3 s and listens for `postMessage`; emits `complete` / `manual_review` / `close` |

## Boot sequence

1. **Config**: `defaults` ← `window.AdHocVerifyConfig` (shallow), with `ruleset` and `manualReview` deep-merged. No `integrationKey` → `console.error` and stop (no throw).
2. **Logger** initialised from `config.logging`.
3. **Page detection** (`detectPage`): `BCData.order_id` ⇒ `order-confirmation`; else path contains `/cart`, `/order-confirmation`, `/checkout` (in that precedence: cart, order-confirmation, checkout); else `null`.
4. **Guard**: if `currentPage ∈ config.pages` (default `['cart','checkout']`) run `bootstrap()`.
5. **`bootstrap()`**: on checkout install `installOrderIdCapture()`; if `userConfig.templateId`, `getTemplateIntegrationConfig()` → `applyRemoteConfig()`; then `init()`; then `watchCartTrigger()`.
6. **Order confirmation** is handled **independently of `pages`** by `handleOrderConfirmationPage()` (below).
7. Starts on `DOMContentLoaded` if the document is still loading.

### `applyRemoteConfig` precedence
For each of `storeHash, storeAccessToken, ruleset, manualReview, triggerRule, checkoutEnforcement, buttonText, selector`: apply the remote value **only if the same key is absent from `window.AdHocVerifyConfig`**. `ruleset`/`manualReview` are merged onto defaults. `pages` is never applied. Note it checks the *whole key* (e.g. a local partial `ruleset` blocks the remote `ruleset` entirely).

## `init()` (per page load, and again when a trigger rule newly matches)

1. `findOrCreateContainer()` — `#adhoc-verify-container` wrapper:
   - checkout: appended into `li.checkout-step--customer` (fallback `body`)
   - cart: `[data-content-region="cart_below_totals"]` else before `config.selector` / `[data-cart-totals]` / `form[action*="cart"]` else `body`
2. Show "Loading verification status…".
3. `loadCart()` → `{cartId, customerId, productIds}` from `/api/storefront/carts?include=lineItems…`. `null` ⇒ **degraded mode**: mount StatusCard `unverified` and return (no metafields, no enforcement).
4. Persist `cartId` to `sessionStorage[CART_ID_KEY]`.
5. **Trigger rule**: `evaluateTriggerRule(productIds, rule)` false ⇒ remove container and return.
6. Load cart + customer metafields in parallel via the proxy (skipped without `storeHash`/`storeAccessToken`); also prefetch customer JWT for logged-in users (cached 30 min; currently only warmed, result unused).
7. `resolveOverallState(cartMf, customerMf, ruleset)` → `{state, source, cartMfId, customerMfId}`; remember the metafield IDs for later PUT vs POST.
8. If `requireNameMatch` on checkout: insert the shipping-name notice.
9. **Carry-over paths** (all use `COMPLETED_KEY` in `sessionStorage`, and all re-resolve state, mount the card, apply enforcement, then `return`):
   - **Returning verified customer** (`state=verified`, `source=customer`): copy customer verification onto the new **cart** metafield and seed `COMPLETED_KEY` (so order confirmation can link it).
   - **Guest carry-over** (`customerId===0`, not verified, `COMPLETED_KEY` present): write it onto the new cart metafield.
   - **Backfill** (logged in, no customer metafield, `COMPLETED_KEY` present): write customer metafield.
10. Normal path: mount StatusCard with `resolved.state`, then apply enforcement:
    - `pending_review`: block only if `manualReview.blockCheckout` and on checkout.
    - not `verified` and on checkout: `getEffectiveEnforcement(config)` → `block` (with `getBlockReason` for completed-but-failed age checks) / `warn` / `none`.
    - `verified`: if `requireNameMatch` on checkout → `setupNameMatch()`; else nothing.

### `getEffectiveEnforcement`
`checkoutEnforcement.mode` if set, else legacy fallback `ruleset.requireVerification ? 'block' : 'none'`. (Default `requireVerification: true` ⇒ block by default.)

## Verification flow

`StatusCard` emits `verify` → `handleVerifyClick()`:
1. Guard against double-open (`modalWrapperEl`).
2. Reuse `sessionStorage[SESSION_KEY]` (pending ID) or `createVerification()` (`template_id` included when configured); store the ID.
3. Mount `VerifyModal` in a body-level wrapper.
4. Events:
   - `complete` → clear `SESSION_KEY`, destroy modal, `saveVerificationAndRefreshUI(id, result)`.
   - `manual_review` → `handleManualReviewResult(id)`.
   - `close` → destroy modal (pending ID kept so reopening resumes the same verification).
5. Errors → `console.error` + `alert('Unable to start verification. Please try again.')`.

### `saveVerificationAndRefreshUI`
Save **cart** metafield (+ **customer** if logged in) with status `completed` → `invalidateMetafieldCache` → set `COMPLETED_KEY` → `statusCardInstance.$set({state:'verified'})` → with `requireNameMatch` on checkout start name matching, else `removeCheckoutBlock()` → fire `onComplete(id)` and `onResult({...})`.

### `handleManualReviewResult`
Same saves with `status:'manual_review'` and `result:null`; StatusCard becomes `pending_review` with `manualReview.message` (`''/null/false` hides it); `blockCheckout` ⇒ `renderCheckoutBlock()` else `removeCheckoutBlock()`.

## Name match (`ruleset.requireNameMatch`)
- Needs `blockchain_name` from the outcome (or `getVerificationResult` fallback).
- `setupNameMatch` blocks checkout with *"Please enter your shipping name…"* until `watchShippingNameInputs` computes `SHA1(first+last+verificationId)` (normalised by `computeNameHash`) equal to `blockchain_name`. Mismatch ⇒ different block message.
- Inputs are discovered by `input[autocomplete="given-name"|"family-name"]` or `id*="firstName|lastName"`; a MutationObserver re-attaches after React re-renders. When BC collapses the form to read-only after "Continue", the last match state is preserved.

## Cart trigger watcher (`watchCartTrigger`)
Only when `triggerRule.mode !== 'always'`. Monkey-patches `window.fetch` and `XMLHttpRequest` to catch cart mutations (`/api/storefront/carts` POST/PUT/DELETE; legacy `/remote/v1/cart/{add,update,remove}` POST). Debounced 150 ms → `recheckTriggerRule()` shows (calls `init()`) or hides the widget as the cart changes.

## Order ID capture & confirmation
- `installOrderIdCapture()` (checkout only): wraps `fetch`; on `POST /api/storefront/checkouts/{id}/orders` stores `data.id ?? data.orderId` in `sessionStorage[ORDER_ID_KEY]`.
- `handleOrderConfirmationPage()` (runs on `order-confirmation` regardless of `pages`):
  1. If creds missing and `templateId` set → fetch remote config just for `storeHash`/`storeAccessToken`.
  2. Needs creds and `COMPLETED_KEY`.
  3. Order ID = `BCData.order_id` → `/order-confirmation/<digits>` in path → `ORDER_ID_KEY`.
  4. `saveOrderMetafield()` (non-fatal on failure).

## sessionStorage keys (all suffixed with the integration key)

| Const | Key | Lifetime | Meaning |
|---|---|---|---|
| `SESSION_KEY` | `adhoc_verify_pending_<key>` | set at modal open, cleared on complete/manual review | In-progress verification ID (resume on reopen) |
| `COMPLETED_KEY` | `adhoc_verify_done_<key>` | tab session | `{verificationId, result, status}` for carry-over, backfill and order write |
| `CART_ID_KEY` | `adhoc_verify_cartid_<key>` | tab session | Cart ID for confirmation page |
| `ORDER_ID_KEY` | `adhoc_verify_orderid_<key>` | tab session | Order ID captured at checkout |

IndexedDB (`adhoc_verify_cache`): `adhoc_customer_jwt` (30 min), `adhoc_cart_mf_<cartId>`, `adhoc_customer_mf_<customerId>` (5 min). Always invalidate the two metafield keys after any write.

## Debugging
Set `logging: true` in `AdHocVerifyConfig` and filter the console by `[AD-HOC VERIFY]`. See [`../../skills/debug-storefront.md`](../../skills/debug-storefront.md).
