# Coding Rules & Conventions

Follow these in all new work. Platform-specific rules live in the integration's own folder.

---

## Language & Types

- **TypeScript everywhere** (`strict: true` in both tsconfigs). Server is `.ts`; frontend is `.ts`/`.tsx`/`.svelte` with `<script lang="ts">`.
- **All shared types go in `src/core/types.ts`.** Don't define shared shapes inline in components or duplicate them.
- No `any`; use `unknown` and narrow. (The `bc-metafields` edge function is the one place that uses `any` for parsed JSON — don't spread that.)
- **Server cannot import from `src/`** (`rootDir: server`). If server code needs a type/logic that also exists in `src/core`, duplicate it with a `keep in sync` comment *and* add it to [`known-issues.md`](known-issues.md) — or better, don't duplicate: pass data through the API.
- **Module syntax:**
  - Frontend (`src/`) is ESM and **imports use the `.js` extension** even for `.ts` files (`from '../../core/types.js'`). `.svelte` files are imported with their real extension.
  - Server (`server/`) is CommonJS output with **extensionless relative imports** (`from '../core/db'`).

## File Organisation

- Platform-specific code goes under `server/<platform>/` and `src/<platform>/`. **Nothing platform-specific in `server/core/` or `src/core/`** (existing exceptions are listed in [`core-library.md`](core-library.md); don't add more).
- Business logic lives in adapters/helpers (`bc-adapter.ts`, `verify-api.ts`, `verification-state.ts`), not in Svelte/React components. Components render and emit events.
- Route handlers are `RequestHandler` exports, one file per concern (`auth.ts`, `load.ts`, …), wired in the platform's `router.ts`.
- Admin API calls go through `src/<platform>/admin/api/*.ts`, never raw `fetch` inside pages.

## Storefront (browser) Rules

- **Never throw out of the IIFE.** Errors are logged (`log()`) and the widget degrades. Missing `integrationKey` logs a `console.error` and stops.
- Use `log()` from `logger.ts` for diagnostics; it's a no-op unless `config.logging === true`. Don't use raw `console.log`. (`console.error` is allowed for the one fatal config error and the start-verification failure.)
- All persistence-to-BC goes through `bc-adapter.ts` functions, which return `boolean`; failures are non-fatal.
- Anything that touches checkout DOM must survive BC's React re-renders — use the `MutationObserver` pattern in `checkout-block.ts`.
- Storefront CSS must be **injected from JS** (Svelte `css: 'injected'`). No `.css` files in the storefront build. Inline styles for DOM we create outside Svelte.
- Page guard (`detectPage`/`configPages`) runs **synchronously** at load. Anything that gates on config must therefore come from the script tag, not remote config.

## Server Rules

- Every route that returns HTML for BC's iframe uses `renderError(title, detail)` (escapes HTML) for failures.
- Validate required env vars at the top of the handler and return a friendly error page; log the technical detail with a `[tag]` prefix (`[auth]`, `[load]`, `[bc-proxy]`…).
- Never put `BC_CLIENT_SECRET` into any response or frontend bundle.
- Responses containing a live access token (`/load`) must send `Cache-Control: no-store`.
- Keep `db.ts`'s interface (`upsertToken`/`getToken`/`deleteToken`) unchanged when swapping storage.
- Global error handler stays the **last** middleware in `app.ts`.

## Admin SPA Rules

- React 18 + BigDesign components only (BC app-review requirement); wrap in `ThemeProvider` + `GlobalStyles` (already in `App.tsx`).
- Read credentials only from the `config` prop (from `window.AdHocAdminConfig`). Don't re-read `window` in pages.
- Ad-Hoc Verify Bearer tokens live in `sessionStorage` only. Integration Key / Template ID convenience values may use `localStorage`. Never store the BC access token anywhere.

## Edge Function Rules (`supabase/functions/`)

- Deno + `serve` from `deno.land/std`; handle `OPTIONS` first; every response (including errors) carries CORS headers.
- Validate all inputs before any upstream call; return JSON `{error}` with a meaningful status.
- **Deploy with the Supabase CLI, never by pasting into the dashboard** — see [`deployment.md`](deployment.md#supabase-edge-function).

## What NOT To Do

- Don't expose `BC_CLIENT_SECRET` to the frontend (JWT verification only, server-side).
- Don't cache `/bigcommerce/load` (live token inside).
- **Don't skip `invalidateMetafieldCache()` after writing a metafield** — the 5-min IndexedDB cache would show stale state.
- Don't add CSS files to the storefront build; don't change its Vite format from `iife`.
- Don't change `server/core/db.ts` callers when swapping storage backends.
- Don't add `pages` to the remote-applied config in `applyRemoteConfig` — the page guard has already run (see [`design-decisions.md`](design-decisions.md#pages-is-script-tag-only)).
- Don't store verification PII here. Only the safe outcome fields (`success`, `over_18`, `over_21`, `face_match_score`, `blockchain_name`) go into metafields.
- Don't add backwards-compat shims for removed features; don't add error handling for impossible states.
- Don't commit `.env`, `data/tokens.json`, or anything under `dist/`.
- Don't commit or push unless asked.

## Comments

- Default to no comments. Add one only when the *why* is non-obvious (BC quirks, React reconciliation, auth/caching constraints). The existing files model this: `checkout-block.ts` header, `entry.ts` session-key comments, `verify-api.ts` `permission_set` comment.
- Never narrate what the code does.

## Testing / Verification

There is no automated test suite. Verify changes by:
1. `npm run build` (frontend) and `npm run build:server` (type-check server) — both must pass.
2. For server routes: Postman collection `postman/Verify Integrations Server.postman_collection.json` (see `postman/README.md` for generating a test JWT).
3. For storefront: build, serve `dist/storefront/` (`/bigcommerce/storefront/bigcommerce.js` from the dev server), add `logging: true` to `AdHocVerifyConfig`, and watch the `[AD-HOC VERIFY]` console output on a real/sandbox BC store.
