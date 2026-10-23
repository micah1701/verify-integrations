# Skill: Ship a Change

Decide what you touched, then run the matching row. Details in [`../global/deployment.md`](../global/deployment.md).

| Changed | Steps on the server |
|---|---|
| `server/**` | `npm run build:server` → `pm2 reload verify-integrations` (or `npm run rebuild`) |
| `src/bigcommerce/admin/**`, `src/core/**` used by admin | `npm run build:admin` (server serves new files immediately; `/load` reads `index.html` per request) |
| `src/bigcommerce/storefront/**`, `src/core/**` used by storefront, `ADHOC_BC_CLIENT_ID` | `npm run build:storefront` then **purge Cloudflare cache** for the bundle URL |
| Anything / unsure | `npm run rebuild` then purge Cloudflare |
| `.env` | edit, then `pm2 reload verify-integrations --update-env` (and rebuild the storefront if `ADHOC_BC_CLIENT_ID` changed) |
| `supabase/functions/bc-metafields/**` | See below |
| `.ai/**`, docs only | nothing to deploy |

## Supabase edge function (`bc-metafields`)

Never paste into the Supabase dashboard editor — deploy with the CLI from the repo root:

```bash
npx supabase functions list                              # note current verify_jwt for bc-metafields
npx supabase functions deploy bc-metafields --use-api    # add --no-verify-jwt if it is currently off; keep it unchanged
```

- No `_shared/` imports today; if one is added, redeploy **every** function importing the changed file.
- This repo has no migrations; if a change also needs DB migrations (in the Ad-Hoc Verify project), apply them separately.
- Browsers call it without a Supabase JWT, so expect `verify_jwt` to be off — confirm via `functions list` rather than assuming.

## Pre-flight

```bash
npm run build          # storefront + admin
npm run build:server   # type-checks and emits server
```
Both must succeed. There is no test suite — also exercise the changed path manually (Postman collection or a sandbox store with `logging: true`).

## Post-deploy
- `GET /health` → `{status:'ok'}`.
- Open the app from the BC control panel (`/load`) and confirm the admin renders.
- Reload a storefront page with cache disabled and confirm the new behaviour; if not, it's almost always Cloudflare.
- Commit/push only when asked.
