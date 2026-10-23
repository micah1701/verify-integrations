# Skill: Add a New Integration (e.g. Shopify)

Use when adding another commerce platform. Replace `<p>` with the platform slug (`shopify`, `woocommerce`). Mirror BigCommerce (`../integrations/bigcommerce/`) and read [`../integrations/README.md`](../integrations/README.md) for the contract first.

## 1. Server

1. Create `server/<p>/router.ts` exporting `<p>Router = Router()`.
2. Add handlers as separate files: `auth.ts` (install/OAuth; persist credentials), `load.ts` (verify the platform's signature, serve admin SPA with injected config, `no-store`, platform-specific `frame-ancestors`), `uninstall.ts` (verify, delete credentials, return what the platform requires). Reuse `renderError` (import `../bigcommerce/render-error` only if you accept the cross-dependency; otherwise copy it to `server/<p>/render-error.ts`).
3. Credential storage: reuse `server/core/db.ts` **without changing its signatures**. `StoreToken` is keyed by `store_hash`; namespace keys (`shopify:<shop>`) so platforms can't collide, or give the platform its own store file/path.
4. Mount in `server/core/app.ts`: `app.use('/<p>', <p>Router)` *before* `errorHandler`.
5. Serve static: `/<p>/storefront` → `dist/storefront`, `/<p>/admin` → `dist/admin/<p>` (see step 3 — admin outputs must not overwrite BigCommerce's `dist/admin`).
6. If the admin needs platform data, add proxy routes (see [`add-admin-endpoint.md`](add-admin-endpoint.md)) and **authenticate them** (don't copy the BigCommerce gap — [`known-issues.md`](../global/known-issues.md#admin-proxy-routes-are-unauthenticated)).
7. Add env vars to `.env.example` and [`../global/deployment.md`](../global/deployment.md).

## 2. Storefront plugin

1. `src/<p>/storefront/entry.ts` (+ `<p>-adapter.ts`, enforcement helper, Svelte components). Reuse from `src/core`: `evaluateVerificationState`, `resolveOverallState`, `createVerification`, `getVerificationResult`, `getTemplateIntegrationConfig`, `cache.ts`.
2. Implement the adapter responsibilities: current cart/session id, customer id (guest = none), persist & read the outcome, order linking. If the platform can't store a metafield-like record, use its closest equivalent and keep the `MetafieldValue` shape.
3. If the platform needs a CORS proxy, add a new edge function (`supabase/functions/<p>-…`) — don't overload `bc-metafields`.
4. Add `vite.<p>-storefront.config.ts` modelled on `vite.storefront.config.ts` (IIFE, injected CSS, single file, output `dist/storefront/<p>.js` — use a **different filename** so builds don't clobber each other; the existing config writes `bigcommerce.js` to `dist/storefront/`, which is fine to share as a directory).
5. Add npm scripts (`build:<p>-storefront`, …) and include them in `build`/`rebuild`.

## 3. Admin SPA (if the platform embeds apps)

1. `src/<p>/admin/` with the platform's required UI kit.
2. Separate Vite config and HTML shell (the root `index.html` is BigCommerce's; create `<p>.admin.html` or a subfolder), `base: '/<p>/admin/'`, `outDir: 'dist/admin/<p>'`, and update BigCommerce's output path expectations if you move it (`ADMIN_HTML_PATH` in `server/bigcommerce/load.ts`, router static root).
3. Reuse the Integration Config page logic if the platform uses template config (extract shared pieces into `src/core/` rather than importing across platform folders).

## 4. Types and config
Add platform-neutral types to `src/core/types.ts`; platform-specific ones in `src/<p>/`. If `IntegrationConfig` needs platform fields, prefer a platform sub-object over adding top-level keys, and update `sanitizeIntegrationConfig`. The Ad-Hoc Verify platform (separate repo) must accept the new keys in `integration_config`.

## 5. Docs (required)
- Create `.ai/integrations/<p>/` with at least `overview.md`, `server.md`, `storefront.md`, `config-reference.md`.
- Update the table in [`../integrations/README.md`](../integrations/README.md), the index in [`../README.md`](../README.md), the repo map in [`../global/project-overview.md`](../global/project-overview.md), and `CLAUDE.md` routing table.
- Add Postman requests under `postman/`.

## 6. Verify
`npm run build && npm run build:server`; hit `/health`; exercise install → load → uninstall with a signed test request; test the storefront on a sandbox store with `logging: true`.
