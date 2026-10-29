import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { getToken } from '../core/db';
import { renderError } from './render-error';
import { parseExtensionUrl, sendExtensionPanel } from './ext-load';

interface BCLoadClaims {
  sub: string; // "stores/HASH"
  iss: string;
  iat: number;
  exp: number;
  user: { id: number; email: string };
  url?: string; // "/" for a normal open; the resolved extension path for App Extension clicks
}

const ADMIN_HTML_PATH = path.resolve('dist/admin/index.html');

export const handleLoad: RequestHandler = (req, res) => {
  const { signed_payload_jwt } = req.query as Record<string, string>;

  if (!signed_payload_jwt) {
    res.status(400).send(renderError('Missing Payload', 'No signed_payload_jwt parameter provided.'));
    return;
  }

  const clientSecret = process.env.BC_CLIENT_SECRET;
  if (!clientSecret) {
    console.error('[load] BC_CLIENT_SECRET env var is not set');
    res.status(500).send(renderError('Configuration Error', 'The app is not configured correctly. Contact the app developer.'));
    return;
  }

  let claims: BCLoadClaims;
  try {
    claims = jwt.verify(signed_payload_jwt, clientSecret, {
      algorithms: ['HS256'],
    }) as BCLoadClaims;
  } catch (err) {
    console.warn('[load] JWT verification failed:', err);
    res.status(401).send(renderError('Authentication Failed', 'Invalid or expired session. Please reload the app from the BigCommerce control panel.'));
    return;
  }

  // sub = "stores/abc123"
  const storeHash = claims.sub.split('/')[1];
  if (!storeHash) {
    res.status(400).send(renderError('Invalid Token', 'Could not extract store identifier from token.'));
    return;
  }

  // App Extension clicks arrive here too: the signed `url` claim holds the resolved extension
  // path (normal app opens carry "/"). Serve the record panel instead of the full SPA.
  const ext = parseExtensionUrl(claims.url);
  if (ext) {
    console.log(`[load] extension panel entity=${ext.entity} id=${ext.id} store=${storeHash}`);
    sendExtensionPanel(res, ext.entity, ext.id, storeHash);
    return;
  }
  if (claims.url && claims.url !== '/') {
    console.log(`[load] unrecognised url claim "${claims.url}" — serving main app`);
  }

  const tokenRecord = getToken(storeHash);
  if (!tokenRecord) {
    res.status(404).send(renderError(
      'Store Not Found',
      'This store has not completed the installation. Please reinstall the app from the BigCommerce App Marketplace.'
    ));
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
    apiBase: process.env.ADHOC_API_BASE ?? 'https://edge.adhocverify.com/functions/v1',
    storeHash,
    storeAccessToken: tokenRecord.access_token,
  };

  // Inject config before </head> so it's available when the SPA initialises
  const injectedScript = `<script>window.AdHocAdminConfig = ${JSON.stringify(config)};</script>`;
  const injectedHtml = html.replace('</head>', `${injectedScript}\n</head>`);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Prevent proxies/browsers from caching the page — it contains a live access token
  res.setHeader('Cache-Control', 'no-store');
  // This page is loaded inside an iframe in the BigCommerce control panel.
  // Remove the default SAMEORIGIN restriction and allow only BC domains.
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.bigcommerce.com https://*.mybigcommerce.com");
  res.send(injectedHtml);
};
