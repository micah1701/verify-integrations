# Ad-Hoc Verify — Integration Platform

A multi-integration identity verification platform. Merchants install this to require customers to verify their identity (driver's license + liveness selfie) before completing a purchase. BigCommerce is the first supported platform; the backend is structured to add others (Shopify, WooCommerce, etc.) without restructuring.

---

## How It Works

1. A merchant registers the app in the BigCommerce Developer Portal and installs it on their store
2. The Node.js backend receives the OAuth callback, exchanges the code for an access token, and stores it
3. When the merchant opens the app from their BC admin panel, the server verifies the BC-signed JWT, looks up the stored token, and serves the admin SPA with the store credentials injected
4. The merchant uses the **Integration Config** tab in the admin SPA to store their BC credentials and verification settings in the Ad-Hoc Verify template (`integration_config`)
5. The merchant adds the storefront script to their store via BC Script Manager — a self-contained IIFE that only needs `integrationKey` + `templateId`; all other config is fetched from the template at runtime
6. Customers trigger a verification flow via a modal on the cart/checkout page; results are stored in BC metafields

---

## Project Structure

```
src/
├── core/                    # Platform-agnostic frontend logic
│   ├── types.ts             # Shared TypeScript interfaces
│   ├── verify-api.ts        # Ad-Hoc Verify REST + BC metafield proxy calls
│   ├── verification-state.ts  # Ruleset evaluation
│   └── cache.ts             # IndexedDB cache with TTL
└── bigcommerce/
    ├── storefront/          # Customer-facing UI (Svelte → single IIFE bundle)
    │   ├── entry.ts         # Reads window.AdHocVerifyConfig, mounts UI, drives flow
    │   ├── bc-adapter.ts    # BC Storefront API (cart, customer JWT, metafields)
    │   ├── checkout-block.ts  # Checkout button enforcement via MutationObserver
    │   └── components/
    │       ├── StatusCard.svelte  # "Verified" badge or "Verify ID" button
    │       └── VerifyModal.svelte # Iframe modal + polling
    └── admin/               # Store staff dashboard (React + BigDesign)
        ├── App.tsx          # Tabbed layout — reads window.AdHocAdminConfig
        └── pages/
            ├── CustomerVerificationPage.tsx
            ├── OrderVerificationPage.tsx
            └── IntegrationConfigPage.tsx

server/                      # Node.js/Express backend
├── index.ts                 # Entry point
├── core/
│   ├── app.ts               # Express setup, mounts integration routers
│   ├── db.ts                # JSON file token store (upsertToken / getToken / deleteToken)
│   └── middleware/
│       └── error-handler.ts
└── bigcommerce/
    ├── router.ts            # Mounts BC routes + serves admin SPA at /bigcommerce/admin/
    ├── auth.ts              # GET /bigcommerce/auth  — OAuth install
    ├── load.ts              # GET /bigcommerce/load  — serves admin SPA with injected config
    ├── uninstall.ts         # GET /bigcommerce/uninstall
    └── render-error.ts      # HTML error pages for BC iframe display

dist/
├── storefront/bigcommerce.js  # CDN-hosted IIFE, added to Script Manager
├── admin/                     # React SPA, served by the backend
└── server/                    # Compiled backend (tsc output)

data/
└── tokens.json              # Runtime OAuth token store (gitignored, created automatically)
```

---

## Developer Setup

### Prerequisites

- Node.js 18+
- An [Ad-Hoc Verify](https://verify.ad-hoc.app) account with an active integration
- A BigCommerce store or sandbox for testing
- A public URL for the server during development — use [ngrok](https://ngrok.com) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) to expose localhost

### Install

```bash
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Where to get it |
|---|---|
| `BC_CLIENT_ID` | BigCommerce Developer Portal → your app |
| `BC_CLIENT_SECRET` | BigCommerce Developer Portal → your app |
| `APP_BASE_URL` | Your server's public URL (ngrok URL for local dev) |
| `ADHOC_API_BASE` | `https://verify-api.ad-hoc.app` (default) |

### Build & Run

```bash
# Build the admin SPA (required before starting the server)
npm run build:admin

# Start the server with hot reload
npm run dev:server
# → http://localhost:3033

# In a separate terminal, rebuild the admin SPA if you change frontend code
npm run dev:admin   # standalone Vite dev server for admin (no OAuth, no config injection)
```

### Production Build

```bash
npm run build          # storefront + admin
npm run build:server   # TypeScript → dist/server/
npm start              # register & start with pm2 (first-time only — see below)
```

---

## Production Deployment

The server runs on Node.js managed by **pm2**, behind **Apache** as an HTTPS reverse proxy.

**Production URL:** `https://verify-integrations.ad-hoc.app` (port 3033 internally)

### Prerequisites

```bash
# Apache modules
sudo a2enmod proxy proxy_http rewrite headers ssl

# pm2 globally
npm install -g pm2
```

### First-Time Setup

```bash
# 1. Clone, install, and configure
cd /var/www/verify-integrations.ad-hoc.app
git clone <repo-url> .
npm install
cp .env.example .env && nano .env   # fill in all required values, PORT=3033

# 2. Build everything
npm run build:storefront
npm run build:admin
npm run build:server

# 3. Start with pm2 and persist the process list
npm start          # registers as "verify-integrations" and starts
pm2 save           # persist so the process survives reboots
pm2 startup        # follow the printed command to enable pm2 on system boot
```

### Apache Virtual Host

Create `/etc/apache2/sites-available/verify-integrations.ad-hoc.app.conf`:

```apache
<VirtualHost *:80>
    ServerName verify-integrations.ad-hoc.app
    RewriteEngine on
    RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</VirtualHost>

<VirtualHost *:443>
    ServerName verify-integrations.ad-hoc.app

    SSLCertificateFile /etc/letsencrypt/live/verify-integrations.ad-hoc.app/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/verify-integrations.ad-hoc.app/privkey.pem
    Include /etc/letsencrypt/options-ssl-apache.conf

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3033/
    ProxyPassReverse / http://127.0.0.1:3033/

    Header always set X-Content-Type-Options nosniff
</VirtualHost>
```

> **No DocumentRoot.** All requests — including the admin SPA — must route through Node. Serving `dist/admin/index.html` directly from Apache would bypass the `/bigcommerce/load` handler that injects `window.AdHocAdminConfig` at request time, breaking the admin dashboard.

Enable and reload:

```bash
sudo a2ensite verify-integrations.ad-hoc.app.conf
sudo systemctl reload apache2
```

### SSL Certificate (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-apache
sudo certbot --apache -d verify-integrations.ad-hoc.app
```

### Deploying Changes

After pulling updated source to the server:

```bash
npm run rebuild
# Runs: build:storefront + build:admin + build:server, then pm2 reload (zero-downtime)
```

### pm2 Reference

```bash
pm2 list                          # show all processes and status
npm run logs                      # tail logs for this app
pm2 monit                         # live CPU/memory dashboard
npm run restart                   # hard restart
npm run stop                      # stop without removing from pm2
pm2 delete verify-integrations    # remove from pm2 process list entirely
```

---

## Registering the App in BigCommerce

1. Log in to the [BigCommerce Developer Portal](https://devtools.bigcommerce.com)
2. Click **Create an App**
3. Fill in:
   - **App Name** — Ad-Hoc Verify
   - **App URL** — `https://<your-server>/bigcommerce/admin/`
   - **Auth Callback URL** — `https://<your-server>/bigcommerce/auth`
   - **Load Callback URL** — `https://<your-server>/bigcommerce/load`
   - **Uninstall Callback URL** — `https://<your-server>/bigcommerce/uninstall`
4. Under **OAuth Scopes**, request at minimum:
   - `Customers` — Read-Only
   - `Orders` — Read-Only
5. Save and copy the **Client ID** and **Client Secret** into your `.env`

---

## Store Owner — Installing and Configuring the App

### Step 1 — Install the App

Click the installation link (or find it in the BC App Marketplace). Authorize the requested permissions. The backend handles the OAuth handshake automatically.

### Step 2 — Set Up an Ad-Hoc Verify Integration Key and Template

1. Sign up at [Ad-Hoc Verify](https://verify.ad-hoc.app)
2. Create an integration and copy your **Integration Key** (`ahv_pub_...`)
3. Add your store's domain to the Integration Key allowlist (e.g., `yourstore.mybigcommerce.com`)
4. Create a **verification template** in the dashboard and note its UUID

### Step 3 — Configure the Template via the Admin Panel

Open the BC admin panel → **Apps → Ad-Hoc Verify → Integration Config** tab.

1. Enter your **Integration Key** and **Template ID**, then click **Load Config**
2. Click **Edit** (you'll be prompted for your Ad-Hoc Verify account credentials)
3. Fill in your store details:
   - **Store Hash** — the short alphanumeric code from your BC store URL
   - **Store Access Token** — from a BC store-level API account (**Settings → Store-level API accounts**; required scopes: **Carts** read/write, **Customers** read/write)
   - **Pages** — which pages to show the verification UI on (`cart`, `checkout`, `order-confirmation`)
   - **Ruleset** — verification pass/fail thresholds
4. Click **Save**

### Step 4 — Add the Storefront Script via Script Manager

In the BigCommerce admin: **Storefront → Script Manager → Create a Script**

- **Location on page** — Footer
- **Pages** — All Pages
- **Script type** — Script

Paste the following, replacing the placeholder values:

```html
<script>
  window.AdHocVerifyConfig = {
    integrationKey: "ahv_pub_...",
    templateId:     "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  };
</script>
<script src="https://verify-integrations.ad-hoc.app/storefront/bigcommerce.js"></script>
```

That's all that's needed in the script tag. The plugin fetches everything else (store credentials, pages, ruleset, etc.) from the template at runtime.

### Step 5 — Test

1. Add an item to cart and go to checkout
2. The checkout button should be replaced or blocked by a "Verify ID" prompt (if `ruleset.requireVerification` is set in your template config)
3. Complete a test verification — the modal should open, run the flow, then close and restore checkout
4. Open the admin dashboard (**Apps → Ad-Hoc Verify**) to look up the verification result by customer or order ID

---

## Hosting the Storefront Bundle

The storefront plugin (`dist/storefront/bigcommerce.js`) is a static file — upload it to any CDN (Cloudflare R2, S3, Vercel Blob) and use the public URL in the Script Manager snippet. Redeploy when the file changes; no merchant-side update needed as long as the URL stays the same.

---

## Configuration Reference

All options are set via `window.AdHocVerifyConfig` in the Script Manager snippet. When `templateId` is provided, the plugin fetches the template's `integration_config` from the Ad-Hoc Verify API at boot and uses those values as defaults — anything set in the script tag takes precedence.

The recommended approach is to keep the script tag minimal and manage all store-specific settings through the **Integration Config** tab in the admin panel.

| Option | Type | Default | Description |
|---|---|---|---|
| `integrationKey` | `string` | **Required** | Ad-Hoc Verify integration key (`ahv_pub_...`) |
| `templateId` | `string` | Recommended | Template UUID — all other config is fetched from this template's `integration_config` |
| `storeHash` | `string` | From template | BC store hash — set via Integration Config tab, not the script tag |
| `storeAccessToken` | `string` | From template | BC store-level API access token — set via Integration Config tab |
| `pages` | `string[]` | From template | Pages to activate: `'cart'`, `'checkout'`, `'order-confirmation'` |
| `ruleset.requireVerification` | `boolean` | `true` | Disable checkout until verified |
| `ruleset.minFaceMatchScore` | `string\|null` | `null` | Minimum face match tier: `'definite_match'`, `'likely_match'`, `'possible_match'` |
| `ruleset.requireOver18` | `boolean` | `false` | Fail if `over_18` is false |
| `ruleset.requireOver21` | `boolean` | `false` | Fail if `over_21` is false |
| `manualReview.blockCheckout` | `boolean` | `false` | Block checkout during manual review |
| `manualReview.message` | `string\|null` | Default message | Message shown during manual review; `null` hides it |
| `buttonText` | `string` | `'Verify ID'` | Verify button label |
| `selector` | `string` | `'.cart-actions'` | CSS selector for the UI injection point |
| `onComplete` | `function(id)` | — | Callback with verification ID on completion |
| `onResult` | `function(result)` | — | Callback with `{ verificationId, success, over_18, over_21, face_match_score }` |

---

## Adding a New Integration

The backend is structured so new platforms slot in without touching existing code:

1. Create `server/<platform>/router.ts` with an Express `Router` and handlers for `auth`, `load`, `uninstall`
2. Create `server/<platform>/render-error.ts` (or import the shared one if error style is the same)
3. Add `app.use('/<platform>', platformRouter)` in `server/core/app.ts`
4. Add platform-specific env vars to `.env.example`
5. Create the corresponding frontend artifacts under `src/<platform>/`

---

## Reference Docs

- [INTEGRATION.md](INTEGRATION.md) — Ad-Hoc Verify API reference (endpoints, auth, metafield proxy, webhooks)
- [RESOURCES.md](RESOURCES.md) — BigCommerce developer documentation links
