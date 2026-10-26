# Management API — Server-Side Cookbook

Base: `https://api.bigcommerce.com/stores/<store_hash>/v2|v3/...`. Server only — the token must never reach browser code (see [`../../global/rules.md`](../../global/rules.md)).

## Auth

| Header | Value |
|---|---|
| `X-Auth-Token` | OAuth access token from install (`getToken(storeHash)` in `server/core/db.ts`) or a store-level API account token |
| `Accept` | `application/json` (specs mark it required on many endpoints) |
| `Content-Type` | `application/json` on writes |

The **client secret** only verifies signed JWTs (`/load`, `/uninstall`). The **access token** calls the API. Never swap them. See [`admin-app.md`](admin-app.md).

## Calling it from this repo

Use the existing helper, don't write a second one — `bcFetch<T>(storeHash, token, path)` in `server/bigcommerce/proxy.ts`. Contract: returns `null` on non-2xx, empty body, or network error (v2 `/orders` returns an **empty body**, not `[]`, when there are none). It's GET-only today; for writes, add a sibling `bcWrite` rather than overloading it, and surface the BC error body (BC returns `{status,title,errors}` on 4xx) in logs — never the token.

Step-by-step for a new admin endpoint: [`../add-admin-endpoint.md`](../add-admin-endpoint.md).

## Conventions that bite

| Topic | Rule |
|---|---|
| Versions | v2 and v3 are not interchangeable; verify the path in the spec ([`api-map.md`](api-map.md#v2-vs-v3-rule-of-thumb)) |
| Pagination | v3: `?page=&limit=` (max usually 250; this repo clamps its proxy to 50), response `meta.pagination`. v2: `?page=&limit=` (max 250), no meta — use `/count` endpoints |
| Filtering | v3 uses suffix filters: `id:in=1,2,3`, `date_created:min`, `name:like`. Check each spec's query params |
| Sorting | v3: `sort=date_created:desc`; v2 orders: `sort=date_created&direction=desc` |
| Includes | `include=…` / `include_fields=…` reduce calls and payload (e.g. products `include=variants`) — prefer over N+1 |
| Batch writes | Several resources have "Create/Update Multiple …" endpoints (e.g. `/v3/customers/metafields`) — use them instead of looping |
| Rate limits | Plan-based. On `429`, read `X-Rate-Limit-Time-Reset-Ms` and back off; `X-Rate-Limit-Requests-Left` shows headroom. The admin proxy's N+1 fan-out is the main risk ([`server.md`](../../integrations/bigcommerce/server.md#proxyts--management-api-read-proxy-for-the-admin)) |
| Errors | v3: `{status,title,type,errors}`; v2: array/object with `message`. Treat 401 as "token revoked/uninstalled", 403 as "missing scope", 422 as payload problem |
| IDs | Cart ID == Checkout ID. Metafield/customer/order IDs are integers; cart IDs are UUID strings |
| Metafields | Namespace + key unique per resource; `permission_set` controls storefront visibility (`write_and_sf_access` here). Max 250 per resource per client ID. Details: [`../../integrations/bigcommerce/metafields.md`](../../integrations/bigcommerce/metafields.md) |

## Scopes

Scopes are fixed at app registration (Developer Portal) and granted at install; adding one requires merchants to re-authorize. Check the operation's description (`show …`) for "Required Scopes". Currently registered / assumed: see [`../../integrations/bigcommerce/overview.md`](../../integrations/bigcommerce/overview.md#bc-oauth-scopes).

| To call | Scope (as named in the BC UI) |
|---|---|
| Customers / metafields | Customers (read-only or modify) |
| Orders v2 + v3 order ops | Orders (read-only or modify) |
| Carts, checkouts | Carts / Checkout |
| Script Manager API | Content — and **Checkout content** for `checkout`/`order_confirmation` visibility |
| Webhooks | Whatever resource the event covers, plus none for `/v3/hooks` itself |
| Storefront API tokens | Storefront API Tokens (manage) |

## Quick sandbox check

```bash
curl -s -H "X-Auth-Token: $BC_TOKEN" -H "Accept: application/json" \
  "https://api.bigcommerce.com/stores/$BC_STORE_HASH/v3/customers?limit=1"
```
`401` = wrong token/store pair; `403` = scope; `404` on a sub-resource = probably wrong API version.
