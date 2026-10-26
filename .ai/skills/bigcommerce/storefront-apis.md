# Storefront APIs (shopper side)

Three different things share the word "storefront". Don't mix them:

| API | Base | Auth | Spec / docs | Used here |
|---|---|---|---|---|
| **Storefront REST** | same-origin `/api/storefront/*` on the shopper's store | Shopper session cookie | `storefront-carts`, `storefront-checkouts`, `storefront-customers`, `storefront-orders`, … | Yes — `bc-adapter.ts`, `checkout-block.ts` |
| **Current customer JWT** | `/customer/current.jwt?app_client_id=…` on the store | Cookie | `admin-authentication-current-customer` | Yes — identifies the shopper to Ad-Hoc Verify |
| **GraphQL Storefront API** | `https://store-<hash>.mybigcommerce.com/graphql` (or the channel's domain) | Bearer storefront token | docs MCP: `searchDocs "GraphQL Storefront"` | No (not needed for our flow) |

All three run **in the shopper's browser or a headless frontend**; none can write merchant data except through carts/checkouts the shopper owns. Merchant-data writes (metafields) go through the `bc-metafields` edge function → Management API ([`../../integrations/bigcommerce/metafields.md`](../../integrations/bigcommerce/metafields.md)).

## Storefront API tokens

Verified in `admin-authentication-storefront-api-tokens` (create via Management API, needs the *Manage Storefront API Tokens* scope):

| Endpoint | Use |
|---|---|
| `POST /v3/storefront/api-token` | **Browser** tokens; supports `allowed_cors_origins` (max two) |
| `POST /v3/storefront/api-token-private` | **Server-to-server** tokens; the API rejects them when the request comes from a browser. Requires `scopes[]` listing the GraphQL fields you need |
| `POST /v3/storefront/api-token-customer-impersonation` | Act as a logged-in customer in GraphQL |

All take `expires_at` (Unix seconds, required) and one of `channel_id` / `channel_ids` (exactly one — both or neither errors). Tokens expire: plan rotation. Revoke endpoints exist per token and `revoke-all`.

Per terminalskills (verify against current docs before relying on it): server-side integrations created after **30 June 2026** should use private tokens. The spec's own wording already steers server use to the private endpoint, so default to private for anything in `server/`.

## GraphQL Storefront API — limits worth knowing

(from terminalskills; confirm with `searchDocs`) query complexity and depth limits apply; max **50** items per page for connections; test queries in the control panel's *Storefront API Playground*. Primarily read-oriented — use the REST Management API for admin writes.

## Headless / Catalyst (context only)

BigCommerce's official headless storefront is **Catalyst** (Next.js App Router + GraphQL; needs a recent Node and pnpm via Corepack; scaffolded by a CLI asking for store hash + channel). Our widget targets the hosted Stencil/Optimized One-Page Checkout. A headless merchant would need a different adapter — treat it as a new integration surface, not a tweak to `bc-adapter.ts`. Do not use the old Vercel Commerce template (no BigCommerce provider anymore, per terminalskills).

## Debugging storefront calls

Use [`../debug-storefront.md`](../debug-storefront.md); for endpoint shapes use the CLI:

```bash
node .ai/skills/bigcommerce/scripts/bc-api.mjs paths storefront-checkouts
node .ai/skills/bigcommerce/scripts/bc-api.mjs show storefront-carts POST carts
```
