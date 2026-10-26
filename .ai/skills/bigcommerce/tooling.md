# Tooling — OpenAPI CLI, Docs MCP, Postman

Everything here is **project-local**. Nothing is installed globally and no new npm dependency was needed.

## 1. `bc-api.mjs` — query the BC OpenAPI specs

[`scripts/bc-api.mjs`](scripts/bc-api.mjs): zero-dependency Node 18+ script. Downloads `https://docs.bigcommerce.com/openapi/<name>.json` on first use and caches it in `.ai/skills/bigcommerce/.cache/` (gitignored). It resolves `$ref`s and prints a compact view so you never have to open a 400 KB file.

```bash
node .ai/skills/bigcommerce/scripts/bc-api.mjs <command>     # or: npm run bc:api -- <command>
```

| Command | Output |
|---|---|
| `list [filter]` | Spec names (e.g. `admin-management-orders`) |
| `paths <spec>` | Every `METHOD path — summary` in one spec (spec name may be a unique substring) |
| `search <term> [--spec <name>]` | Operations across all specs whose path/summary/description match. First run downloads all 76 specs (a few MB); later runs are local |
| `show <spec> <METHOD> <path-fragment>` | Description, params, request body fields (`*` = required, enums inlined), responses |
| `refresh` | Re-download everything (do this if a field looks missing — BC updates specs) |

Typical flow: `search` → pick spec + path → `show`. Examples:

```bash
node .ai/skills/bigcommerce/scripts/bc-api.mjs search "order metafield"
node .ai/skills/bigcommerce/scripts/bc-api.mjs show admin-management-order-operations GET "orders/{order_id}/metafields"
node .ai/skills/bigcommerce/scripts/bc-api.mjs paths integrations-webhooks
```

Gotchas
- **Git Bash on Windows** mangles arguments starting with `/` (turns `/v3/x` into `C:/Program Files/Git/v3/x`). Omit the leading slash, or run in PowerShell.
- Specs' `paths` are shown as `/stores/{store_hash}/v3/...`; `store_hash` is hidden from parameter lists because it is always the same.
- Piping into `head` can print an `EPIPE` stack trace after the useful output — harmless.
- OAuth scopes are only in each operation's prose/`description` if at all; see [`management-api.md`](management-api.md#scopes) for the scope table to cross-check.

## 2. BigCommerce docs MCP server

Official, remote, read-only. Tool: `searchDocs(query: string, topK?: number = 8, max 20)` → passages with source URLs. Use it for *guides and concepts* (OAuth flow, Script Manager behaviour, GraphQL limits); use `bc-api.mjs` for *endpoint shapes*.

Project-scoped config is committed in [`/.mcp.json`](../../../.mcp.json) so every agent/clone gets it (Claude Code asks to approve project MCP servers on first use). Equivalent manual command, project scope instead of the `--scope user` form the docs suggest:

```bash
claude mcp add --transport http --scope project bigcommerce-docs https://docs.bigcommerce.com/_mcp/server
```

If the MCP isn't connected in your session, fall back to `WebFetch` on `https://developer.bigcommerce.com/docs/...` pages, or `curl` the specs via the CLI above.

## 3. terminalskills.io `bigcommerce` skill

Reviewed; it is a general guide (Storefront GraphQL, Management REST, Catalyst headless). Its install button command isn't visible on the page, and its content is already covered by the specs + docs MCP, so **it was not installed**. Useful nuggets were folded into [`storefront-apis.md`](storefront-apis.md) and marked "per terminalskills — verify". If someone later wants it, install it **into the project** (e.g. under `.claude/skills/` or a `.ai/skills/` copy), not `~/.claude`.

## 4. Postman CLI (installed on the dev machine)

BC publishes Postman collections, and this repo has a `postman/` folder. For API testing use the `postman:*` skills. For quick one-offs against a sandbox store, `curl` with `X-Auth-Token` is simpler:

```bash
curl -s -H "X-Auth-Token: $BC_TOKEN" -H "Accept: application/json" \
  "https://api.bigcommerce.com/stores/$BC_STORE_HASH/v3/catalog/summary"
```

Tokens come from a store-level API account (BC admin → Settings → API accounts) and live in your shell/`.env` — never in these docs.

## 5. Libraries already in the repo (don't add duplicates)

| Need | Already installed |
|---|---|
| Admin UI components | `@bigcommerce/big-design` (+ `styled-components`) |
| JWT verification of `/load` + `/uninstall` | `jsonwebtoken` |
| HTTP to BC | Node's global `fetch` (see `bcFetch` in `server/bigcommerce/proxy.ts`) |

Optional, **only if a task truly needs it** — install locally with `npm i -D`, then add a line here:
- `@bigcommerce/big-design-icons` — icons for BigDesign (check whether `big-design` already re-exports what you need first).
- `openapi-typescript` — generate TS types from a spec (`npx openapi-typescript https://docs.bigcommerce.com/openapi/<name>.json -o ...`). Note `server/` can't import from `src/`, so generate into the folder that will use it.
