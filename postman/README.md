# Postman Collections

Two collections for testing the Verify Integrations platform — our own Express server and the upstream Ad-Hoc Verify API.

---

## Collections

### Verify Integrations Server

Our Express app at `verify-integrations.ad-hoc.app`. The `base_url` collection variable defaults to production — switch it to `http://localhost:3000` for local dev.

| Request | Description |
|---|---|
| `GET /health` | Liveness check — no auth required |
| `GET /bigcommerce/auth` | OAuth install callback. Requires a real one-time `code` from a BC redirect — copy from server logs. |
| `GET /bigcommerce/load` | JWT-verified app load. Requires a `signed_payload_jwt` signed with `BC_CLIENT_SECRET` (see below). |
| `GET /bigcommerce/uninstall` | JWT-verified uninstall. Same JWT approach as `/load`. |
| `GET /bigcommerce/admin/` | Static SPA check — confirms the admin build is deployed. |

### Ad-Hoc Verify API

All upstream calls to `verify-api.ad-hoc.app`, organized into five folders.

| Folder | Contents |
|---|---|
| **1 · REST API — Auth** | `POST /api/auth` — email + password → Bearer token. Test script auto-saves to `{{bearer_token}}`. |
| **2 · REST API — Verifications** | Create verification, get full status + PII results, retry webhook, purge PII. |
| **3 · Integration Key — Storefront API** | `POST /create-verification` and `GET /get-verification-result` — the calls `bigcommerce.js` makes from the browser. |
| **4 · BC Metafields Proxy** | `POST /bc-metafields` — all five variants: read cart, write cart (create + update), read customer, write customer. |
| **5 · BigCommerce Storefront API** | `GET /api/storefront/carts` and `GET /customer/current.jwt` — called against the BC store domain. Require a browser session cookie; documented here for reference. |

---

## Importing into Postman

1. Open Postman and click **Import** (top left).
2. Drag both `.json` files into the import dialog, or click **Upload Files** and select them.
3. Both collections will appear in the **Collections** sidebar.

---

## Configuring the Variables

Each collection has its own set of **collection variables**. To edit them:

1. Click the collection name in the sidebar.
2. Open the **Variables** tab.
3. Fill in the **Current Value** column (current values are local to your machine and not synced or committed).

### Verify Integrations Server — variables

| Variable | Default | What to set |
|---|---|---|
| `base_url` | `https://verify-integrations.ad-hoc.app` | Change to `http://localhost:3000` for local dev |
| `signed_payload_jwt` | *(empty)* | See "Generating a test JWT" below |

### Ad-Hoc Verify API — variables

| Variable | Default | What to set |
|---|---|---|
| `api_base` | `https://verify-api.ad-hoc.app` | Leave as-is |
| `bearer_token` | *(empty)* | Auto-populated by `POST /api/auth` test script |
| `integration_key` | `ahv_pub_REPLACE_ME` | Integration key from Profile → Integration Key in the dashboard |
| `verification_id` | *(empty)* | Auto-populated by create-verification test scripts |
| `store_hash` | `REPLACE_WITH_STORE_HASH` | Short alphanumeric ID from the BC store URL |
| `store_access_token` | `REPLACE_WITH_BC_ACCESS_TOKEN` | X-Auth-Token from a BC store-level API account (Carts + Customers read/write scopes) |
| `cart_id` | *(empty)* | UUID of a live BC cart — copy from `GET /api/storefront/carts` |
| `customer_id` | *(empty)* | BC customer ID (integer) — copy from a cart or customer record |
| `bc_store_domain` | `REPLACE_WITH_STORE.mybigcommerce.com` | Your BC store domain |

---

## Quickstart: Verify API flow

1. Run **POST /api/auth** with your email and password → `{{bearer_token}}` is saved automatically.
2. Run **POST /api/verification** → `{{verification_id}}` is saved automatically. Copy the `url` from the response and open it on a mobile device to complete the flow.
3. Poll **GET /api/verification** until `status` is `completed`.
4. To test the storefront path instead, set `{{integration_key}}` and run **POST /create-verification (integration key)** → same `{{verification_id}}` save. Poll with **GET /get-verification-result** (public, no auth).

---

## Generating a test JWT for `/load` and `/uninstall`

BigCommerce signs these JWTs with your `BC_CLIENT_SECRET` using HS256. To generate one locally:

```js
// Node.js — run once, paste the output into the Postman variable
import jwt from 'jsonwebtoken';

const token = jwt.sign(
  {
    sub: 'stores/YOUR_STORE_HASH',
    iss: process.env.BC_CLIENT_ID,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300, // 5 min
    user: { id: 1, email: 'you@example.com' }, // omit for /uninstall
  },
  process.env.BC_CLIENT_SECRET,
  { algorithm: 'HS256' }
);

console.log(token);
```

Or use [jwt.io](https://jwt.io) — set the algorithm to HS256, paste your secret, and fill in the payload above.

> The store hash in `sub` must already exist in `data/tokens.json` (i.e. the store must have completed the OAuth install) or `/load` will return 404.

---

## Notes on the BC Storefront API requests

The requests in folder **5 · BigCommerce Storefront API** (`/api/storefront/carts`, `/customer/current.jwt`) are called by `bigcommerce.js` from within the browser on the store page — they authenticate via the shopper's session cookie, not an API key. They will not work directly from Postman without cookie injection. They are included for documentation and for use with the Postman browser extension or a proxied browser session.
