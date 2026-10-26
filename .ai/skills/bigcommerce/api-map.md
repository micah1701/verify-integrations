# API Map — Which Spec Covers What

Spec names are what `bc-api.mjs` takes (`paths <spec>` / `show <spec> …`; unique substrings work). Full list: `node .ai/skills/bigcommerce/scripts/bc-api.mjs list`.

## Resources this repo already touches

| Resource | Spec | Endpoints we use / will likely need | Where in code |
|---|---|---|---|
| Customers (v3) | `admin-management-customers-v3` | `GET /v3/customers` (`id:in`, `sort`), `…/{id}/metafields` (+ `?namespace=`) | `server/bigcommerce/proxy.ts` |
| Orders (v2) | `admin-management-orders` | `GET /v2/orders`, `/v2/orders/{id}`, `/v2/orders/count` | `proxy.ts` |
| **Order metafields (v3)** | `admin-management-order-operations` | `GET/POST /v3/orders/{order_id}/metafields` | **not used yet** — see [known-issues](../../global/known-issues.md) |
| Carts + cart metafields | `admin-management-carts` | `/v3/carts/{cart_id}/metafields` | `supabase/functions/bc-metafields` |
| Storefront cart (shopper-side) | `storefront-carts` | `/api/storefront/carts` | `bc-adapter.ts` |
| Storefront checkout | `storefront-checkouts` | `/api/storefront/checkouts/{id}` | `checkout-block.ts` / `bc-adapter.ts` |
| Current-customer JWT | `admin-authentication-current-customer` | `GET /customer/current.jwt?app_client_id=` (storefront) | `bc-adapter.ts` |

## Resources likely to matter next

| Need | Spec | Notes |
|---|---|---|
| Auto-install the storefront bundle | `admin-management-scripts` | Script Manager as an API — see [`scripts-and-webhooks.md`](scripts-and-webhooks.md) |
| React to orders/carts/customers | `integrations-webhooks` | `/v3/hooks`; destination must be HTTPS on 443 |
| Order status changes, refunds | `admin-management-order-operations` | v3 order ops: transactions, refunds, shipments, metafields |
| Customer groups / segments | `admin-management-customer-segmentation`, `admin-management-customers-v2` | v2 has customer groups |
| Multi-storefront scoping | `admin-management-channels`, `admin-management-sites` | Many resources take `channel_id` |
| Store settings, logo, locale | `admin-management-settings`, `admin-management-store-information-v2/v3` | |
| Checkout enforcement alternatives | `beta-checkout-extensions`, `admin-management-checkouts` | Server-side checkout API; extensions are beta |
| Storefront API tokens | `admin-authentication-storefront-api-tokens` | public (CORS) vs private (server-only) vs customer impersonation |
| Products / variants / modifiers | `admin-catalog-products`, `…-product-variants`, `…-product-modifiers` | Largest spec (~420 KB) — always use `paths`/`search`, never read whole |
| Pages, widgets, themes | `admin-content-*` | Alternative placement mechanisms to Script Manager |

## Full spec families

- **`admin-*`** — Management API (REST, `X-Auth-Token`), server-side only.
  - `admin-catalog-*`, `admin-content-*`, `admin-management-*`, `admin-payments-*`, `admin-authentication-*`
- **`storefront-*`** — Storefront REST (same-origin `/api/storefront/*`, cookie-authed) — carts, checkouts, customers, consent, orders, form-fields, pickup-options, subscriptions.
- **`integrations-*`** — Provider interfaces BC calls *on you*: `integrations-webhooks`, `integrations-shipping-provider`, `integrations-tax-provider`, `integrations-tax-provider-connection`.
- **`beta-*`** — checkout-extensions, powered-by, product-recommendations. Subject to change.
- **`b2b-*`, `archived-b2b-edition-v2`** — B2B Edition. Different auth and base URL; don't mix with the core APIs.

## v2 vs v3 rule of thumb

Orders (core CRUD), customer groups, shipping/tax classes v2, store information v2 and several others are **v2**. Catalog, carts, checkouts, customers, metafields, scripts, hooks are **v3**. When both exist (customers, shipping, tax-classes, store-information) the spec name carries `-v2`/`-v3`. **Always check the version before assuming a sub-resource exists** — e.g. `/v2/orders/{id}/metafields` does not exist; order metafields are v3.
