import type { RequestHandler, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getToken } from '../core/db';
import { renderError } from './render-error';
import { mintSessionToken, storeHashFromClaims, verifyBcJwt } from './bc-jwt';

const ADMIN_HTML_PATH = path.resolve('dist/admin/index.html');
const ENTITIES = new Set(['orders', 'customers', 'products']);
const EXT_URL_RE = /\/ext\/(orders|customers|products)\/(\d+)(?:[/?#]|$)/;

/**
 * Extracts the extension target from the signed `url` claim, e.g. "/bigcommerce/ext/orders/106".
 * BC delivers extension clicks to the app's Load callback with the resolved extension path in
 * this claim, so /load uses this to decide between the main SPA and a record panel.
 */
export function parseExtensionUrl(url: string | undefined): { entity: string; id: number } | null {
  const m = url ? EXT_URL_RE.exec(url) : null;
  return m ? { entity: m[1], id: Number(m[2]) } : null;
}

/** Serves the admin SPA in panel mode (no OAuth token injected; panel gets a record-bound session). */
export function sendExtensionPanel(res: Response, entity: string, id: number, storeHash: string): void {
  if (!getToken(storeHash)) {
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

  const config = {
    entity,
    id,
    storeHash,
    sessionToken: mintSessionToken({ storeHash, entity, id }),
  };
  const injected = `<script>window.AdHocExtensionConfig = ${JSON.stringify(config)};</script>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.bigcommerce.com https://*.mybigcommerce.com");
  res.send(html.replace('</head>', `${injected}\n</head>`));
}

/**
 * GET /bigcommerce/ext/:entity/:id — direct panel URL (fallback if BC calls the extension path
 * itself rather than the Load callback). Verifies BC's signed_payload_jwt first.
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
  if (!storeHash) {
    res.status(400).send(renderError('Invalid Token', 'Could not extract store identifier from token.'));
    return;
  }
  sendExtensionPanel(res, entity, Number(id), storeHash);
};
