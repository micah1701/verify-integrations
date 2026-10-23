# BigCommerce — Admin SPA (`src/bigcommerce/admin/`)

React 18 + BigDesign, built by `vite.admin.config.ts` (`base: '/bigcommerce/admin/'`, output `dist/admin`, stable filenames `assets/index.js`). Shown inside the BC control-panel iframe after `/bigcommerce/load` serves it with config injected.

## Files

| File | Role |
|---|---|
| `index.html` (repo root) | Shell; mounts `#root`, loads `/src/bigcommerce/admin/index.tsx` |
| `index.tsx` | `ReactDOM.createRoot(...).render(<App/>)` in `StrictMode` |
| `App.tsx` | `ThemeProvider` + `GlobalStyles` + BigDesign `Tabs`: **Customers**, **Orders**, **Integration Config**. Reads `window.AdHocAdminConfig` (fallback for standalone dev: `{apiBase: 'https://verify-api.ad-hoc.app', storeHash:'', storeAccessToken:''}`) and passes it as `config` prop. |
| `api/bc-proxy.ts` | `fetchCustomersList`, `fetchCustomerDetail`, `fetchOrdersList`, `fetchOrderDetail` → same-origin `/bigcommerce/api/...?storeHash=…`. Return `null` on any failure. |
| `pages/CustomersPage.tsx` | Paginated list (25/50…) + search by customer ID → detail with verification metafield table, state badge, **Name Match** (recomputes `computeNameHash(customer first, last, verificationId)` and compares with `blockchain_name`, fetching it via `getVerificationResult` if absent from the metafield) |
| `pages/OrdersPage.tsx` | Paginated list + find by order ID → order, linked customer, verification status; shows `metafieldSource` |
| `pages/IntegrationConfigPage.tsx` | Load/edit the template's `integration_config` (below) |

`VerificationState` → badge: verified=success, invalid=danger, incomplete=warning, unverified=secondary, pending_review=warning.

## Integration Config tab

Purpose: let the merchant set the storefront config stored on the Ad-Hoc Verify template.

Flow:
1. Merchant enters **Integration Key** and **Template ID** (persisted in `localStorage`: `ahv_integration_key`, `ahv_template_id`).
2. **Load Config** → `getTemplateIntegrationConfig()` (Integration Key auth). Error mapping: 401 key invalid/revoked; 404 template not found; other ⇒ HTTP code + server error; `null` ⇒ network error.
3. Read-only table of current values (Store Access Token masked as `••••••••`).
4. **Edit** → needs an Ad-Hoc Verify Bearer token: `getOrRefreshToken()` uses `sessionStorage` (`ahv_bearer`, `ahv_bearer_exp`, `ahv_bearer_refresh`), refreshes with the refresh token, otherwise opens a login modal (`loginToAdhocApi`, email + password).
5. **Save** → `updateTemplateIntegrationConfig()` (`PATCH /api/templates/:id`); `unauthorized` ⇒ clear tokens, re-prompt login.

Editable groups: Store Hash, Store Access Token; Trigger rule (mode + product IDs, comma-separated); Checkout enforcement (mode + warning message when `warn`); Ruleset (`requireVerification`, `minFaceMatchScore`, `requireOver18`, `requireOver21`, `requireNameMatch`); Manual review (`blockCheckout`, `message`); Button text; CSS selector. **No `pages` field** (it's script-tag-only).

Form defaults when the draft is empty: ruleset `{requireVerification:true, minFaceMatchScore:null, requireOver18:false, requireOver21:false}`, `checkoutEnforcement {mode:'block'}`, `triggerRule {mode:'always'}`, `manualReview {blockCheckout:false, message:null}`.

> A new `IntegrationConfig` field needs changes in **four** places: type, `sanitizeIntegrationConfig`, this page (display + edit), and `applyRemoteConfig` in `entry.ts`. See [`../../skills/add-config-option.md`](../../skills/add-config-option.md).

## Auth/credential notes
- The page uses `config.storeHash` for proxy calls; `config.storeAccessToken` (OAuth) is not used by the SPA.
- The Bearer token is session-scoped only; never persist it to `localStorage`.
- The Integration Key/Template ID in `localStorage` are convenience values and not secrets.

## Dev
`npm run dev:admin` runs Vite standalone (no OAuth, no injected config → `storeHash` empty, so proxy calls fail). For realistic testing use `npm run build:admin` + `npm run dev:server` and open the app via a signed `/load` URL (Postman README explains how to mint a test JWT).

## UI conventions
- BigDesign components only (`Panel`, `Table`, `Badge`, `Form`, `Select`, `Modal`, `OffsetPagination`, `InlineMessage`, `ProgressCircle`…).
- Loading/error states are local `useState`; async effects guard with a `cancelled` flag.
- Dates formatted with `toLocaleDateString`.
