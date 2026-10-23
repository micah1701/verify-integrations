# Design Decisions (the WHY)

Read the relevant section before changing a core system.

---

## Backend owns OAuth; storefront stays serverless
The Express server handles app install, the admin dashboard, and admin data reads. The storefront plugin talks only to Ad-Hoc Verify + the store's own Storefront API. **Why:** merchants can add the plugin with a one-line script tag and no dependence on our uptime for the shopper experience; the Integration Key is public by design.

## Config injection at load time
`handleLoad` reads `dist/admin/index.html`, injects `<script>window.AdHocAdminConfig = {...}</script>` before `</head>`, serves it `no-store`. **Why:** avoids sessions, cookies (third-party cookies in the BC iframe are unreliable) and client-side token passing. **Cost:** the OAuth access token is present in the page source for the logged-in merchant (see [`known-issues.md`](known-issues.md#admin-proxy-routes-are-unauthenticated)).

## JSON file token store
`server/core/db.ts` → `data/tokens.json` with atomic temp-file-then-rename. **Why:** no native addon/DB to provision on the host; the volume is a handful of stores. **Constraint:** single process, no locking. The three-function interface is the contract so SQLite/Postgres can replace it later.

## CJS for server, ESM for frontend
`tsconfig.server.json` emits CommonJS to `dist/server/`; `postbuild:server` drops a `package.json` with `{"type":"commonjs"}` there to override the root `"type":"module"`. **Why:** the server toolchain (`jsonwebtoken`, Express, pm2) is simpler in CJS; Vite builds are unaffected.

## Svelte for storefront, React for admin
Svelte compiles to a very small self-contained IIFE — critical for Script Manager injection on every storefront page. React + BigDesign is required for BC app compliance in the control panel. **Don't unify them.**

## Single-file IIFE storefront bundle
Script Manager takes one `<script src>`. CSS is injected from JS, assets are inlined, format is `iife`. **Why:** no extra network requests/CSP concerns on merchant stores.

## Two BigCommerce credentials
1. **OAuth app token** (obtained at install, stored server-side): used by *our server* for admin data (Customers/Orders read).
2. **Store-level API account token** (`storeAccessToken`, created by the merchant): used by the *storefront* via the `bc-metafields` proxy to read/write Carts/Customers metafields.

**Why both:** the storefront cannot call `api.bigcommerce.com` directly (CORS) and must not hold our OAuth token; the OAuth token can't be given to the browser. Metafields are written with `permission_set: 'write_and_sf_access'` so *either* credential type can read them — `app_only` would bind a metafield to the credential that wrote it and hide it from the other.

## Template-driven storefront config (`integration_config`)
The Script Manager snippet needs only `integrationKey` + `templateId`; the rest is fetched at boot from `GET /get-template-config`. Values explicitly set in `window.AdHocVerifyConfig` **always win**. **Why:** merchants edit behaviour (ruleset, enforcement, text) without touching theme scripts; we can ship new options without merchants re-pasting snippets.

## `pages` is script-tag-only
The page guard (`currentPage ∈ configPages`) runs synchronously when the bundle loads, before the async remote fetch resolves. A remote `pages` value would arrive too late, so `applyRemoteConfig` deliberately ignores it. Default is `['cart', 'checkout']`. (`IntegrationConfig.pages` exists in the type and sanitizer but has no runtime effect and no admin field — see known issues.)

## Order-confirmation page is always processed
Even if `'order-confirmation'` isn't in `pages`, `handleOrderConfirmationPage()` runs on that page to link the verification to the order metafield. If credentials weren't loaded (no bootstrap ran) it fetches the remote config itself, just for `storeHash`/`storeAccessToken`.

## Order ID capture by fetch interception
On checkout, `installOrderIdCapture()` wraps `window.fetch` and records the ID from `POST /api/storefront/checkouts/{id}/orders` into `sessionStorage`. **Why:** `BCData.order_id` is empty for guests and the checkouts API returns 401 for guests after the order is placed (the checkout record is deleted). The confirmation page reads: `BCData.order_id` → URL path → captured ID.

## Cart/customer/order metafield linking
Verification is stored on the **cart** (always), the **customer** (if logged in) and the **order** (on confirmation). Orders resolve through `cart_id` because cart metafields persist after checkout and work for guests. Customer metafield takes precedence over cart in `resolveOverallState`. Session carry-over (`COMPLETED_KEY`) handles: guest→new cart, guest→logs in (backfill customer), returning verified customer→new cart (propagate).

## Checkout blocking: capture-phase listener + MutationObserver
BC's checkout is a React SPA; `button.disabled = true` is reset on re-render. We use a **capturing click listener** (runs before React's synthetic events) plus `pointer-events:none` styling, and a MutationObserver to re-attach when React replaces the node. See [`../integrations/bigcommerce/checkout-enforcement.md`](../integrations/bigcommerce/checkout-enforcement.md). This is a UX control, not a security boundary — a determined user can bypass client-side blocking (see known issues).

## Metafield values hold only safe outcome fields
`{verificationId, status, completedAt, verification:{success, over_18, over_21, face_match_score, blockchain_name}}`. No PII, no images. Merchants can still pull full results via the Ad-Hoc Verify REST API/webhooks if they requested fields.

## Server-side evaluation uses defaults
The admin proxy computes `verificationState` with a hard-coded `DEFAULT_RULESET` (all rules off) because the server doesn't know a merchant's template ruleset. So "Verified" in the admin list means "completed", not "passes the merchant's rules". See [`known-issues.md`](known-issues.md#admin-state-ignores-the-merchants-ruleset).

## Deployment behind Cloudflare
Stable-named assets (`bigcommerce.js`, `assets/index.js`) are cacheable by Cloudflare. After deploying, purge cache or set a Cache Rule (bypass/short TTL) for `/bigcommerce/storefront/*` and `/bigcommerce/admin/assets/*`. See [`deployment.md`](deployment.md#cloudflare-caching).
