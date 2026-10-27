# Project Overview

## What This Is

A multi-integration identity verification platform built on the **Ad-Hoc Verify** service (`https://adhocverify.com`, API at `https://verify-api.ad-hoc.app`). It lets e-commerce merchants require customers to verify their identity (driver's license + liveness selfie) before completing checkout.

**BigCommerce is the only integration today.** The architecture is deliberately split so that Shopify, WooCommerce, etc. can be added without restructuring — see [`../integrations/README.md`](../integrations/README.md).

The server is deployed at `https://verify-integrations.ad-hoc.app`.

---

## Audiences

| Who                        | Touches                                                                                   | Entry point                     |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------- |
| **Merchant / store staff** | The admin SPA inside the platform's control panel (BC iframe); the Script Manager snippet | `/<platform>/load` → admin SPA  |
| **Shopper (end customer)** | The storefront widget on cart/checkout; the verification iframe from Ad-Hoc Verify        | `dist/storefront/<platform>.js` |
| **Developers / AI agents** | This repo                                                                                 | `.ai/README.md`                 |

The shopper never talks to this repo's server. Only the merchant admin does.

---

## Core Concepts (platform-agnostic)

- **Integration Key** (`ahv_pub_...`) — public, domain-allowlisted token issued by Ad-Hoc Verify. Goes in the storefront script tag. **Not** a platform OAuth credential — never confuse the two.
- **Template ID** — UUID of a saved verification template on Ad-Hoc Verify. With the Integration Key it forms the _minimal_ storefront config; everything else is fetched at runtime.
- **IntegrationConfig** — JSON stored in `verification_templates.integration_config` (JSONB) on Ad-Hoc Verify. Holds per-store settings (store credentials, ruleset, manual review, button text, selector, trigger rule, checkout enforcement). Fetched by the storefront via `GET /get-template-config`; edited via the admin SPA's _Integration Config_ tab. Type: `IntegrationConfig` in `src/core/types.ts`. Fields in [`../integrations/bigcommerce/config-reference.md`](../integrations/bigcommerce/config-reference.md).
- **Ruleset** — merchant thresholds: `requireVerification`, `minFaceMatchScore`, `requireOver18`, `requireOver21`, `requireNameMatch?`. Evaluated by `evaluateVerificationState()`.
- **VerificationOutcome** — safe result fields from Ad-Hoc Verify polling: `success`, `over_18`, `over_21`, `face_match_score`, `blockchain_name?`.
- **VerificationStatus** — `pending → started → completed | manual_review | expired` (from the upstream platform).
- **VerificationState** — _this repo's_ derived UI state: `verified | invalid | incomplete | unverified | pending_review`. Don't confuse with Status.
- **FaceMatchScore** — `definite_match > likely_match > possible_match > no_match` (ordered strongest to weakest in `SCORE_ORDER`).
- **Trigger rule** — which carts show the widget at all (`always | exclude_products | only_products | product_flag` + product IDs).
- **Checkout enforcement** — what happens at checkout when not verified (`block | warn | none`).
- **Name match** — optional: the shipping name must hash-match the name on the license (`requireNameMatch`; hash = `SHA1:` of normalised first+last+verificationId, compared with `blockchain_name`).

## Glossary of the three "state" words

| Word   | Values                                                         | Where                                               |
| ------ | -------------------------------------------------------------- | --------------------------------------------------- |
| status | `pending/started/completed/manual_review/expired`              | Ad-Hoc Verify API, stored in the metafield `status` |
| state  | `verified/invalid/incomplete/unverified/pending_review`        | Derived by `evaluateVerificationState()`            |
| source | `customer/cart/none` (or `order/customer/none` in admin lists) | Which metafield decided the state                   |

---

## Repository Map

```
c:\Projects\verify-integrations\
├── src/
│   ├── core/                        # Platform-agnostic frontend logic (shared by storefront + admin)
│   │   ├── types.ts                 # ALL shared TS interfaces
│   │   ├── verify-api.ts            # Ad-Hoc Verify REST + bc-metafields proxy client
│   │   ├── verification-state.ts    # evaluateVerificationState / resolveOverallState
│   │   └── cache.ts                 # IndexedDB TTL cache
│   └── bigcommerce/
│       ├── storefront/              # Svelte + TS → single IIFE (entry.ts, bc-adapter.ts, checkout-block.ts, logger.ts, components/)
│       └── admin/                   # React 18 + BigDesign (App.tsx, index.tsx, api/bc-proxy.ts, pages/)
├── server/                          # Node/Express backend (CommonJS build)
│   ├── index.ts                     # HTTP server + graceful shutdown
│   ├── core/                        # app.ts, db.ts (token store), middleware/error-handler.ts
│   └── bigcommerce/                 # router, auth, load, uninstall, proxy, render-error
├── supabase/functions/bc-metafields/index.ts   # Edge function (Deno) — deployed to the Ad-Hoc Verify Supabase project
├── postman/                         # Two collections + README (server & upstream API)
├── index.html                       # Admin SPA HTML shell (Vite entry)
├── vite.admin.config.ts / vite.storefront.config.ts
├── tsconfig.json (frontend, noEmit) / tsconfig.server.json (CJS → dist/server)
├── data/tokens.json                 # Runtime OAuth token store (gitignored contents)
├── INTEGRATION.md                   # Upstream Ad-Hoc Verify API reference (source of truth)
├── RESOURCES.md                     # BigCommerce developer doc links
├── README.md                        # Human setup / deployment guide
└── CLAUDE.md                        # Short AI entry point → points here
```

Build output (gitignored): `dist/server/`, `dist/storefront/bigcommerce.js`, `dist/admin/`.

---

## Scope

**In this repo:** OAuth install/uninstall, admin dashboard, Management-API read proxy for the admin, the storefront plugin, and one edge function (`bc-metafields`).

**Not in this repo:** the verification flow itself, face matching, templates, billing, webhooks — all of that is the Ad-Hoc Verify platform (`micah1701/verify`). Never reimplement it here; call its API.
