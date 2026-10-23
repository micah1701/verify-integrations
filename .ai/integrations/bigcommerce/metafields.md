# BigCommerce — Metafields & the `bc-metafields` Proxy

The verification outcome is persisted on BigCommerce resources as a single JSON metafield, so merchants (and the admin SPA) can see it without any extra database.

## Metafield shape

```jsonc
{
  "namespace": "Ad-Hoc Verify",
  "key": "verification",
  "permission_set": "write_and_sf_access",
  "value": "<JSON string of MetafieldValue>"
}
```

`MetafieldValue` (`src/core/types.ts`):
```ts
{ verificationId: string; status: VerificationStatus; completedAt: string;   // ISO, set when the *metafield* is built
  verification: { success, over_18, over_21, face_match_score, blockchain_name? } }
```

- Built by `buildMetafieldPayload(verificationId, result, status)` in `src/core/verify-api.ts`. `null` result fields stay `null` (manual review writes all-null).
- **`write_and_sf_access`** is deliberate: it lets *any* Management-API credential read it (the merchant's store-level API account used by the storefront **and** our OAuth app token used by the admin). `app_only` would hide it from the other credential.
- Only safe outcome fields; **no PII**.

## Where it's written

| Resource | When | Writer |
|---|---|---|
| **Cart** `/v3/carts/{cartId}/metafields` | Always on completion/manual review; also by carry-over paths | `saveCartMetafield` |
| **Customer** `/v3/customers/{id}/metafields` | Logged-in customers on completion; backfill after login; (not guests) | `saveCustomerMetafield` |
| **Order** (via `resource:'order'`) | On the order-confirmation page | `saveOrderMetafield` |

Create vs update: a known `metafieldId` ⇒ `PUT …/metafields/{id}`; none ⇒ `POST …/metafields`. IDs come from the last read (`resolved.cartMfId/customerMfId`). If you POST when one already exists BC rejects it (namespace+key unique) — always pass the existing ID when you have it.

Read: `GET …/metafields` (returns all metafields on the resource; client filters by namespace/key in `findVerificationMetafield`).

## The proxy: `supabase/functions/bc-metafields/index.ts`

Why: `api.bigcommerce.com` blocks browser CORS, and we never put the OAuth token in the browser. The edge function relays server-to-server.

`POST https://verify-api.ad-hoc.app/bc-metafields` (no Supabase JWT; token in the body)

```ts
{ action: 'read'|'write', storeHash, storeAccessToken, resource: 'cart'|'customer'|'order',
  resourceId: string, metafieldId?: number, payload?: object }
```

Validation (400): `storeHash` must match `/^[a-z0-9]+$/i`; token string; `resource` ∈ {cart, customer, order}; `resourceId`; `action` ∈ {read, write}; `payload` required for write. 405 for non-POST. CORS `*` with preflight handled.

Behaviour:
- `resource:'order'`: first `GET /v2/orders/{id}` to obtain `cart_id` (and `customer_id`); 422 if no `cart_id`. Then reads/writes **cart** metafields with that cart UUID (cart metafields persist after checkout, work for guests). Response gets extra `resolvedCustomerId` and `cartId`.
- URL: `https://api.bigcommerce.com/stores/{hash}/v3/{carts|customers}/{id}/metafields[/{metafieldId}]`.
- Method: read ⇒ GET; write ⇒ PUT if `metafieldId` else POST.
- BC non-2xx status is passed through with BC's JSON body (400/401/404 are meaningful). Upstream exception ⇒ 502 `{error:'Upstream request failed'}`.
- Client side `bcMetafieldsProxy()` returns `null` for any non-2xx (the status/body is lost) — enable `logging` and check Network tab to see why.

Deployment: CLI only — see [`../../global/deployment.md`](../../global/deployment.md#supabase-edge-function). The function is deployed to the Ad-Hoc Verify Supabase project; the repo copy is the source of truth.

## Caching

IndexedDB TTL 5 min for cart and customer metafield reads (`adhoc_cart_mf_<id>`, `adhoc_customer_mf_<id>`). **After every write call `invalidateMetafieldCache(cartId, customerId)`** or the widget shows stale state for up to 5 minutes.

## State resolution (reads)

`resolveOverallState(cartMf, customerMf, ruleset)` — customer-verified wins, then cart-verified, else best non-verified state (pending_review > invalid > incomplete > unverified). Details in [`../../global/core-library.md`](../../global/core-library.md#verification-statets).

## Admin reads

Admin lists read **customer** (`/v3/customers/{id}/metafields?namespace=Ad-Hoc+Verify`) and **order** (`/v2/orders/{id}/metafields`) metafields through the server proxy, falling back from order to customer. See the TODO in [`server.md`](server.md#proxyts--management-api-read-proxy-for-the-admin) about order-vs-cart storage.

## Checklist: changing the stored shape
See [`../../skills/change-metafield-shape.md`](../../skills/change-metafield-shape.md).
