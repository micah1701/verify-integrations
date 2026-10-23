# Architecture

## Three Deployable Artifacts

| Artifact              | Built by                                               | Output                           | Runs where                                                                                   |
| --------------------- | ------------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------- |
| **Backend** (Express) | `npm run build:server` (`tsc -p tsconfig.server.json`) | `dist/server/` (CommonJS)        | Our server (pm2 behind Apache)                                                               |
| **Storefront plugin** | `npm run build:storefront` (Vite lib, IIFE)            | `dist/storefront/bigcommerce.js` | Merchant's storefront, injected via platform script manager                                  |
| **Admin SPA**         | `npm run build:admin` (Vite)                           | `dist/admin/`                    | Served by the backend at `/bigcommerce/admin/`, shown in the platform's control-panel iframe |

`npm run build` = storefront + admin only. `npm run rebuild` = all three + `pm2 reload`.

## Runtime Topology

```
 Shopper browser                                   Merchant (BC control panel iframe)
 ┌─────────────────────────┐                       ┌──────────────────────────────┐
 │ storefront bigcommerce.js│                       │ Admin SPA (React/BigDesign)  │
 └───┬──────────┬───────────┘                       └───────┬──────────────────────┘
     │          │ iframe                                    │ /bigcommerce/api/*  (same origin)
     │          ▼                                           ▼
     │   adhocverify.com/verify/<id>        ┌───────────────────────────────┐
     │                                        │ Our Express server            │
     │ verify-api.ad-hoc.app                  │  /bigcommerce/{auth,load,     │
     ├── POST /create-verification (Int. Key) │   uninstall,api/*,admin/*}    │
     ├── GET  /get-verification-result        │  data/tokens.json (OAuth tok) │
     ├── GET  /get-template-config (Int. Key) └───────────────┬───────────────┘
     └── POST /bc-metafields (edge fn) ───────────┐           │ X-Auth-Token (OAuth app token)
                                                  ▼           ▼
                                        api.bigcommerce.com (Management API)
```

- The **storefront is serverless with respect to this repo**: it only talks to Ad-Hoc Verify (`verify-api.ad-hoc.app`) and the store's own Storefront API (`/api/storefront/carts`, `/customer/current.jwt`). It uses `bc-metafields` to reach BC's Management API without CORS issues.
- The **admin SPA** talks to _our_ server for customer/order data (OAuth token stays server-side) and to Ad-Hoc Verify directly for the Integration Config tab.
- Our server never receives shopper traffic or verification data.

## Credentials: who holds what

| Credential                                             | Held by                                                                           | Used for                                   | Notes                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `BC_CLIENT_ID` / `BC_CLIENT_SECRET`                    | Server env                                                                        | OAuth code exchange, JWT verify            | Secret must never reach any frontend                                                                     |
| `ADHOC_BC_CLIENT_ID`                                   | Baked into storefront bundle at build (`__ADHOC_BC_CLIENT_ID__`)                  | `/customer/current.jwt?app_client_id=`     | Public; must equal `BC_CLIENT_ID`                                                                        |
| **OAuth app access token**                             | `data/tokens.json` (server), also injected into admin HTML by `/load`             | Server → BC Management API for admin lists | Per store. Scopes: Customers + Orders read-only (see README)                                             |
| **Store-level API account token** (`storeAccessToken`) | Template `integration_config` on Ad-Hoc Verify; storefront receives it at runtime | Metafield read/write via `bc-metafields`   | Created by the merchant in BC; scopes: Carts + Customers read/write (+ Orders read for order resolution) |
| Integration Key (`ahv_pub_`)                           | Script tag / admin localStorage                                                   | Public Ad-Hoc Verify endpoints             | Domain-allowlisted                                                                                       |
| Ad-Hoc Verify Bearer token                             | Admin `sessionStorage`                                                            | `PATCH /api/templates/:id`                 | Only after merchant logs in with Ad-Hoc credentials                                                      |

Two different BC tokens exist on purpose; see [`design-decisions.md`](design-decisions.md#two-bigcommerce-credentials).

## How Integrations Slot In

`server/core/app.ts` mounts one Express `Router` per platform at `/<platform>`. Everything platform-specific lives under `server/<platform>/` and `src/<platform>/`. The only shared things are `src/core/*` and `server/core/*` (see [`core-library.md`](core-library.md)). Adding a platform changes `app.ts` (one `app.use` line), `.env.example`, a new Vite storefront config, and new `server/<platform>/` + `src/<platform>/` trees. Full checklist: [`../skills/add-integration.md`](../skills/add-integration.md).

## Shared vs duplicated code (important)

`server/` is compiled with `rootDir: "server"`, so **server code cannot import from `src/`**. Consequently `server/bigcommerce/proxy.ts` carries local copies of some types and of `evaluateVerificationState`. They must be kept in sync by hand — see [`known-issues.md`](known-issues.md#duplicated-evaluation-logic).
