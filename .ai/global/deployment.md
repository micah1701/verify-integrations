# Deployment & Environment

## Environment Variables (`.env`, see `.env.example`)

| Variable | Required | Purpose |
|---|---|---|
| `BC_CLIENT_ID` | yes (BC) | BigCommerce app client ID (OAuth exchange) |
| `BC_CLIENT_SECRET` | yes (BC) | App secret — OAuth exchange + HS256 verification of `signed_payload_jwt` for `/load` and `/uninstall`. **Server only.** |
| `ADHOC_BC_CLIENT_ID` | build-time (BC) | Same value as `BC_CLIENT_ID`; baked into the storefront bundle by Vite (`__ADHOC_BC_CLIENT_ID__`). **Rebuild the storefront after changing it.** |
| `APP_BASE_URL` | yes | Public URL of this server, no trailing slash. Used to build the OAuth `redirect_uri` (`${APP_BASE_URL}/bigcommerce/auth`). |
| `ADHOC_API_BASE` | no | Ad-Hoc Verify API; default `https://edge.adhocverify.com/functions/v1`. Injected into admin config. |
| `PORT` | no | Default 3000 in code. Production uses **3033** (Apache proxies to it). |
| `DATABASE_PATH` | no | Token store JSON file; default `./data/tokens.json`. |

A new integration adds its own prefixed variables (e.g. `SHOPIFY_API_KEY`) to `.env.example` and this table.

## Local development

```bash
cp .env.example .env            # fill in values
npm install
npm run build:admin             # server reads dist/admin/index.html at request time — build first
npm run dev:server              # tsx watch server/index.ts (reads .env)
npm run dev:admin               # optional: standalone Vite admin (no OAuth, no injected config)
```

BigCommerce must reach the server for OAuth/load callbacks → expose localhost with ngrok / Cloudflare Tunnel and set `APP_BASE_URL` to that URL. The dev server serves the storefront bundle from `/bigcommerce/storefront/`.

## Build matrix

| Command | Produces |
|---|---|
| `npm run build` | `dist/storefront/bigcommerce.js` + `dist/admin/` |
| `npm run build:server` | `dist/server/` (+ `postbuild:server` writes `dist/server/package.json`) |
| `npm run rebuild` | all three, then `pm2 reload verify-integrations` (zero-downtime) |

## Production

- Host: Linux, Node + **pm2** (`npm start` registers `verify-integrations`; `pm2 save` + `pm2 startup` to survive reboot).
- **Apache** terminates TLS and reverse-proxies `/` → `http://127.0.0.1:3033/`. **No DocumentRoot**: all requests, including the admin SPA, must pass through Node, otherwise `/bigcommerce/load` can't inject `AdHocAdminConfig`.
- Let's Encrypt via certbot.
- **Cloudflare** sits in front (DNS/proxy).
- Deploy flow: pull → `npm install` (if deps changed) → `npm run rebuild`.
- Useful: `npm run logs`, `pm2 list`, `pm2 monit`, `npm run restart`.

### Cloudflare caching
`bigcommerce.js` and `dist/admin/assets/index.js` have **stable filenames**, so Cloudflare may serve stale copies after a deploy. If a deploy "didn't take effect", **purge the Cloudflare cache before debugging code**. Better: add a Cache Rule (bypass or short TTL) for `/bigcommerce/storefront/*` and `/bigcommerce/admin/assets/*`.

### Storefront bundle URL
Merchants load the bundle from a stable URL, so it can be updated without merchant action. The code serves it at `/bigcommerce/storefront/bigcommerce.js` (router mount). Note the README/INTEGRATION snippets say `/storefront/bigcommerce.js` — see [`known-issues.md`](known-issues.md#storefront-bundle-url-in-docs-vs-router). A CDN (R2/S3) is an option; keep the URL stable.

## Supabase Edge Function

`supabase/functions/bc-metafields/index.ts` is deployed to the **Ad-Hoc Verify Supabase project** (shared with the `verify` repo). This repo has no `supabase/config.toml`; link/run from the environment that has access to that project.

**Always deploy with the CLI, never by pasting into the dashboard editor.** (Other functions in the platform import `supabase/functions/_shared/`, which only the CLI bundles; `bc-metafields` currently has no shared imports but keep the habit.)

```bash
npx supabase functions list                         # check current verify_jwt for bc-metafields; keep it unchanged
npx supabase functions deploy bc-metafields --use-api   # add --no-verify-jwt if it is currently off
```

`bc-metafields` is called by browsers with no Supabase JWT (the storefront sends only a JSON body), so it almost certainly needs `verify_jwt` **off** — confirm with `functions list` before deploying and preserve whatever it is.

If a `_shared/` file ever becomes an import of this function, redeploy every function that imports it. New DB migrations are not applied by function deploys (this repo has none).

## Registering / changing the BC app (summary)

Developer Portal → Create an App. App URL `https://<server>/bigcommerce/admin/`; callbacks `/bigcommerce/auth`, `/bigcommerce/load`, `/bigcommerce/uninstall`. Scopes: Customers read-only, Orders read-only (minimum; the admin only reads). Full steps in `README.md`.
