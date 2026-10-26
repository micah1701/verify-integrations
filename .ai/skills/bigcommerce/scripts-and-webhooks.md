# Script Manager API & Webhooks

Both are v3 Management API features. Re-run `show` for current fields before coding (specs: `admin-management-scripts`, `integrations-webhooks`).

## Script Manager API — install the storefront bundle programmatically

Today merchants paste a snippet into Script Manager by hand. The API can do this at app install time.

```bash
node .ai/skills/bigcommerce/scripts/bc-api.mjs paths admin-management-scripts
node .ai/skills/bigcommerce/scripts/bc-api.mjs show admin-management-scripts POST v3/content/scripts
```

`POST /v3/content/scripts` (verified against the spec):
- Required: `name`. `kind`: `src` (set `src`, optionally `load_method`) or `script_tag` (set `html`, **not** `src`).
- `location`: `head` | `footer`. `visibility`: `storefront` | `all_pages` | `checkout` | `order_confirmation` — the last two need the **Checkout content** scope.
- `consent_category`: `essential` | `functional` | `analytics` | `targeting`. Unspecified defaults to `unknown`, and such scripts may be blocked until consent — pick deliberately for the verification widget.
- `auto_uninstall: true` cleans the script up when the app is uninstalled/revoked.
- `integrity_hashes` supports SRI — note our bundle filename is stable (`bigcommerce.js`), so an SRI hash would break on every deploy; skip it or version the filename.
- Limits: 50 scripts per channel, 10 per app. `channel_id` scopes to one storefront.
- Our config (`window.AdHocVerifyConfig` with `integrationKey` + `templateId`) is an **inline** script, which must come first. With `kind: script_tag` you can include both the config and the `<script src>` in one `html` string (exactly one `<script>` tag is allowed per script — so create **two** scripts, config first, or inline the loader). Check ordering on a sandbox store before shipping.
- After a bundle deploy, Cloudflare still caches the file — see [`../deploy.md`](../deploy.md).

Where to wire it: `server/bigcommerce/auth.ts` after `upsertToken` (needs the Content scope added to the registered app, and merchants re-authorize). That is a behaviour change to the install flow: update [`../../integrations/bigcommerce/server.md`](../../integrations/bigcommerce/server.md) and design-decisions ("storefront is serverless") in the same change.

## Webhooks

```bash
node .ai/skills/bigcommerce/scripts/bc-api.mjs paths integrations-webhooks
```

- `POST /v3/hooks` creates **one** webhook per call. Body: `scope` (event, required), `destination` (required), `is_active`, optional `headers`.
- Destination **must be HTTPS, port 443, and return 200**; BC deactivates hooks that keep failing — re-enable via `PUT /v3/hooks/{id}` with `is_active: true`.
- Hooks are tied to the `client_id` of the token that created them, so an app only sees its own.
- Payloads are thin (event + resource ID); fetch the resource afterwards. Respond 200 fast, process async.
- Authenticate deliveries with a secret in custom `headers` (BC sends them back) and compare in constant time. Don't trust the body alone.
- Common scopes (confirm exact strings with the docs MCP `searchDocs "webhook events"`): `store/order/created`, `store/order/statusUpdated`, `store/cart/created`, `store/cart/updated`, `store/cart/converted`, `store/customer/created`. Wildcards like `store/order/*` exist.
- Hook relevant to this product: `store/cart/converted` / `store/order/created` could link a verification to an order server-side instead of relying on the confirm-page JS (see the order-linking flow in [`../../integrations/bigcommerce/metafields.md`](../../integrations/bigcommerce/metafields.md)).

A new webhook receiver is a new Express route under `/bigcommerce/` (e.g. `server/bigcommerce/webhooks.ts`, mounted in `router.ts`) — follow [`../add-admin-endpoint.md`](../add-admin-endpoint.md) for wiring, and register hooks in `auth.ts` on install and remove them in `uninstall.ts`.
