# Upstream API: Ad-Hoc Verify

`INTEGRATION.md` at the repo root is the **source of truth** for the upstream API. This file is a map of what _this repo_ uses and the gotchas. Base URL default: `https://verify-api.ad-hoc.app` (override with `apiBase` in the storefront config / `ADHOC_API_BASE` on the server).

The platform itself is developed in a different repo (`micah1701/verify`). If an endpoint here seems wrong, check that repo's `.ai/backend/rest-api.md` and `.ai/backend/edge-functions.md` rather than guessing.

## Two auth modes

|                       | Integration Key                                                      | REST API (Bearer)                              |
| --------------------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| Header                | `X-API-Key: ahv_pub_…`                                               | `Authorization: Bearer <token>`                |
| Where                 | Browser / storefront                                                 | Server or merchant-authenticated admin session |
| Restricted by         | Domain allowlist (Profile in dashboard) — unlisted origins get `403` | Email + password login                         |
| Can read full results | No                                                                   | Yes                                            |

## Endpoints used by this repo

| Endpoint                                | Auth                    | Used by                                | Purpose                                                                                                                                                                                              |
| --------------------------------------- | ----------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /create-verification`             | Integration Key         | storefront                             | Create a verification (`{template_id?}`) → `{id, url, created_at}`                                                                                                                                   |
| `GET /get-verification-result?id=`      | none                    | storefront modal polling, admin detail | `{status, result?, completed_at?}`; `result` is `VerificationOutcome` (safe fields only)                                                                                                             |
| `GET /get-template-config?template_id=` | Integration Key         | storefront boot, admin                 | Returns the template's `integration_config`                                                                                                                                                          |
| `PATCH /api/templates/:id`              | Bearer                  | admin Integration Config tab           | Body `{integration_config: {...}}`                                                                                                                                                                   |
| `POST /api/auth`                        | —                       | admin                                  | `{email,password}` → `{access_token, refresh_token?, expires_in}`                                                                                                                                    |
| `POST /api/auth/refresh`                | —                       | admin                                  | `{refresh_token}` → new tokens                                                                                                                                                                       |
| `POST /bc-metafields`                   | none (BC token in body) | storefront                             | BC metafield proxy — **this repo owns it** (`supabase/functions/bc-metafields/`), BigCommerce-specific, see [`../integrations/bigcommerce/metafields.md`](../integrations/bigcommerce/metafields.md) |

Verification URL shown to shoppers: `${verifyBase}/verify/${id}` (default `verifyBase = https://adhocverify.com`). The end-user page posts `{type:'adhoc-verify-complete', verificationId}` to its parent window when finished.

## Status values (poll result)

`pending → started → completed | manual_review | expired`. The storefront modal polls every 3 s and also listens for the `postMessage` (origin-checked). The storefront sends `external_id` (`bigcommerce_user_<id>` / `bigcommerce_cart_<id>`) on `/create-verification`; **adhocverify.com must accept and store it** (not yet confirmed) and the hosted page must post `adhoc-verify-complete` to its parent when completed on another device. `expired` just stops polling.

## `face_match_score`

`definite_match`, `likely_match`, `possible_match`, `no_match`. Ordered strongest→weakest; the rule `minFaceMatchScore` rejects anything _weaker_ than the minimum.

## Other facts worth knowing

- `blockchain_name` in the outcome is the name hash used by the name-match feature (`SHA1:<hex>`).
- Rate limits and error format are in `INTEGRATION.md` (`{ "error": "..." }` JSON).
- Allowed domains must include the merchant's storefront origin (e.g. `store.mybigcommerce.com` **and** any custom domain), or `create-verification` returns 403 and the widget shows "Unable to start verification".
- Postman collections for all of this: `postman/` (see `postman/README.md`).
