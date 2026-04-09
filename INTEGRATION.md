# Ad-Hoc Verify — Integration Guide

> For AI agents and developers building third-party integrations against the Ad-Hoc Verify platform.

**Live platform:** https://verify.ad-hoc.app
**API base URL:** https://verify-api.ad-hoc.app

---

## What Is Ad-Hoc Verify?

Ad-Hoc Verify is an identity verification service ("Verification as a Service"). Client companies create verification requests; end users (the people being verified) complete a guided mobile flow — scanning their driver's license, taking a liveness selfie, and having their face compared to the license photo. Results are delivered via webhook and/or polled via API.

All face detection runs **client-side in the browser**. No raw images leave the user's device — only comparison results and optionally requested PII fields are stored.

---

## Two Integration Methods

| | REST API | Integration Key |
|---|---|---|
| **Auth** | Email + password → Bearer token | `X-API-Key: ahv_pub_...` header |
| **Where it lives** | Server environment / secrets manager | Client-side JavaScript (safe to expose) |
| **Use case** | Backend creates + reads verifications | Storefront plugins, browser scripts |
| **Can read results** | Yes | No — results via webhook or REST API |
| **Domain restriction** | No | Yes (required — configure in Profile) |

---

## Method 1: REST API (Server-Side)

### Authentication

```bash
POST https://verify-api.ad-hoc.app/api/auth
Content-Type: application/json

{ "email": "you@company.com", "password": "your-password" }
```

Response:
```json
{ "access_token": "eyJ...", "expires_in": 3600 }
```

Use `Authorization: Bearer <access_token>` on all subsequent requests. Re-authenticate when you receive a `401`.

### Create a Verification

```bash
POST https://verify-api.ad-hoc.app/api/verification
Authorization: Bearer <token>
Content-Type: application/json

{
  "template_id": "uuid",           # optional — use a saved template
  "webhook_url": "https://...",    # optional — results POSTed here on completion
  "webhook_headers": { "X-My-Key": "secret" },
  "requested_fields": ["first_names", "last_name", "dob"],
  "external_id": "order-9981",     # optional — echoed back in webhook payload
  "phone_verification": false,
  "include_license_photo": false
}
```

Response `201`:
```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "url": "https://verify.ad-hoc.app/verify/f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "created_at": "2026-03-31T12:00:00.000Z"
}
```

Send `url` to the end user — they open it on their mobile device to complete verification.

### Retrieve a Verification

```bash
GET https://verify-api.ad-hoc.app/api/verification?id=f47ac10b-...
Authorization: Bearer <token>
```

Response when completed:
```json
{
  "id": "f47ac10b-...",
  "status": "completed",
  "created_at": "...",
  "completed_at": "...",
  "result": { ...see Webhook Payload below... }
}
```

Status values: `pending` → `started` → `completed` / `manual_review` / `expired`

---

## Method 2: Integration Key (Client-Side / Storefront)

An integration key (`ahv_pub_...`) is a publishable key generated from **Profile → Integration Key** in the dashboard. It can only call `POST /verification` and is restricted to domains you allowlist.

```js
fetch('https://verify-api.ad-hoc.app/create-verification', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'ahv_pub_...',
  },
  body: JSON.stringify({ template_id: 'uuid' }),
})
```

Response is the same `{ id, url }` shape as the REST API.

**Important:** Add at least one allowed domain in Profile before deploying — requests from unlisted origins return `403`.

---

## Webhook Payload

When verification completes, the configured `webhook_url` receives a `POST` with:

```json
{
  "request_id": "f47ac10b-...",
  "external_id": "order-9981",
  "verification": {
    "license_appears_real": true,
    "license_expired": false,
    "webcam_appears_live": true,
    "webcam_face_matches_license_photo": true,
    "face_match_score": "definite_match",
    "over_18": true,
    "over_21": true
  },
  "license_data": {
    "first_names": "JOHN",
    "last_name": "DOE",
    "dob": "1990-01-15"
  }
}
```

