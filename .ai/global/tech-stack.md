# Tech Stack

## Runtime / Language

| Tech | Version | Why |
|---|---|---|
| Node.js | 18+ (global `fetch` used by the server) | Backend runtime |
| TypeScript | ^5, `strict` | Everywhere |
| ES modules | root `package.json` has `"type": "module"` | Frontend + Vite configs |
| CommonJS | `dist/server/` | Server compiled with `module: commonjs`; `postbuild:server` writes `{"type":"commonjs"}` into `dist/server/package.json` to override the root ESM setting |

## Backend

| Lib | Use |
|---|---|
| Express ^4.19 | HTTP server, routers, static serving |
| jsonwebtoken ^9 | Verify BC-signed `signed_payload_jwt` (HS256) |
| dotenv ^16 | Load `.env` (via `import 'dotenv/config'` in `server/index.ts`) |
| tsx ^4 | `npm run dev:server` hot reload |
| pm2 (global, not a dependency) | Production process manager; `npm start/stop/restart/rebuild/logs` wrap it |

No database server: tokens are a JSON file (see [`design-decisions.md`](design-decisions.md#json-file-token-store)).

## Storefront Plugin

| Lib | Use |
|---|---|
| Svelte ^4 (not 5) | Components compile to a tiny self-contained bundle. `new Component({target, props})`, `$set`, `$on`, `$destroy` — Svelte 4 APIs. Don't use runes. |
| Vite ^5 lib mode | `formats: ['iife']`, name `AdHocVerify`, output `dist/storefront/bigcommerce.js`, `assetsInlineLimit: MAX_SAFE_INTEGER` |
| `@sveltejs/vite-plugin-svelte` ^3 | `emitCss: false`, `compilerOptions.css: 'injected'` → styles inside the JS |
| `define: __ADHOC_BC_CLIENT_ID__` | Injected from `ADHOC_BC_CLIENT_ID` in `.env` at **build** time (via `loadEnv(mode, cwd, '')`) |

Browser APIs relied on: `fetch` (monkey-patched in two places), `XMLHttpRequest` (patched for legacy cart endpoints), `MutationObserver`, `IndexedDB`, `sessionStorage`, `crypto.subtle` (SHA-1 for name hash), `postMessage`.

## Admin SPA

| Lib | Use |
|---|---|
| React ^18 + react-dom | UI |
| `@bigcommerce/big-design` ^2 (+ `big-design-theme`) | Required for BC app compliance/look |
| styled-components ^5.3 | BigDesign peer |
| `@vitejs/plugin-react` | JSX |

Vite config: `base: '/bigcommerce/admin/'`, output `dist/admin`, **stable filenames** (`assets/index.js`, `assets/[name].js`) — no content hashes. Relevant for CDN/Cloudflare caching (see [`deployment.md`](deployment.md#cloudflare-caching)).

## Edge Function

Deno via Supabase Edge Functions (`serve` from `deno.land/std@0.168.0`). Deployed to the Ad-Hoc Verify Supabase project, not run from this repo.

## Config files

| File | Purpose |
|---|---|
| `tsconfig.json` | Frontend: `noEmit`, `moduleResolution: bundler`, `jsx: react-jsx`, includes `src/**` + `vite.*.config.ts` |
| `tsconfig.server.json` | Server: CJS, `rootDir: server`, `outDir: dist/server`, sourcemaps; excludes `src` |
| `svelte.config.js` | Svelte preprocess for the Vite plugin |
| `vite.admin.config.ts` / `vite.storefront.config.ts` | See above |
| `index.html` | Admin SPA shell; script entry `/src/bigcommerce/admin/index.tsx` |
| `.env.example` | Env var template |

## Tooling notes

- Platform is Windows for local dev (PowerShell/Git Bash); production is Linux (Apache + pm2).
- Postman CLI is installed locally; collections live in `postman/`.
- `.github/instructions/codacy.instructions.md` is an editor-side Codacy rule file (git-ignored); not part of the project's runtime.
