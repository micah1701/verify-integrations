# BigCommerce Skills — Working In and On the BC Admin Side

Entry point for any task that touches the BigCommerce **Management API**, the **app/admin side** (OAuth, `/load`, the BigDesign SPA), Script Manager, webhooks, or the Storefront APIs. For how *this repo's* BC integration is built, see [`../../integrations/bigcommerce/`](../../integrations/bigcommerce/); this folder is about **how to work with BigCommerce itself** and how to look things up fast.

## Rule #1 — look it up, don't guess

BigCommerce has ~76 API areas, v2 and v3 variants of many, and quirky behaviour. Before writing or changing any BC call, check the real spec with the local CLI (no install, no tokens, a few seconds):

```bash
node .ai/skills/bigcommerce/scripts/bc-api.mjs search "metafield" --spec orders   # find endpoints
node .ai/skills/bigcommerce/scripts/bc-api.mjs show admin-management-scripts POST v3/content/scripts
npm run bc:api -- search webhook          # same thing via npm
```

Details: [`tooling.md`](tooling.md). **Windows/Git Bash:** pass path fragments *without* a leading `/` (`v3/hooks`, not `/v3/hooks`) or the shell rewrites them.

## Index

| File | Use it when |
|---|---|
| [`tooling.md`](tooling.md) | Setting up / using the OpenAPI CLI, the BC docs MCP server, and what the terminalskills skill does and doesn't give you |
| [`api-map.md`](api-map.md) | You need to know *which spec* covers a resource (customers, orders, carts, metafields, scripts, webhooks…) and which ones this repo already uses |
| [`management-api.md`](management-api.md) | Writing server-side calls to `api.bigcommerce.com` — auth, versions, pagination, rate limits, v2/v3 quirks, scopes |
| [`scripts-and-webhooks.md`](scripts-and-webhooks.md) | Installing the storefront bundle programmatically (Script Manager API) or reacting to store events (webhooks) |
| [`storefront-apis.md`](storefront-apis.md) | Anything shopper-side: Storefront REST (`/api/storefront/*`), GraphQL Storefront API, tokens |
| [`admin-app.md`](admin-app.md) | Changing the app shell: OAuth lifecycle, scopes, BigDesign UI, iframe constraints |

Related recipes elsewhere: [`../add-admin-endpoint.md`](../add-admin-endpoint.md), [`../change-metafield-shape.md`](../change-metafield-shape.md), [`../debug-storefront.md`](../debug-storefront.md), [`../deploy.md`](../deploy.md).

## Source resources (what each one really is)

| Resource | Reality | Used here as |
|---|---|---|
| `https://docs.bigcommerce.com/_mcp/server` | Official docs MCP (streamable HTTP, one read-only tool `searchDocs(query, topK≤20)`). Nothing to install — it's remote. | Project-scoped entry in [`/.mcp.json`](../../../.mcp.json) |
| `https://docs.bigcommerce.com/openapi.json` | **Not JSON** — an HTML page linking to 76 per-area OpenAPI 3.1 files at `/openapi/<name>.json` (up to ~420 KB each). | Fetched + cached by [`scripts/bc-api.mjs`](scripts/bc-api.mjs) |
| `https://terminalskills.io/skills/bigcommerce` | Third-party overview (GraphQL storefront, Management REST, Catalyst). Install command isn't published on the page; content is general. Not authoritative. | Distilled into [`storefront-apis.md`](storefront-apis.md); do not rely on it over the specs |

## Conventions for this folder

- Keep facts that came from a spec/doc **verifiable**: name the spec (`admin-management-order-operations`) so the next agent can re-run `show`.
- Facts about a live store that are *unverified* get labelled as such.
- Nothing in these files may contain tokens, client secrets, or store hashes.
- Library policy: reference-only tooling lives **inside this project** (`scripts/`, `.mcp.json`, npm scripts). Don't install global skills or global npm packages for BC work.
