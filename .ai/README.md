# .ai — AI Context System for Ad-Hoc Verify Integrations

A layered documentation system for AI-assisted development on the Ad-Hoc Verify **integration platform** (storefront plugins + app backends for third-party commerce platforms). Read this index first, then open only the file relevant to your task instead of re-deriving things from source.

> Sibling project: the Ad-Hoc Verify platform itself (SvelteKit app + Supabase) lives in a separate repo, `micah1701/verify`, and has its own `.ai/`. This repo only *consumes* that platform's public API (see [`global/adhoc-verify-api.md`](global/adhoc-verify-api.md)).

---

## How the docs are organised

| Layer | Folder | Rule of thumb |
|---|---|---|
| **Global** | [`global/`](global/) | True for *every* integration: platform-agnostic code (`src/core/`, `server/core/`), conventions, tech stack, deployment, the upstream API. |
| **Integration** | [`integrations/<platform>/`](integrations/) | True only for one platform. Today: `bigcommerce/`. Nothing under `global/` should name a platform-specific route, API or file unless it is used as an *example*. |
| **Skills** | [`skills/`](skills/) | Step-by-step recipes for recurring tasks. |

When a fact is platform-specific, put it in that platform's folder. When you add a platform, copy the shape of `integrations/bigcommerce/` (see [`skills/add-integration.md`](skills/add-integration.md)).

---

## How to Use This

- **New to the project?** [`global/project-overview.md`](global/project-overview.md) → [`global/architecture.md`](global/architecture.md)
- **Changing BigCommerce behaviour?** [`integrations/bigcommerce/overview.md`](integrations/bigcommerce/overview.md), then the area file (server / storefront / admin / metafields)
- **Calling BigCommerce APIs / working on the BC app or admin side?** [`skills/bigcommerce/README.md`](skills/bigcommerce/README.md) — look endpoints up with `npm run bc:api -- search <term>` instead of guessing
- **Touching shared frontend logic (`src/core/`)?** [`global/core-library.md`](global/core-library.md)
- **About to write code?** [`global/rules.md`](global/rules.md) (conventions + forbidden patterns)
- **Changing *why* something is built the way it is?** Read [`global/design-decisions.md`](global/design-decisions.md) first
- **Deploying / "my change isn't live"?** [`global/deployment.md`](global/deployment.md)
- **Something looks wrong or inconsistent?** Check [`global/known-issues.md`](global/known-issues.md) before assuming a bug is new

---

## Index

### Global
| File | What it covers |
|---|---|
| [`global/project-overview.md`](global/project-overview.md) | Product purpose, audiences, core concepts (Integration Key, Template ID, IntegrationConfig, Ruleset…), glossary, repo map |
| [`global/architecture.md`](global/architecture.md) | The three build artifacts, data flow, who holds which credential, how integrations slot in |
| [`global/core-library.md`](global/core-library.md) | `src/core/` (types, verify-api, verification-state, cache) and `server/core/` (app, db, error handler) — the platform-agnostic layer |
| [`global/adhoc-verify-api.md`](global/adhoc-verify-api.md) | The upstream Ad-Hoc Verify endpoints this repo calls, auth modes, response shapes (summary of `INTEGRATION.md`) |
| [`global/rules.md`](global/rules.md) | Coding conventions, forbidden patterns, things NOT to do |
| [`global/tech-stack.md`](global/tech-stack.md) | Every library/tool and why; build configs; CJS-vs-ESM split |
| [`global/design-decisions.md`](global/design-decisions.md) | The WHY behind key choices — read before changing a core system |
| [`global/deployment.md`](global/deployment.md) | Env vars, build/rebuild, pm2 + Apache + Cloudflare, Supabase edge function deploys |
| [`global/known-issues.md`](global/known-issues.md) | Verified gaps, doc/code mismatches and tech debt (security-relevant items first) |

### Integrations
| File | What it covers |
|---|---|
| [`integrations/README.md`](integrations/README.md) | The contract every integration follows; checklist for a new one |
| [`integrations/bigcommerce/overview.md`](integrations/bigcommerce/overview.md) | BC app lifecycle, two credential types, routes, file map |
| [`integrations/bigcommerce/server.md`](integrations/bigcommerce/server.md) | `server/bigcommerce/*` — OAuth install, load (JWT + config injection), uninstall, Management API proxy routes |
| [`integrations/bigcommerce/storefront.md`](integrations/bigcommerce/storefront.md) | The Svelte IIFE plugin: boot sequence, page detection, trigger rules, enforcement, name-match, session keys |
| [`integrations/bigcommerce/checkout-enforcement.md`](integrations/bigcommerce/checkout-enforcement.md) | `checkout-block.ts` — blocking/warning mechanics for BC's React checkout SPA |
| [`integrations/bigcommerce/metafields.md`](integrations/bigcommerce/metafields.md) | Metafield schema, cart/customer/order write paths, `bc-metafields` edge function, caching |
| [`integrations/bigcommerce/admin-spa.md`](integrations/bigcommerce/admin-spa.md) | React + BigDesign admin: tabs, proxy client, Integration Config auth flow |
| [`integrations/bigcommerce/config-reference.md`](integrations/bigcommerce/config-reference.md) | Every `AdHocVerifyConfig` / `IntegrationConfig` option, defaults, precedence |

### Skills (Step-by-Step Recipes)
| File | When to use |
|---|---|
| [`skills/add-integration.md`](skills/add-integration.md) | Adding a new platform (Shopify, WooCommerce, …) |
| [`skills/add-config-option.md`](skills/add-config-option.md) | Adding a new storefront/template config option end to end |
| [`skills/add-admin-endpoint.md`](skills/add-admin-endpoint.md) | Adding a server proxy route + admin SPA consumer |
| [`skills/change-metafield-shape.md`](skills/change-metafield-shape.md) | Changing what is stored in the `Ad-Hoc Verify` metafield (touches 4 places) |
| [`skills/debug-storefront.md`](skills/debug-storefront.md) | Diagnosing "widget missing", "checkout not blocked", "state wrong", "order not linked" |
| [`skills/deploy.md`](skills/deploy.md) | Shipping server/admin/storefront and the `bc-metafields` edge function |
| [`skills/bigcommerce/README.md`](skills/bigcommerce/README.md) | Index for BigCommerce platform work: [`tooling`](skills/bigcommerce/tooling.md) (OpenAPI CLI, docs MCP), [`api-map`](skills/bigcommerce/api-map.md), [`management-api`](skills/bigcommerce/management-api.md), [`scripts-and-webhooks`](skills/bigcommerce/scripts-and-webhooks.md), [`storefront-apis`](skills/bigcommerce/storefront-apis.md), [`admin-app`](skills/bigcommerce/admin-app.md) |

---

## Maintaining these docs

- Update the relevant file **in the same change** as the code. If you add/rename/remove a file, update the index above and the repo map in [`global/project-overview.md`](global/project-overview.md).
- Keep platform-specific content out of `global/`. Keep one fact in one place and link to it.
- Record hard-won lessons and non-obvious constraints in `design-decisions.md` (global) or the integration's own files, with the *reason*.
- Never put secrets (client secrets, access tokens, integration keys, Supabase project refs) in these files.
- `CLAUDE.md` at the repo root is the short entry point; it points here. Don't duplicate long content there.
