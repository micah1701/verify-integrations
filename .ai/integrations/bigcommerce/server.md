# BigCommerce — Server (`server/bigcommerce/`)

Express handlers, CommonJS, extensionless imports. Shared pieces: `../core/db` (tokens), `./render-error` (HTML error page for the BC iframe).

## `auth.ts` — `GET /bigcommerce/auth`
1. Requires `code` and `context` query params (else 400 error page).
2. Requires env `BC_CLIENT_ID`, `BC_CLIENT_SECRET`, `APP_BASE_URL` (else 500 page).
3. `POST https://login.bigcommerce.com/oauth2/token` (form-encoded: `client_id, client_secret, code, scope, context, grant_type=authorization_code, redirect_uri=${APP_BASE_URL}/bigcommerce/auth`).
4. Non-OK → 502 page. OK → `storeHash = data.context.split('/')[1]`, `upsertToken({store_hash, access_token, scope})` (preserves `installed_at` on reinstall), `ensureExtensions()` (see app-extensions.md), then renders a static confirmation page (`render-install-success.ts`: "open from Apps → My Apps"). It does NOT redirect to `/admin/` — `/auth` has no signed payload, so the SPA there would have no store config. Route is served with `allowBcFraming` (BC shows it in an iframe).
- The `redirect_uri` must exactly equal the Auth Callback URL registered in the BC Developer Portal.

## `load.ts` — `GET /bigcommerce/load`
1. `signed_payload_jwt` required.
2. `jwt.verify(token, BC_CLIENT_SECRET, {algorithms:['HS256']})`; claims `sub: "stores/HASH"`.
3. `getToken(storeHash)`; none → 404 "Store Not Found" (reinstall).
4. Read `dist/admin/index.html` (path resolved from CWD: `path.resolve('dist/admin/index.html')` — **the server must run with the repo root as CWD**); missing → 500 "Build Missing".
5. Inject `<script>window.AdHocAdminConfig = {apiBase, storeHash, storeAccessToken}</script>` before `</head>`; `apiBase = ADHOC_API_BASE ?? https://edge.adhocverify.com/functions/v1`.
6. Headers: `Content-Type: text/html`, `Cache-Control: no-store`, remove `X-Frame-Options`, set `Content-Security-Policy: frame-ancestors 'self' https://*.bigcommerce.com https://*.mybigcommerce.com`.
- `JSON.stringify` of the config is embedded directly in a `<script>`; values come from our own store (hash/token), not user input. If you add user-controlled fields, escape `</script>` / `<!--`.

## `uninstall.ts` — `GET /bigcommerce/uninstall`
Verify JWT the same way (401 on failure) → `deleteToken(storeHash)` → respond **200** HTML (BC requires 200).

## `render-error.ts`
`renderError(title, detail)` returns a minimal HTML page with HTML-escaped inputs. Use for every failure shown inside the BC iframe.

## `proxy.ts` — Management API read proxy for the admin

Auth guard `resolveToken(storeHash)`: 400 if missing, 404 if no stored token. **There is no session auth** — see [`../../global/known-issues.md`](../../global/known-issues.md#admin-proxy-routes-are-unauthenticated).

`bcFetch<T>(storeHash, token, path)` → `fetch('https://api.bigcommerce.com/stores/<hash><path>', {X-Auth-Token})`. Returns `null` on non-2xx, empty body (v2 `/orders` returns an empty body, not `[]`, when there are none), or network error. Handlers translate `null` to 502 (lists) / 404 (detail).

| Handler | BC calls | Result |
|---|---|---|
| `handleCustomersList` | `GET /v3/customers?limit&page&sort=date_created:desc`, then **per customer** `GET /v3/customers/{id}/metafields?namespace=Ad-Hoc+Verify` (parallel) | `{data: EnrichedCustomer[], meta}` |
| `handleCustomerDetail` | `GET /v3/customers?id:in={id}` + metafields | `CustomerDetailResponse` |
| `handleOrdersList` | `GET /v2/orders?limit&page&sort=date_created&direction=desc` + `GET /v2/orders/count`; wave 1: `GET /v2/orders/{id}/metafields` per order; wave 2: customer metafields (deduped by customer id) for orders with no order metafield and `customer_id > 0` | `{data: EnrichedOrder[], meta.pagination}`; `metafieldSource: 'order'|'customer'|'none'` |
| `handleOrderDetail` | `GET /v2/orders/{id}` + `/metafields`; customer fallback + customer details | `OrderDetailResponse` incl. `linkedCustomer` |

Notes
- `page` ≥ 1, `limit` clamped to 1–50 (default 25).
- **N+1 fan-out**: a 50-row page makes ~50–100 BC calls. Mind BC rate limits when raising limits or adding calls.
- `parseVerifyMetafield` selects namespace `Ad-Hoc Verify`, key `verification`, and JSON-parses `value`.
- Order metafields are read from `/v2/orders/{id}/metafields` (the **order** resource), while the storefront writes via `bc-metafields` to **cart** metafields (resolved from `order → cart_id`). The first-wave order read will usually be empty, so most admin order rows currently show the *customer* fallback (or none for guests). If you change either side, verify both paths against a real order. This is worth a fresh look — see the TODO below.
- Local type copies + `evaluateVerificationState` with `DEFAULT_RULESET` (all rules off) — see known issues. Keep in sync with `src/core`.

> TODO / verify: confirm in a sandbox whether order-level metafields are ever written. `saveOrderMetafield` → `bc-metafields` `resource:'order'` → writes **cart** metafields (`/v3/carts/{cart_id}/metafields`), not `/v2/orders/{id}/metafields`. If guests' orders show "none" in the admin, this is why; the admin would need to read cart metafields via the order's `cart_id`.

## `router.ts`
Wires the routes in [`overview.md`](overview.md#routes-mounted-at-bigcommerce). Static mounts use `path.resolve('dist/...')` (CWD-relative).

## Logging
`console.log/warn/error` with `[auth] [load] [uninstall] [bc-proxy]` prefixes; pm2 captures it (`npm run logs`). Don't log tokens or JWTs.