### `face_match_score` Values

| Value | Meaning |
|---|---|
| `definite_match` | Strong match on all signals (composite score ≥ 75) |
| `likely_match` | Passes primary Euclidean threshold (≥ 55) |
| `possible_match` | Borderline — cosine rescue may have applied (≥ 40) |
| `no_match` | No meaningful similarity (< 40) |

`webcam_face_matches_license_photo` is the boolean authority. `face_match_score` gives the confidence tier. Use both when making authorization decisions.

### Available `requested_fields`

`first_names`, `last_name`, `middle_names`, `dob`, `dob_year`, `dob_year_month`, `dob_month_day`, `sex`, `street_address`, `city`, `state`, `postal_code`, `license_number`, `license_issue_date`, `license_expiration_date`

Only requested fields appear in `license_data`. Un-requested fields are omitted entirely.

### Webhook Retries

Failed deliveries are retried up to 3 times (immediate, then escalating delays). You can also manually retry from the dashboard or call `POST /retry-webhook` with a Bearer token.

---

## Polling for Completion (Client-Side)

For browser integrations that open the verification in an iframe or modal, poll until `status === 'completed'`:

```bash
GET https://verify-api.ad-hoc.app/get-verification-result?id=f47ac10b-...
```

Response:
```json
{
  "status": "completed",
  "result": {
    "success": true,
    "over_18": true,
    "over_21": true,
    "face_match_score": "definite_match"
  },
  "completed_at": "..."
}
```

Note: `get-verification-result` returns only safe public-facing outcome fields (no PII). Retrieve full results including `license_data` using the REST API with a Bearer token.

The verification iframe also fires a `postMessage` to the parent window on completion:
```js
window.addEventListener('message', (e) => {
  if (e.data?.type === 'adhoc-verify-complete') {
    const { verificationId } = e.data;
    // poll get-verification-result or fetch from your server
  }
});
```

---

## BigCommerce Plugin

A ready-made plugin (`static/plugin/bigcommerce.js`) is available for BigCommerce Stencil storefronts. Include it via Script Manager.

### Setup

**1. Get an integration key** from Profile → Integration Key in your Ad-Hoc Verify dashboard. Add your store domain to the allowlist (e.g., `yourstore.mybigcommerce.com`).

**2. Create a verification template** in the Ad-Hoc Verify dashboard. Note the template UUID.

**3. Configure the template's store credentials** via the **Integration Config** tab in the BC admin app (Apps → Ad-Hoc Verify → Integration Config). Enter your Integration Key and Template ID, load the config, then click Edit (requires your Ad-Hoc Verify credentials) and fill in:
- **Store Hash** — from your BC store URL
- **Store Access Token** — from a BC store-level API account (Settings → Store-level API accounts; required scopes: Carts read/write, Customers read/write)
- **Pages**, **Ruleset**, and any other UI settings

**4. Add to Script Manager** (all pages, footer):

```html
<script>
  window.AdHocVerifyConfig = {
    integrationKey: 'ahv_pub_...',              // Your Ad-Hoc Verify integration key
    templateId:     'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',  // Your template UUID
  };
</script>
<script src="https://verify-integrations.ad-hoc.app/storefront/bigcommerce.js"></script>
```

The plugin fetches all other configuration (storeHash, storeAccessToken, pages, ruleset, etc.) from the template at runtime — no other values need to appear in the script tag.

Any value you _do_ set in `window.AdHocVerifyConfig` overrides the template config for that store, which is useful for per-environment overrides during development.

### What the Plugin Does

