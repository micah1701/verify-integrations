# BigCommerce — Config Reference

Two shapes, one merge:
- `AdHocVerifyConfig` — `window.AdHocVerifyConfig` in the script tag (type in `src/core/types.ts`).
- `IntegrationConfig` — JSON on the Ad-Hoc Verify template (`verification_templates.integration_config`).

**Precedence (per key):** script tag > remote template config > built-in defaults. `pages` is script tag > default only.

## Options

| Option | Type | Default | Remote? | Notes |
|---|---|---|---|---|
| `integrationKey` | string | — **required** | no | `ahv_pub_…`; without it the plugin logs an error and stops |
| `templateId` | UUID | — | no | Enables remote config fetch; also sent as `template_id` on `create-verification` |
| `apiBase` | URL | `https://verify-api.ad-hoc.app` | no | |
| `verifyBase` | URL | `https://verify.ad-hoc.app` | no | Modal iframe origin: `${verifyBase}/verify/${id}` |
| `storeHash` | string | — | **yes** | Needed for any metafield read/write |
| `storeAccessToken` | string | — | **yes** | Store-level API account token (Carts + Customers read/write) |
| `pages` | `('cart'\|'checkout'\|'order-confirmation')[]` | `['cart','checkout']` | **no** | Evaluated synchronously at load. Order confirmation is processed regardless. |
| `ruleset.requireVerification` | bool | `true` | yes | Legacy: used only when `checkoutEnforcement.mode` is unset (`true`⇒block, `false`⇒none) |
| `ruleset.minFaceMatchScore` | `FaceMatchScore \| null` | `null` | yes | Weaker score ⇒ `invalid` |
| `ruleset.requireOver18` / `requireOver21` | bool | `false` | yes | |
| `ruleset.requireNameMatch` | bool | `false` | yes | Shipping name must match license; checkout only |
| `manualReview.blockCheckout` | bool | `false` | yes | Block checkout while `pending_review` |
| `manualReview.message` | string \| null \| false | built-in text | yes | `null`/`false`/`''` hides it |
| `triggerRule` | `{mode:'always'\|'exclude_products'\|'only_products', productIds?:number[]}` | `{mode:'always'}` | yes | Controls whether the widget shows for this cart |
| `checkoutEnforcement` | `{mode:'block'\|'warn'\|'none', warningMessage?:string\|null}` | derived from `ruleset.requireVerification` | yes | |
| `buttonText` | string | `Verify ID` | yes | |
| `selector` | CSS selector | `.cart-actions` | yes | Cart-page fallback insertion point (region `cart_below_totals` is tried first) |
| `logging` | bool | `false` | no | `[AD-HOC VERIFY]` console diagnostics |
| `onComplete(id)` | fn | — | no | After a completed verification is saved |
| `onResult({verificationId, success, over_18, over_21, face_match_score})` | fn | — | no | |

`sanitizeIntegrationConfig()` (whitelist used on save) currently allows: `storeHash, storeAccessToken, pages, ruleset, manualReview, buttonText, selector, triggerRule, checkoutEnforcement`.

## Defaults in code (`entry.ts`)

```ts
apiBase 'https://verify-api.ad-hoc.app'; verifyBase 'https://verify.ad-hoc.app'; buttonText 'Verify ID'; selector '.cart-actions';
pages ['cart','checkout'];
ruleset { requireVerification: true, minFaceMatchScore: null, requireOver18: false, requireOver21: false };
manualReview { blockCheckout: false, message: 'Your verification is pending a manual review. You may continue to place your order, but there may be a delay in processing while we confirm your verification.' };
triggerRule { mode: 'always' };
DEFAULT_WARN_MESSAGE = 'Your order may incur shipping delays or be cancelled until your identity can be verified.';
DEFAULT_NAME_NOTICE  = "Important: The first and last name you enter here must exactly match the name on the driver's license used to verify your identity.";
```

## Typical minimal snippet

```html
<script>
  window.AdHocVerifyConfig = { integrationKey: 'ahv_pub_…', templateId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' };
</script>
<script src="https://verify-integrations.ad-hoc.app/bigcommerce/storefront/bigcommerce.js"></script>
```

For development, add `logging: true` and override anything locally (script-tag values beat the template).

## Server/admin config

`AdHocAdminConfig = { apiBase, storeHash, storeAccessToken }` injected by `/load` (see [`server.md`](server.md)). Env vars: [`../../global/deployment.md`](../../global/deployment.md#environment-variables-env-see-envexample).
