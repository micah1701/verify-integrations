# CLAUDE.md — Ad-Hoc Verify Integration Platform

## What This Is

A multi-integration identity verification platform built on the Ad-Hoc Verify service. It allows e-commerce merchants to require customers to verify their identity (driver's license + liveness selfie) before completing a checkout. BigCommerce is the first supported platform; the architecture is designed to add others (Shopify, WooCommerce, etc.) without restructuring.

**Three deployable artifacts:**
- `dist/server/` — Node.js/Express backend (OAuth callbacks, token storage, serves admin SPA)
- `dist/storefront/bigcommerce.js` — Single-file IIFE bundle, injected into BC stores via Script Manager
- `dist/admin/` — React SPA admin dashboard, served by the backend at `/bigcommerce/admin/`

## Build Commands

```bash
npm run build              # Build storefront + admin (frontend only)
npm run build:storefront   # → dist/storefront/bigcommerce.js
npm run build:admin        # → dist/admin/
npm run build:server       # → dist/server/ (TypeScript → CJS via tsconfig.server.json)
npm run dev:admin          # Vite dev server for admin SPA (standalone, no backend)
npm run dev:server         # tsx watch server/index.ts (hot reload, reads .env)
npm start                  # node dist/server/index.js (production)
```

**Dev workflow:** `npm run build:admin` first (server reads dist/admin/index.html at request time), then `npm run dev:server`.

## Architecture

```
src/core/                        # Platform-agnostic frontend logic
  types.ts                       # All shared TypeScript interfaces
  verify-api.ts                  # Ad-Hoc Verify REST + BC metafield proxy calls
  verification-state.ts          # Ruleset evaluation logic
  cache.ts                       # IndexedDB TTL cache

src/bigcommerce/storefront/      # Svelte + TypeScript → compiled IIFE
  entry.ts                       # Orchestrator (reads window.AdHocVerifyConfig, mounts UI)
  bc-adapter.ts                  # BC Storefront API (cart, JWT, metafields)
  checkout-block.ts              # Checkout button enforcement + MutationObserver
  components/                    # Svelte components (StatusCard, VerifyModal)

src/bigcommerce/admin/           # React 18 + BigDesign
  App.tsx                        # Tabbed layout — reads window.AdHocAdminConfig
  pages/                         # CustomerVerificationPage, OrderVerificationPage, IntegrationConfigPage

server/                          # Node.js/Express backend
  index.ts                       # Entry point (HTTP server, dotenv, graceful shutdown)
  core/
    app.ts                       # Express app, mounts integration routers, /health endpoint
    db.ts                        # Atomic JSON file store — upsertToken / getToken / deleteToken
    middleware/
      error-handler.ts           # Global Express error handler
  bigcommerce/
    router.ts                    # Express.Router() — wires all BC routes + static SPA serving
    auth.ts                      # GET /bigcommerce/auth — OAuth install callback
    load.ts                      # GET /bigcommerce/load — JWT verify + config injection into SPA
    uninstall.ts                 # GET /bigcommerce/uninstall — JWT verify + delete token
    render-error.ts              # Shared HTML error page (BC shows these in an iframe)
```

## Routing

The server runs at `https://verify-integrations.ad-hoc.app`. Integration routes are scoped by prefix:

| Route | Handler |
|---|---|
| `GET /health` | core — liveness check |
| `GET /bigcommerce/auth` | OAuth install — exchange code for access token |
| `GET /bigcommerce/load` | Load app — verify JWT, inject config, serve admin SPA |
| `GET /bigcommerce/uninstall` | Uninstall — delete stored token |
| `GET /bigcommerce/admin/*` | Static serving of `dist/admin/` |

To add a new integration: create `server/shopify/router.ts` + handlers and add `app.use('/shopify', shopifyRouter)` in `server/core/app.ts`. Nothing else changes.

## Key Design Decisions

- **Backend owns OAuth; storefront is still serverless.** The Express server handles BC app installation and the admin dashboard. The storefront plugin still uses the public Integration Key and Ad-Hoc Verify's metafield proxy — no server dependency.
- **Config injection at load time.** `handleLoad` reads `dist/admin/index.html`, injects `<script>window.AdHocAdminConfig = {...}</script>` before `</head>`, and serves it with `Cache-Control: no-store`. This avoids sessions or client-side token passing.
- **JSON file store for tokens.** `server/core/db.ts` writes `data/tokens.json` with atomic temp-file-then-rename writes. No native addon required. Interface (`upsertToken`, `getToken`, `deleteToken`) is stable — swap the implementation for SQLite/Postgres later without touching callers.
- **CJS for server, ESM for frontend.** `tsconfig.server.json` compiles to CommonJS (`dist/server/`). A `postbuild:server` script writes `{"type":"commonjs"}` into `dist/server/` to override the root `"type":"module"`. The Vite frontend builds are unaffected.
- **Svelte for storefront, React for admin.** Svelte compiles to a tiny self-contained IIFE — critical for Script Manager injection. React + BigDesign is required for BC app compliance.
- **Customer metafields take precedence over cart metafields.** `resolveOverallState()` in `verification-state.ts` handles this merge logic.
- **Checkout blocking uses a `MutationObserver`** because BC's checkout page is a SPA that may re-render the button after mount.
- **Template-driven storefront config (`integration_config`).** The `verification_templates` table has an `integration_config` JSONB column that stores all per-store BC settings (storeHash, storeAccessToken, pages, ruleset, manualReview, buttonText, selector). When the storefront script is loaded with only `integrationKey` + `templateId`, `entry.ts` fetches this config at runtime via `GET /get-template-config` (authenticated with the integration key) before initialising. Values explicitly set in `window.AdHocVerifyConfig` always override the remote config. The "Integration Config" tab in the admin SPA reads this config (integration key only) and allows editing it after authenticating with Ad-Hoc Verify credentials (Bearer token); the Bearer token is stored in `sessionStorage` for the duration of the session.

## Core Concepts

- **Integration Key** — Public token from Ad-Hoc Verify. Set by merchant in `window.AdHocVerifyConfig.integrationKey`. Never confuse with BC OAuth credentials.
- **Template ID** — UUID identifying a saved verification template on Ad-Hoc Verify. Used with `integrationKey` as the minimal storefront config — all other settings are fetched from `integration_config` at runtime.
- **IntegrationConfig** — `{ storeHash, storeAccessToken, pages, ruleset, manualReview, buttonText, selector }` — stored as JSONB in `verification_templates.integration_config`. Fetched by the storefront at boot via `GET /get-template-config`; editable via the admin SPA's "Integration Config" tab.
- **BC Metafield proxy** — `bcMetafieldsProxy()` in `verify-api.ts` calls an Ad-Hoc Verify edge function that proxies metafield reads/writes to BC's Management API — used by the storefront plugin to avoid CORS and without exposing BC credentials client-side.
- **AdHocAdminConfig** — `{ apiBase, storeHash, storeAccessToken }` — injected by the server's `/load` handler into the admin SPA HTML at request time.
- **VerificationOutcome** — Result object from Ad-Hoc Verify polling. Contains `status`, `faceMatchScore`, `ageFlags`, etc. Defined in `src/core/types.ts`.
- **Ruleset** — Merchant-configured thresholds (`requireVerification`, `minFaceMatchScore`, `requireOver18`, `requireOver21`). Evaluated by `evaluateVerificationState()`. Stored in `IntegrationConfig.ruleset`.

## Environment Variables

See `.env.example`. Required at runtime:

| Variable | Purpose |
|---|---|
| `BC_CLIENT_ID` | BigCommerce app client ID |
| `BC_CLIENT_SECRET` | BigCommerce app client secret (used to verify JWT signatures) |
| `APP_BASE_URL` | Public URL of this server, no trailing slash |
| `ADHOC_API_BASE` | Ad-Hoc Verify API base URL |
| `PORT` | HTTP listen port (default 3000) |
| `DATABASE_PATH` | Path to token store JSON file (default `./data/tokens.json`) |

## What NOT to Do

- Do not expose `BC_CLIENT_SECRET` to the frontend — it is used server-side only for JWT verification
- Do not cache the `/bigcommerce/load` response — it contains a live access token (`Cache-Control: no-store` is set deliberately)
- Do not skip `invalidateMetafieldCache()` after writing a metafield — stale cache causes the storefront UI to show the wrong verification state
- Do not add CSS files to the storefront build — styles must be injected as JS (`css: 'injected'` in `vite.storefront.config.ts`) so the bundle stays a single file
- Do not change the storefront build format from `iife` — Script Manager requires a self-executing script
- Do not change `server/core/db.ts` callers when swapping storage backends — keep the `upsertToken`/`getToken`/`deleteToken` interface stable

## Reference Files

- `INTEGRATION.md` — Full Ad-Hoc Verify API reference (source of truth for API behavior, webhooks, metafield proxy)
- `RESOURCES.md` — BigCommerce developer documentation links
