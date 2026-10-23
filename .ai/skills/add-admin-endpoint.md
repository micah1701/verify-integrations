# Skill: Add an Admin Proxy Endpoint + SPA Consumer (BigCommerce)

Use when the admin SPA needs more BC Management API data (server holds the OAuth token).

## 1. Server handler — `server/bigcommerce/proxy.ts` (or a new file for a new concern)

```ts
export const handleThingList: RequestHandler = async (req, res) => {
  const tokenResult = resolveToken(req.query.storeHash);
  if ('error' in tokenResult) { res.status(tokenResult.status).json({ error: tokenResult.error }); return; }
  const storeHash = (req.query.storeHash as string).trim();
  const data = await bcFetch<…>(storeHash, tokenResult.accessToken, '/v3/things?…');
  if (!data) { res.status(502).json({ error: 'Failed to fetch things from BigCommerce' }); return; }
  res.json(data);
};
```

- Use `bcFetch` (returns `null` on failure/empty body). Clamp `page`/`limit` like existing handlers (limit ≤ 50).
- Prefer `Promise.all` for independent BC calls; be careful with N+1 fan-out (BC rate limits).
- Keep local type copies in this file (server can't import `src/`).
- **Add authentication** if you can (session token from `/load`) — the existing routes rely only on `storeHash`; don't make that worse by exposing more sensitive data. See [`known-issues.md`](../global/known-issues.md#admin-proxy-routes-are-unauthenticated).

## 2. Route
`server/bigcommerce/router.ts`: `bigcommerceRouter.get('/api/things', handleThingList);` — before the `/admin` static/fallback lines.

## 3. Shared response types
Add `Thing`, `EnrichedThing`, `ThingsResponse` to `src/core/types.ts`.

## 4. Client wrapper
`src/bigcommerce/admin/api/bc-proxy.ts`: `fetchThingsList(storeHash, page, limit)` via `proxyGet<T>()`; encode query values with `encodeURIComponent`.

## 5. Page
Add to an existing page or create `pages/ThingsPage.tsx` (BigDesign components, `config: AdHocAdminConfig` prop, `cancelled` flag in effects) and register a tab in `App.tsx` (`TabId` union + `TABS` + conditional render).

## 6. Scopes
If the endpoint needs a new OAuth scope, update the registered app in the BC Developer Portal and note that existing installs must re-authorize. Document in [`overview.md`](../integrations/bigcommerce/overview.md#bc-oauth-scopes).

## 7. Verify
`npm run build:server && npm run build:admin`; add a request to `postman/Verify Integrations Server.postman_collection.json`; test via a signed `/load` page.
