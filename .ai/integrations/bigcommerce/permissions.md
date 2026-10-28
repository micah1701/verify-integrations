# BigCommerce permissions (minimum scopes)

Two different credentials touch BigCommerce, each with its own scopes. **Grant the least access listed here** — the store-level token ships to shoppers' browsers (it is in the storefront config / `integration_config`), so it must hold as little as possible. BC scope names: [API accounts](https://docs.bigcommerce.com/developer/docs/overview/api-fundamentals/api-accounts).

Derived from a code audit (every `api.bigcommerce.com` call in `server/`, `src/`, `supabase/functions/bc-metafields`). Re-audit when adding a BC call — see "Keeping this current".

## 1. Store-level API account (merchant creates it; token goes in the storefront / `integration_config`)

Used from the browser through the `bc-metafields` edge function (`storeAccessToken`). Create a **new** account when changing scopes — BC does not let you edit an existing store-level account.

| BC UI name | Level | Why (code) | Scope param |
|---|---|---|---|
| **Carts** | **Modify** | Read + write the verification metafield on the cart (`saveCartMetafield`, `loadCartMetafields`; order-confirmation also writes to the order's *cart*) | `store_cart` |
| **Customers** | **Modify** | Read + write the customer metafield for logged-in shoppers (`saveCustomerMetafield`, backfill) | `store_v2_customers` |
| **Orders** | **Read-only** | `GET /v2/orders/{id}` only to resolve `cart_id` for `resource:'order'`; order writes land on cart metafields, so no Orders write | `store_v2_orders_read_only` |
| **Products** | **Read-only** | Bulk read of the per-product `requires_verification` flag (`resource:'products'`; trigger mode `product_flag` and the product-page badge). Not needed if the store never uses `product_flag` | `store_v2_products_read_only` |
| **Metafields Access** | **Standard** (default) | Cross-account access works because metafields use `permission_set: write_and_sf_access`; "Full" (`store_metafield_write_all`) is not needed | `store_metafield_write` |

Everything else: **None**. In particular `Checkouts`, `Storefront API tokens` and `Customers Login` are not used — the storefront calls same-origin `/api/storefront/*` (no scopes) and `/customer/current.jwt?app_client_id=` (no token).

> **Unverified:** BC's docs don't state the scope for *cart* metafield endpoints. We assume **Carts**. If cart-metafield calls return 403 with this set, also add `Checkouts` read-only and update this file. (The previously working account had Carts, Checkouts, Metafields, Storefront API tokens, Customers, Orders; the Checkouts and Storefront-token grants are not referenced by any code.)

Hardening note: this token can modify carts and customers from a public page. If that is a concern, the alternative is to move writes behind a server-side proxy that authenticates the shopper — not built.

## 2. Registered BC app (Developer Portal → OAuth Scopes; token in `data/tokens.json`)

Used server-side by `server/bigcommerce/{proxy,ext-api,extensions}.ts`. **Changing scopes forces every merchant to re-authorize** (reinstall/update), then re-run extension registration.

| BC UI name | Level | Why (code) | Scope param |
|---|---|---|---|
| **Customers** | **Read-only** | Admin Customers tab, customer panel: `/v3/customers`, `/v3/customers/{id}/metafields` | `store_v2_customers_read_only` |
| **Orders** | **Read-only** | Admin Orders tab, order panel: `/v2/orders`, `/v2/orders/count`, `/v3/orders/{id}/metafields` | `store_v2_orders_read_only` |
| **Carts** | **Read-only** | Order panel falls back to the order's **cart** metafield (`/v3/carts/{cart_id}/metafields`) — this is where guest/most verifications actually live. *Not yet in the registered app's scopes (see known gaps).* | `store_cart_read_only` |
| **Products** | **Modify** | Product panel toggles the `requires_verification` product metafield (POST/PUT) and reads name/SKU | `store_v2_products` |
| **App extensions** | **Manage** | `createAppExtension` / `updateAppExtension` GraphQL mutations at install | `store_app_extensions_manage` |
| **Metafields Access** | **Standard** | Product flag is written with `write_and_sf_access`; no cross-owner management | `store_metafield_write` (default) |

Nothing else (no Orders/Customers write, no Checkouts, no Content).

### Known gaps (as of 2026-10-28)
- Registered app scopes were documented as Customers + Orders read-only only. **Add: Carts read-only, Products modify, App extensions manage.** Until Carts is added, the order panel can't read cart metafields (the call returns null and it falls back to the customer record, so guest orders look unverified).
- Merchant's existing store-level account lacks **Products read-only**, so `product_flag` reads 403 (cart widget fails open; product badge stays hidden). Create a new account with the table above and paste the new token into Integration Config.

## Setup checklist for a new merchant store
1. Install the app (registered scopes above are granted at install).
2. Create a store-level API account with exactly section 1; copy the **access token** into Integration Config → Store Access Token (and store hash).
3. If using `product_flag` / the product badge, confirm Products read-only is on that account.
4. Load the storefront script on **all pages** (needed for the product badge).

## Keeping this current
When you add or change a BC API call: find its scope in the BC endpoint reference, put it in the right table above, and update `overview.md` (it links here). Verify with a real token that has *only* these scopes.
