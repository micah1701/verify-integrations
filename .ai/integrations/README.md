# Integrations

Each supported commerce platform lives in its own folder here (docs) and in `server/<platform>/` + `src/<platform>/` (code). Global conventions are in [`../global/`](../global/); only platform-specific facts belong in these folders.

| Platform | Status | Docs | Code | Mount |
|---|---|---|---|---|
| BigCommerce | Live | [`bigcommerce/`](bigcommerce/overview.md) | `server/bigcommerce/`, `src/bigcommerce/`, `supabase/functions/bc-metafields/` | `/bigcommerce` |

## The integration contract

An integration is made of up to three pieces. Mirror BigCommerce's shape unless the platform forces otherwise.

1. **Server router** (`server/<platform>/router.ts`) mounted in `server/core/app.ts` as `app.use('/<platform>', router)`. Provides, at minimum, what the platform needs for an app lifecycle:
   - `auth` — OAuth/install callback; persist credentials via `server/core/db.ts`
   - `load` — signature/JWT verification, then serve the admin SPA with injected config (`no-store`)
   - `uninstall` — signature verification, then delete credentials
   - optional `api/*` proxy routes used by the admin SPA
   - static serving of `dist/admin` and `dist/storefront` under the platform prefix
2. **Storefront plugin** (`src/<platform>/storefront/`) built as a single IIFE by its own `vite.<platform>.config.ts` into `dist/storefront/<platform>.js`. It reuses `src/core` for state evaluation, cache and Ad-Hoc Verify calls, and provides a platform adapter (cart identity, customer identity, persistence of the verification result).
3. **Admin SPA** (`src/<platform>/admin/`), if the platform has an embedded-app surface. Uses the platform's required UI kit.

## What an integration must implement (behavioural contract)

| Concern | BigCommerce implementation |
|---|---|
| Identify the cart/session | Storefront API `GET /api/storefront/carts` |
| Identify the customer | `cart.customerId` (0 = guest); `GET /customer/current.jwt` |
| Persist the verification result so the **merchant** can see it | Metafields on cart / customer / order, namespace `Ad-Hoc Verify`, key `verification` |
| Let the storefront read/write that persistence safely | `bc-metafields` edge function (CORS bypass) |
| Enforce at checkout | `checkout-block.ts` |
| Link to the order | Capture order ID at checkout submit, write on confirmation page |
| Credentials for the merchant's admin | OAuth app token in `data/tokens.json` |
| Credentials for the storefront | Store-level API token inside `integration_config` |
| Config | `IntegrationConfig` from the Ad-Hoc Verify template (same mechanism should be reused) |

Reuse, don't fork: `evaluateVerificationState`, `resolveOverallState`, `createVerification`, `getVerificationResult`, `getTemplateIntegrationConfig`, `cache.ts`, and the `MetafieldValue` shape (or an equivalently minimal outcome record).

## Checklist for a new integration

See the full recipe in [`../skills/add-integration.md`](../skills/add-integration.md). In short: new `server/<p>/`, `src/<p>/`, mount in `app.ts`, env vars, vite config + npm scripts, docs folder `integrations/<p>/` (overview, server, storefront, config-reference), update [`../README.md`](../README.md) index and the table above.
