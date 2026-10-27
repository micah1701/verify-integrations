# App Extensions (Orders / Customers / Products panels)

BC App Extensions add an **Action-menu item** on the native Orders, Customers and Products list pages (and `PRODUCT_DESCRIPTION` on Edit Product) that opens a right-side **PANEL** iframe. They cannot add columns/badges or bulk actions. Max 2 extensions per model; context/model are immutable after creation; uninstall deletes them.

## Flow
1. `/auth` calls `ensureExtensions()` (`server/bigcommerce/extensions.ts`) after the token upsert: GraphQL `createAppExtension` / `updateAppExtension`, idempotent, never throws. Needs scope **`store_app_extensions_manage`** (Developer Portal; merchants re-authorize).
2. BC opens `GET /bigcommerce/ext/:entity/:id?signed_payload_jwt=...` (`ext-load.ts`). JWT verified via `bc-jwt.ts`; the signed `url` claim must match the entity/id. Serves `dist/admin/index.html` with `window.AdHocExtensionConfig = {entity, id, storeHash, sessionToken}` (no OAuth token), `no-store`, BC `frame-ancestors`.
3. `App.tsx` renders `pages/extensions/{Order,Customer,Product}Panel` when that config exists.
4. Panels call `GET|PUT /bigcommerce/api/ext/{customers|orders|products}/:id` (`ext-api.ts`) with `Authorization: Bearer <sessionToken>`. Token = 15 min, HS256, bound to store + entity + record id.

## Data lookups
- Order: order metafield (`/v3/orders/:id/metafields`) → originating cart metafield (`order.cart_id`, where `bc-metafields` writes) → customer metafield.
- Product flag: product metafield `Ad-Hoc Verify` / `requires_verification` (`"true"`/`"false"`, `write_and_sf_access`). Needs a Products scope (read/modify).

## Unverified assumptions (confirm on a dev store)
- JWT delivered to the panel as the `signed_payload_jwt` query param.
- Extension `url` resolves against the app server root (`/bigcommerce/ext/...`).
- `/v3/orders/:id/metafields` exists; `cart_id` is present on the v2 order.

## Not done yet
Storefront does not read the product flag yet (no `product_flag` trigger mode in `triggerRule`); existing installs need an extension re-sync.
