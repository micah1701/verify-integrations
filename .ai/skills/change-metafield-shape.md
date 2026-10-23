# Skill: Change the Stored Metafield Shape (BigCommerce)

The `Ad-Hoc Verify`/`verification` metafield is read and written in several places and **already exists on merchants' carts, customers and orders**. Treat the shape as a public, versionless contract: additive changes only unless you also handle old values.

## Places that must agree

1. `MetafieldValue` / `VerificationOutcome` — `src/core/types.ts`
2. Writer — `buildMetafieldPayload()` in `src/core/verify-api.ts`
3. Reader/evaluator — `evaluateVerificationState()` / `resolveOverallState()` in `src/core/verification-state.ts`
4. **Server copy** — local types + `evaluateVerificationState` + `parseVerifyMetafield` in `server/bigcommerce/proxy.ts` (can't import `src/`)
5. Admin display — `MetafieldTable` in `CustomersPage.tsx` and `OrdersPage.tsx`
6. Carry-over code in `entry.ts` that rebuilds an "empty" outcome: `{ success: null, over_18: null, over_21: null, face_match_score: null }` (3 places) — add new fields there too
7. Docs — [`metafields.md`](../integrations/bigcommerce/metafields.md), `INTEGRATION.md`

## Rules
- Make new fields optional and tolerate their absence when reading old metafields.
- Never change `namespace`/`key`/`permission_set` — it would orphan existing data and break the shared-credential read (see metafields.md).
- No PII, no images. Only values safe for the browser and visible to anyone with storefront-API metafield read.
- If the Ad-Hoc Verify result (`get-verification-result`) must supply the new field, check the upstream repo first.
- After changing the writer, remember `invalidateMetafieldCache()` semantics don't change; old cached values expire in ≤ 5 min.

## Verify
Build everything; verify an old-shaped metafield still renders in the admin and resolves in the storefront; verify a new write round-trips through `bc-metafields` (redeploy it only if its request contract changed — see [`deploy.md`](deploy.md)).
