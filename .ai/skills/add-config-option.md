# Skill: Add a Storefront / Template Config Option (BigCommerce)

Example: a new `IntegrationConfig.fooLabel?: string` that merchants set in the admin and the storefront honours.

## Checklist (all must change together)

1. **Type** — `src/core/types.ts`: add to `IntegrationConfig` and (if it can also be set in the script tag) `AdHocVerifyConfig`.
2. **Default** — `defaults` in `src/bigcommerce/storefront/entry.ts` (if it needs one).
3. **Remote apply** — `applyRemoteConfig()` in `entry.ts`: `if (!userConfig.fooLabel && remote.fooLabel) { config.fooLabel = remote.fooLabel; log(...) }`. Keep the "script tag wins" rule. If it's an object, decide whether to deep-merge with defaults like `ruleset`/`manualReview`.
   - If the option must take effect **before** async fetch completes (like `pages`), it cannot be remote — keep it script-tag-only.
4. **Use it** — in `entry.ts` / `checkout-block.ts` / Svelte components. Pass values into components via props; no globals.
5. **Sanitizer** — `sanitizeIntegrationConfig()` in `src/core/verify-api.ts`: add the key to the destructure and the output, or it will **silently not save**.
6. **Admin UI** — `src/bigcommerce/admin/pages/IntegrationConfigPage.tsx`: add to the read-only display rows *and* the edit form (`updateDraft({ fooLabel })`).
7. **Docs** — update [`../integrations/bigcommerce/config-reference.md`](../integrations/bigcommerce/config-reference.md) (table + sanitizer list) and `README.md`/`INTEGRATION.md` option tables.
8. **Upstream** — the Ad-Hoc Verify platform stores `integration_config` as JSONB; confirm `PATCH /api/templates/:id` and `GET /get-template-config` pass unknown keys through (otherwise change `micah1701/verify`).

## Gotchas
- `Ruleset` changes also touch `evaluateVerificationState` in `src/core/verification-state.ts` **and** the server copy in `server/bigcommerce/proxy.ts` (known duplication).
- Anything affecting what is blocked at checkout must go through `getEffectiveEnforcement()` / `renderCheckoutBlock()` so the legacy `requireVerification` fallback keeps working.
- Rebuild the storefront (`npm run build:storefront`) and purge Cloudflare after deploying.

## Verify
`npm run build`; load a test store with `logging: true`; confirm the log line `foo ← remote` appears and a script-tag override beats it.