1. On page load: fetches the current cart via the BC Storefront API (`/api/storefront/carts`)
2. Checks cart and/or customer metafields (namespace `Ad-Hoc Verify`, key `verification`) for an existing valid verification
3. If already verified: shows a green "Identity Verified ✓" badge
4. If not verified: shows a "Verify ID" button (+ optionally disables the checkout button)
5. On button click: creates a verification via your integration key, opens the verification flow in a modal iframe
6. On completion: saves the verification result to BC metafields via the `bc-metafields` proxy and re-renders the UI

### BC Metafields Proxy

The plugin routes all BC metafield reads and writes through the Ad-Hoc Verify API at:

```
POST https://verify-api.ad-hoc.app/bc-metafields
```

This bypasses the browser CORS restriction on `api.bigcommerce.com`. The proxy validates inputs and relays calls server-to-server. Your `storeAccessToken` travels from the browser to `verify-api.ad-hoc.app` over HTTPS — it is never sent directly to BigCommerce from the browser.

**Metafield format saved to BC:**

```json
{
  "namespace": "Ad-Hoc Verify",
  "key": "verification",
  "permission_set": "write_and_sf_access",
  "value": "{\"verificationId\":\"uuid\",\"status\":\"completed\",\"completedAt\":\"...\",\"verification\":{\"success\":true,\"over_18\":true,\"over_21\":true,\"face_match_score\":\"definite_match\"}}"
}
```

Saved to cart metafields for guests; also to customer metafields for logged-in customers.

### Plugin Config Reference

When `templateId` is set, the plugin fetches `integration_config` from the template at boot and uses those values as defaults. Anything set in `window.AdHocVerifyConfig` takes precedence over the template config.

| Option | Type | Required | Description |
|---|---|---|---|
| `integrationKey` | string | **Yes** | Integration key (`ahv_pub_...`) |
| `templateId` | UUID string | Recommended | Template whose `integration_config` is fetched at boot to supply all other settings |
| `storeHash` | string | For metafields | BC store hash — usually stored in `integration_config`, not the script tag |
| `storeAccessToken` | string | For metafields | BC store-level API access token — usually stored in `integration_config` |
| `pages` | string[] | No | Pages to activate: `'cart'`, `'checkout'`, `'order-confirmation'` (default: `['cart']`) |
| `ruleset.requireVerification` | boolean | No | Disable checkout button until verified (default: `true`) |
| `ruleset.minFaceMatchScore` | string\|null | No | Minimum acceptable face match tier: `'definite_match'`, `'likely_match'`, `'possible_match'`, or `null` |
| `ruleset.requireOver18` | boolean | No | Fail verification if `over_18` is false |
| `ruleset.requireOver21` | boolean | No | Fail verification if `over_21` is false |
| `manualReview.blockCheckout` | boolean | No | Block checkout while verification is pending manual review (default: `false`) |
| `manualReview.message` | string\|null | No | Message shown during manual review; `null` hides it |
| `buttonText` | string | No | Button label (default: `'Verify ID'`) |
| `selector` | CSS selector | No | Where to inject the UI (default: `.cart-actions`) |
| `apiBase` | string | No | Ad-Hoc Verify API base URL (default: `https://verify-api.ad-hoc.app`) |
| `verifyBase` | string | No | Ad-Hoc Verify app base URL (default: `https://verify.ad-hoc.app`) |
| `onComplete` | function(id) | No | Callback with verification ID on completion |
| `onResult` | function(result) | No | Callback with `{ verificationId, success, over_18, over_21, face_match_score }` |

### Integration Config (Template-Driven Configuration)

Store-specific settings are stored in `verification_templates.integration_config` (a JSONB column) and fetched by the storefront plugin at runtime. This means the Script Manager snippet only needs two values — `integrationKey` and `templateId` — and the template holds everything else.

**To read the template config** (storefront, no auth beyond the integration key):

```bash
GET https://verify-api.ad-hoc.app/get-template-config?template_id=<uuid>
X-API-Key: ahv_pub_...
```

Response: the `IntegrationConfig` object (`storeHash`, `storeAccessToken`, `pages`, `ruleset`, `manualReview`, `buttonText`, `selector`).

