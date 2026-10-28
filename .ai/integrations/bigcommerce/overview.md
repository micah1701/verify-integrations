# BigCommerce Integration — Overview

Everything BigCommerce-specific. For platform-agnostic material see [`../../global/`](../../global/).

## What it does

A merchant installs the **Ad-Hoc Verify** app from BigCommerce. They configure a template (Integration Config tab) and paste a two-value snippet into Script Manager. Shoppers on cart/checkout see a "Verify ID" widget; completing the verification stores a result on BC metafields; checkout can be blocked/warned until verified; staff review results in the app's Customers/Orders tabs.

## Lifecycle

```
Install  : BC → GET /bigcommerce/auth?code&scope&context
           server exchanges code at login.bigcommerce.com/oauth2/token → upsertToken(store_hash) → 302 /bigcommerce/admin/
Open app : BC → GET /bigcommerce/load?signed_payload_jwt
           verify HS256 with BC_CLIENT_SECRET → getToken(store) → inject AdHocAdminConfig → serve SPA (no-store, frame-ancestors BC)
Use admin: SPA → GET /bigcommerce/api/{customers,orders}[/:id]?storeHash=…   (server calls api.bigcommerce.com with the OAuth token)
Uninstall: BC → GET /bigcommerce/uninstall?signed_payload_jwt → verify → deleteToken → 200
Shopper  : Script Manager loads bigcommerce.js on storefront pages (no server involvement)
```

## Routes (mounted at `/bigcommerce`)

| Route | Handler | Notes |
|---|---|---|
| `GET /auth` | `auth.ts` `handleAuth` | OAuth install |
| `GET /load` | `load.ts` `handleLoad` | JWT verify + config injection |
| `GET /uninstall` | `uninstall.ts` `handleUninstall` | JWT verify + delete token; must return 200 |
| `GET /api/customers` | `proxy.ts` `handleCustomersList` | `?storeHash&page&limit` (limit ≤ 50) |
| `GET /api/customers/:id` | `handleCustomerDetail` | |
| `GET /api/orders` | `handleOrdersList` | |
| `GET /api/orders/:id` | `handleOrderDetail` | |
| `GET /admin` | router | 301 → `/bigcommerce/admin/` (trailing slash needed for relative assets) |
| `/storefront/*` | `express.static(dist/storefront)` | serves `bigcommerce.js` |
| `/admin/*` | `express.static(dist/admin)` + SPA fallback to `index.html` | NB: fallback serves the **un-injected** HTML; the injected one only comes from `/load` |

Global: `GET /health` → `{status:'ok', ts}`.

## File map

| Concern | Files |
|---|---|
| Server | `server/bigcommerce/{router,auth,load,uninstall,proxy,render-error}.ts` → [`server.md`](server.md) |
| Storefront | `src/bigcommerce/storefront/{entry,bc-adapter,checkout-block,logger}.ts`, `components/{StatusCard,VerifyModal}.svelte` → [`storefront.md`](storefront.md), [`checkout-enforcement.md`](checkout-enforcement.md) |
| Metafields | `bc-adapter.ts`, `src/core/verify-api.ts` (`bcMetafieldsProxy`, `buildMetafieldPayload`), `supabase/functions/bc-metafields/index.ts` → [`metafields.md`](metafields.md) |
| Admin | `src/bigcommerce/admin/{App,index}.tsx`, `api/bc-proxy.ts`, `pages/{Customers,Orders,IntegrationConfig}Page.tsx` → [`admin-spa.md`](admin-spa.md) |
| Config | `src/core/types.ts` (`AdHocVerifyConfig`, `IntegrationConfig`) → [`config-reference.md`](config-reference.md) |
| Build | `vite.storefront.config.ts`, `vite.admin.config.ts` |

## BC-specific vocabulary

- **store hash** — short id in the store URL / `context: "stores/<hash>"`; the key of `tokens.json`.
- **Management API** — `https://api.bigcommerce.com/stores/<hash>/v2|v3/...`, server-side only, auth header `X-Auth-Token`.
- **Storefront API** — same-origin `/api/storefront/...` on the shopper's store; cookie-authenticated.
- **Script Manager** — BC control panel feature that injects scripts into storefront pages.
- **Stencil / Cornerstone** — BC's theme framework; the cart page uses Stencil regions (`[data-content-region="cart_below_totals"]`) and legacy `/remote/v1/cart/*` endpoints.
- **Checkout** — a React SPA (Optimized One-Page Checkout), so DOM is replaced on every step.
- **Cart ID == Checkout ID** in BC.
- **Metafield permission sets** — `write_and_sf_access` is what we use (see [`metafields.md`](metafields.md)).

## BC OAuth scopes

Two credentials, each with its own minimum scopes — full tables, rationale and setup checklist in [`permissions.md`](permissions.md). Summary:

- **Registered app** (server-side): Customers read-only, Orders read-only, Carts read-only, Products modify, App extensions manage.
- **Store-level API account** (merchant creates; token is exposed to the browser): Carts modify, Customers modify, Orders read-only, Products read-only (only for `product_flag`), Metafields standard. No Checkouts / Storefront-token scopes.

## External BC docs

See `RESOURCES.md`: Apps, REST Management API, BigDesign, REST Storefront Cart/Checkout APIs.
