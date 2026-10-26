# The BC App / Admin Side

"Admin side" = the single-click **app** merchants install from BigCommerce, which loads our React SPA in an iframe inside the BC control panel. This file is the BC-platform view; the implementation lives in [`../../integrations/bigcommerce/server.md`](../../integrations/bigcommerce/server.md) and [`admin-spa.md`](../../integrations/bigcommerce/admin-spa.md).

## Platform facts

| Topic | Fact |
|---|---|
| Registration | BigCommerce **Developer Portal** (devtools.bigcommerce.com): Auth Callback, Load Callback, Uninstall Callback URLs and OAuth scopes live there, not in code. Callback URLs must match `APP_BASE_URL` routes exactly (`/bigcommerce/auth`, `/load`, `/uninstall`) |
| Install | `GET /auth?code&scope&context` → we `POST https://login.bigcommerce.com/oauth2/token` → store `access_token` per `store_hash` |
| Load | `GET /load?signed_payload_jwt` signed **HS256 with the client secret**, claim `sub: "stores/<hash>"` |
| Uninstall | Must answer **200** or BC keeps retrying/flags the app |
| Scope change | Edit scopes in Developer Portal → each merchant must re-authorize (re-run install). Existing tokens keep old scopes |
| Multi-user | `signed_payload_jwt` also carries `user` / `owner`; today we ignore them (no per-user auth — see known-issues "admin proxy routes are unauthenticated") |
| Iframe | BC embeds us in an iframe: send `frame-ancestors https://*.bigcommerce.com https://*.mybigcommerce.com`, no `X-Frame-Options`, no third-party-cookie dependence (use headers/`sessionStorage`, as the Integration Config tab does) |
| UI requirement | BC app review expects **BigDesign** components (`@bigcommerce/big-design`, already installed) |
| Testing | Use a BC sandbox/trial store with a draft app (Developer Portal "Draft" → install on your own store). `logging: true` in the storefront config for client-side tracing |

## Working with BigDesign

- Docs & component playground: https://developer.bigcommerce.com/big-design (ask the docs MCP or `WebFetch` — don't guess prop names).
- Wrap the app in `GlobalStyles` once (see `src/bigcommerce/admin/App.tsx`). It requires `styled-components` v5 — already pinned.
- Prefer BigDesign `Table`, `Panel`, `Tabs`, `Message`, `Form` over custom CSS; the app is judged on looking native in the control panel.
- Admin SPA reads `window.AdHocAdminConfig` injected by `/load` — it exists **only** when entered via `/load`, not via direct `/admin/` navigation ([`server.md`](../../integrations/bigcommerce/server.md)).

## Adding capabilities — checklist

1. Find the endpoint: [`api-map.md`](api-map.md) → `bc-api.mjs show …`.
2. Does it need a new scope? If yes: update Developer Portal, update [`../../integrations/bigcommerce/overview.md`](../../integrations/bigcommerce/overview.md#bc-oauth-scopes), and tell merchants to re-authorize.
3. Server handler + route: [`../add-admin-endpoint.md`](../add-admin-endpoint.md).
4. UI in a page under `src/bigcommerce/admin/pages/`; client wrapper in `api/bc-proxy.ts`.
5. `npm run build:admin` (and `build:server` if server changed), then verify via `/load` on a sandbox store. Deploy per [`../deploy.md`](../deploy.md).
6. Update the matching `.ai/` file in the same change.

## Security reminders

- `BC_CLIENT_SECRET`: server-only, verifies JWTs. Access tokens: server-only, except that `/load` currently injects `storeAccessToken` into the SPA HTML (documented in `global/known-issues.md`) — don't expand that exposure; prefer server-held tokens and a session.
- Never log tokens or `signed_payload_jwt`.
- Webhook/receiver endpoints must verify authenticity (shared-secret header) — see [`scripts-and-webhooks.md`](scripts-and-webhooks.md).
