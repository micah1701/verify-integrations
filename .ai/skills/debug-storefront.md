# Skill: Debug the Storefront Plugin (BigCommerce)

Turn on logs first: `window.AdHocVerifyConfig.logging = true`, then filter the browser console by `[AD-HOC VERIFY]`. Also keep the Network tab open (filter `bc-metafields`, `get-template-config`, `create-verification`, `get-verification-result`, `api/storefront`).

## "Change I deployed isn't showing"
Cloudflare cache of `bigcommerce.js` / `assets/index.js`. Purge cache (or hard reload with cache disabled) **before** debugging code. See [`deployment.md`](../global/deployment.md#cloudflare-caching). Also confirm `npm run build:storefront` ran and (for `ADHOC_BC_CLIENT_ID`) that `.env` was present at build.

## Widget doesn't appear
1. Log line `Plugin loaded. Merged config` missing ⇒ script not loaded or `integrationKey` missing (`console.error`).
2. `Page detection: … active=false` ⇒ page not in `pages` (script tag only; default cart+checkout) or path not recognised by `detectPage`.
3. `Trigger rule … widget hidden` ⇒ cart doesn't match `triggerRule`.
4. `loadCart: … returning null` ⇒ no cart yet or Storefront API failed ⇒ degraded unverified card (still appears); no container at all means a different cause.
5. Container inserted in the wrong place ⇒ theme lacks `[data-content-region="cart_below_totals"]`; set `selector`.

## Remote config not applied
- `templateId` set? Look for `Remote integration_config fetch failed (status)`: 401 key invalid / origin not on allowlist (403), 404 wrong template.
- Remember script-tag values **win** and a local partial `ruleset`/`manualReview` blocks the whole remote object.
- `pages` is never remote.

## State is wrong / stale
- Metafields cached 5 min in IndexedDB (`adhoc_cart_mf_*`, `adhoc_customer_mf_*`). Clear site data or wait; code must call `invalidateMetafieldCache` after writes.
- Customer metafield beats cart. A stale customer `invalid` + fresh cart `verified` resolves to verified (verified from either wins).
- `bcMetafieldsProxy` returns `null` on any non-2xx — look at the `bc-metafields` response in the Network tab (401 bad token, 404, 422 order has no cart_id).
- Missing `storeHash`/`storeAccessToken` ⇒ log "skipping metafield fetch" and state is always `unverified`.

## Checkout not blocked
- Enforcement only applies on `checkout` and for non-verified states; `warn` never blocks; `none` does nothing. Effective mode logged as `enforcement=…`.
- BC changed button markup ⇒ update `findCheckoutButton()` selectors ("checkout button not found in DOM yet" repeating).
- `pending_review` blocks only with `manualReview.blockCheckout`.

## Order not linked / admin shows no verification for an order
- Confirmation page log: "could not determine order ID" ⇒ the fetch interceptor didn't see `POST /api/storefront/checkouts/*/orders` (e.g. the theme/checkout used a different call, or the page was reloaded in a new tab so `sessionStorage` is empty).
- `COMPLETED_KEY` is per-tab `sessionStorage`; a different tab/browser has nothing to write.
- Order writes go to **cart** metafields via `order → cart_id` (not order metafields) — see the TODO in [`server.md`](../integrations/bigcommerce/server.md).

## Name match stuck
Logs `Name match state:`; input discovery uses `autocomplete="given-name|family-name"` or ids containing `firstName|lastName`. Needs `blockchain_name` on the outcome; if absent, `getVerificationResult` is tried.

## Verification modal problems
- Iframe blank/camera denied: the parent page must allow `camera; microphone` (the iframe has `allow`); check the site's own Permissions-Policy.
- `Unable to start verification` alert ⇒ `create-verification` failed (allowlist 403, bad key, network).
- Modal never completes: check polling (`get-verification-result`) every 3 s and the `adhoc-verify-complete` `postMessage`.

## Admin side
- `/load` 404 "Store Not Found": `data/tokens.json` lacks the store (reinstall; check `DATABASE_PATH` and process CWD).
- `Build Missing`: run `npm run build:admin` (server reads `dist/admin/index.html` relative to CWD).
- Customer/order lists "Failed to load": `[bc-proxy] BC API <status>` in pm2 logs (`npm run logs`); usually missing OAuth scopes or rate limiting.