**To update the template config** (requires a Bearer token — use `POST /api/auth` first):

```bash
PATCH https://verify-api.ad-hoc.app/api/templates/<uuid>
Authorization: Bearer <token>
Content-Type: application/json

{ "integration_config": { ...fields... } }
```

The **Integration Config** tab in the BC admin app (Apps → Ad-Hoc Verify) provides a form-based UI for reading and editing this config without making raw API calls.

---

## Optional Features

### Phone Verification

Enable `phone_verification: true` on a template or request. The end user is prompted to verify their phone number via SMS OTP before the selfie step. The `phone_areacode` field is always included unencrypted in results. Full phone lookup data (carrier, caller name, line type) is included under `phone_verification.lookup`.

### License Photo

Enable `include_license_photo: true` to include a cropped face photo from the driver's license in the webhook payload / results. Useful for manual review workflows.

### E2E Encryption

Three modes for handling PII:

| Mode | Behavior |
|---|---|
| `none` | Plaintext PII in results (default) |
| `shared` | Platform-managed key — viewable in dashboard, auto-purged after 30 days |
| `custom` | Client's RSA public key — only client can decrypt; server never sees plaintext |

Encrypted PII is delivered as an `EncryptedEnvelope` (`{ v, alg, encrypted_key, iv, ciphertext }`) in place of the `license_data` object. Decrypt with: unwrap the AES-256 key using your RSA private key (RSA-OAEP), then decrypt `ciphertext` with AES-256-GCM using the `iv`.

---

## Verification Flow (What End Users Experience)

```
consent → license-front → [license-no-face retry] → license-back → [phone-verify] → selfie → processing → complete
```

1. **Consent** — shows your company name, custom message, and which data fields are being collected
2. **License front** — rear camera; guided card detection (edge alignment, tilt, sharpness); face + OCR extracted
3. **License back** — PDF417 barcode scan; AAMVA data decoded
4. **Phone verify** — (if enabled) SMS OTP sent + verified
5. **Selfie** — front camera; liveness challenges (blink + head turn, 20s timeout)
6. **Processing** — face match computed, cross-validation run, result assembled and submitted
7. **Complete** — success screen; verification stored; webhook fired (if configured)

If the face match fails, the end user can optionally request **manual review** (face images submitted for human review, status set to `manual_review`).

---

## API Rate Limits

| Action | Limit |
|---|---|
| `POST /api/auth` | 5 requests / minute / email |
| `POST /api/verification` | 100 requests / hour |
| `GET /api/verification` | 300 requests / hour |
| Integration key (`create-verification`) | 30 requests / hour (default) |

---

## Error Format

All errors return:
```json
{ "error": "Human-readable description", "code": "MACHINE_READABLE_CODE" }
```

Common codes: `MISSING_AUTH`, `UNAUTHORIZED`, `VALIDATION_ERROR`, `NOT_FOUND`, `RATE_LIMITED`, `INTERNAL_ERROR`

---

## Key Endpoints Summary

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/auth` | Public | Get Bearer token |
| `POST /api/verification` | Bearer token | Create verification (REST API) |
| `GET /api/verification?id=...` | Bearer token | Get status + full results |
| `POST /create-verification` | `X-API-Key` | Create verification (integration key) |
| `GET /get-verification-result?id=...` | Public | Poll status + safe outcome fields |
| `GET /get-template-config?template_id=...` | `X-API-Key` | Fetch `integration_config` from a template |
| `PATCH /api/templates/:id` | Bearer token | Update template fields including `integration_config` |
| `POST /bc-metafields` | Public (passes storeAccessToken in body) | BC metafields proxy — read/write cart or customer metafields |
| `POST /retry-webhook` | Bearer token | Retry a failed webhook delivery |
| `POST /purge-pii` | Bearer token | Delete stored PII and face images |
