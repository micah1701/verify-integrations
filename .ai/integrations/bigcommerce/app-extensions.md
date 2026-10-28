# App Extensions (Orders / Customers / Products panels)

BC App Extensions add an **Action-menu item** on the native Orders, Customers and Products list pages (and `PRODUCT_DESCRIPTION` on Edit Product) that opens a right-side **PANEL** iframe. They cannot add columns/badges or bulk actions. Max 2 extensions per model; context/model are immutable after creation; uninstall deletes them.

## Flow
1. `/auth` calls `ensureExtensions()` (`server/bigcommerce/extensions.ts`) after the token upsert: GraphQL `createAppExtension` / `updateAppExtension`, idempotent, never throws. Needs scope **`store_app_extensions_manage`** (Developer Portal; merchants re-authorize).
2. BC delivers extension clicks to the app's **Load callback** (`GET /bigcommerce/load`); the signed `url` claim holds the resolved extension path (`"/"` for a normal open). `load.ts` calls `parseExtensionUrl(claims.url)` and, on a match, `sendExtensionPanel()` instead of the main SPA. `GET /bigcommerce/ext/:entity/:id` (`ext-load.ts`) remains as a direct-URL fallback. (Found on first dev-store test: the panels showed the main SPA because `/load` ignored `url`.) JWT verified via `bc-jwt.ts`; the signed `url` claim must match the entity/id. Serves `dist/admin/index.html` with `window.AdHocExtensionConfig = {entity, id, storeHash, sessionToken}` (no OAuth token), `no-store`, BC `frame-ancestors`.
3. `App.tsx` renders `pages/extensions/{Order,Customer,Product}Panel` when that config exists.
4. Panels call `GET|PUT /bigcommerce/api/ext/{customers|orders|products}/:id` (`ext-api.ts`) with `Authorization: Bearer <sessionToken>`. Token = 15 min, HS256, bound to store + entity + record id.

## Data lookups
- Order: order metafield (`/v3/orders/:id/metafields`) → originating cart metafield (`order.cart_id`, where `bc-metafields` writes) → customer metafield.
- Product flag: product metafield `Ad-Hoc Verify` / `requires_verification` (`"true"`/`"false"`, `write_and_sf_access`). Needs a Products scope (read/modify).

## Unverified assumptions (confirm on a dev store)
- JWT delivered to the panel as the `signed_payload_jwt` query param.
- Extension `url` resolves against the app server root (`/bigcommerce/ext/...`).
- `/v3/orders/:id/metafields` exists; `cart_id` is present on the v2 order.

## Product flag → storefront
- `triggerRule.mode = 'product_flag'` (set in the Integration Config tab). `cartQualifies()` in `storefront/entry.ts` calls `loadFlaggedProductIds()` (`bc-adapter.ts`), which does one bulk read through the `bc-metafields` edge function (`resource: 'products'`, read-only, ≤50 IDs per call → BC `GET /v3/catalog/products/metafields?resource_id:in=`). Result cached 1 min.
- **Fails open**: missing credentials or a failed read keeps the widget/enforcement on.
- The store access token used by the storefront needs Products **read** access. `triggerRule.productIds` is ignored in this mode; `only_products` / `exclude_products` are unchanged.
- Deploy: `npx supabase functions deploy bc-metafields --use-api` (check `verify_jwt` first; it has no `_shared/` imports).

## Not done yet
Existing installs need an extension re-sync (only `/auth` registers them).
