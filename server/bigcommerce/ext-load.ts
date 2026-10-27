import type { RequestHandler } from 'express';
import fs from 'fs';
import path from 'path';
import { getToken } from '../core/db';
import { renderError } from './render-error';
import { mintSessionToken, storeHashFromClaims, verifyBcJwt } from './bc-jwt';

const ADMIN_HTML_PATH = path.resolve('dist/admin/index.html');
const ENTITIES = new Set(['orders', 'customers', 'products']);

/**
 * GET /bigcommerce/ext/:entity/:id — App Extension PANEL iframe.
 * Verifies BC's signed_payload_jwt, then serves the admin SPA with panel config injected.
 */
export const handleExtensionLoad: RequestHandler = (req, res) => {
  const { entity, id } = req.params;
  const { signed_payload_jwt } = req.query as Record<string, string>;

  if (!ENTITIES.has(entity) || !/^\d+$/.test(id)) {
    res.status(404).send(renderError('Not Found', 'Unknown extension target.'));
    return;
  }
  if (!signed_payload_jwt) {
    res.status(400).send(renderError('Missing Payload', 'No signed_payload_jwt parameter provided.'));
    return;
  }

  let claims;
  try {
    claims = verifyBcJwt(signed_payload_jwt);
  } catch (err) {
    console.warn('[ext-load] JWT verification failed:', err);
    res.status(401).send(renderError('Authentication Failed', 'Invalid or expired session. Please reopen this panel from BigCommerce.'));
    return;
  }

  // The signed `url` claim must point at the entity being requested, so a token
  // issued for one record cannot be replayed against another.
  if (claims.url && !claims.url.split('?')[0].endsWith(`/ext/${entity}/${id}`)) {
    res.status(401).send(renderError('Authentication Failed', 'Token does not match the requested record.'));
    return;
  }

  const storeHash = storeHashFromClaims(claims);
  if (!storeHash || !getToken(storeHash)) {
    res.status(404).send(renderError('Store Not Found', 'This store has not completed the installation. Please reinstall the app.'));
    return;
  }

  let html: string;
  try {
    html = fs.readFileSync(ADMIN_HTML_PATH, 'utf-8');
  } catch {
    res.status(500).send(renderError('Build Missing', 'Admin panel assets are not built. Run npm run build:admin.'));
    return;
  }

  // No OAuth token is injected — panels call /bigcommerce/api/ext/* with this session token.
  const config = {
    entity,
    id: Number(id),
    storeHash,
    sessionToken: mintSessionToken(storeHash),
  };
  const injected = `<script>window.AdHocExtensionConfig = ${JSON.stringify(config)};</script>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.bigcommerce.com https://*.mybigcommerce.com");
  res.send(html.replace('</head>', `${injected}\n</head>`));
};
