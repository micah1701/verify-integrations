# Core Library (platform-agnostic layer)

Everything here must stay free of platform-specific assumptions. Platform code imports from core; core never imports from a platform folder.

---

## `src/core/` (frontend, ESM)

### `types.ts`
Single home for all shared interfaces. **Add new shared types here; never define them inline in components.** Groups:
- Verification: `FaceMatchScore`, `VerificationStatus`, `VerificationState`, `VerificationOutcome`
- Rules: `Ruleset`, `VerifyTriggerRule/Mode`, `CheckoutEnforcement/Mode`, `ManualReviewConfig`
- Config: `AdHocVerifyConfig` (window config), `IntegrationConfig` (template-stored), `AdHocAdminConfig` (injected into admin)
- Metafield: `MetafieldValue`, `ResolvedMetafield`, `ResolvedState`, `BCRawMetafield`
- Admin API shapes: `BCCustomer`, `BCOrder`, `Enriched*`, `*DetailResponse`, `BCListMeta`

Some `BC*` types live here although they're BigCommerce-specific; when a second platform is added, move them to `src/bigcommerce/` or a `types/` subfolder per platform (don't generalise them).

### `verify-api.ts`
Client for the upstream Ad-Hoc Verify API. All functions take `apiBase` explicitly.

| Function | Endpoint | Auth | Notes |
|---|---|---|---|
| `createVerification(apiBase, key, body)` | `POST /create-verification` | `X-API-Key` | Throws on non-2xx with server `error` |
| `getVerificationResult(apiBase, id)` | `GET /get-verification-result?id=` | none | Public; returns `{status, result}` or `null` |
| `bcMetafieldsProxy(apiBase, body)` | `POST /bc-metafields` | none (token in body) | Returns `null` on any failure — callers treat `null` as failed. **BC-specific despite living in core.** |
| `getTemplateIntegrationConfig(apiBase, key, templateId)` | `GET /get-template-config` | `X-API-Key` | Returns `{ok:true,data}` / `{ok:false,status,error}` / `null` (network). Accepts either `{integration_config:{…}}` or a bare config |
| `updateTemplateIntegrationConfig(apiBase, bearer, templateId, cfg)` | `PATCH /api/templates/:id` | Bearer | Throws `Error('unauthorized')` on 401; returns boolean otherwise. Runs `sanitizeIntegrationConfig()` (whitelist) |
| `loginToAdhocApi` / `refreshAdhocToken` | `POST /api/auth`, `/api/auth/refresh` | — | Return `null` on failure |
| `computeNameHash(first, last, verificationId)` | local | — | `SHA1:` + hex of `(first+last+id)` stripped of whitespace/hyphens/apostrophes/commas/periods, uppercased |
| `buildMetafieldPayload(id, result, status)` | local | — | Produces the BC metafield POST/PUT body (see [`../integrations/bigcommerce/metafields.md`](../integrations/bigcommerce/metafields.md)) |

> `sanitizeIntegrationConfig()` is an explicit allow-list. **Any new `IntegrationConfig` field must be added there** or it will silently never save. (See [`../skills/add-config-option.md`](../skills/add-config-option.md).)

### `verification-state.ts`
- `evaluateVerificationState(mfValue, ruleset)` → `VerificationState`. Order of checks: no value → `unverified`; `manual_review` → `pending_review`; status ≠ `completed` → `incomplete`; age rules → `invalid`; `minFaceMatchScore` (unknown/weaker score → `invalid`); else `verified`.
- `resolveOverallState(cartMf, customerMf, ruleset)` → `ResolvedState`. Customer `verified` wins, then cart `verified`; otherwise the most informative non-verified state by priority `invalid > incomplete > unverified`. Note: `pending_review` participates in the priority lookup as `indexOf = -1`, so it outranks the others — a pending review on either side surfaces as `pending_review`.
- `requireVerification` and `requireNameMatch` are **not** evaluated here; they're enforced by the storefront orchestration.

### `cache.ts`
IndexedDB key/value store with TTL (`dbGet`, `dbSet(key, value, ttlMs)`, `dbDel`). Every operation swallows errors and degrades to "cache miss" — the storefront must work with IndexedDB blocked (private mode, etc.).

---

## `server/core/` (backend, CommonJS)

| File | Role |
|---|---|
| `app.ts` | Creates the Express app. Registers JSON/urlencoded parsers, a default `X-Frame-Options: SAMEORIGIN`, `GET /health`, mounts integration routers, then the global error handler **last**. |
| `db.ts` | Atomic JSON token store at `DATABASE_PATH` (default `./data/tokens.json`). Interface is stable: `upsertToken`, `getToken`, `deleteToken`. `StoreToken = {store_hash, access_token, scope, installed_at, updated_at}`. Write = temp file then `rename`. **Read-modify-write is not locked** — fine for one process, not for clustering. Keyed by `store_hash`, which is BigCommerce-shaped; a second integration should either namespace keys (`shopify:<shop>`) or get its own store. |
| `middleware/error-handler.ts` | Logs and returns `{error}` JSON using `err.status ?? 500`. |
| `../index.ts` | `dotenv/config`, `http.createServer(app)`, listens on `PORT` (default 3000), closes on SIGTERM/SIGINT. |

Keep the `db.ts` function signatures unchanged if you swap the backend (SQLite/Postgres) — callers must not need edits.

### Default security headers
`app.ts` sets `X-Frame-Options: SAMEORIGIN` on everything. Only `bigcommerce/load.ts` removes it and replaces it with a CSP `frame-ancestors` for the BC control panel. A new integration that must be iframed does the same in its own `load` handler, scoped to that platform's domains.
