import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { deleteToken } from '../core/db';
import { renderError } from './render-error';

interface BCUninstallClaims {
  sub: string; // "stores/HASH"
  iat: number;
  exp: number;
}

export const handleUninstall: RequestHandler = (req, res) => {
  const { signed_payload_jwt } = req.query as Record<string, string>;

  if (!signed_payload_jwt) {
    res.status(400).send(renderError('Missing Payload', 'No signed_payload_jwt provided.'));
    return;
  }

  const clientSecret = process.env.BC_CLIENT_SECRET;
  if (!clientSecret) {
    console.error('[uninstall] BC_CLIENT_SECRET env var is not set');
    res.status(500).send(renderError('Configuration Error', 'The app is not configured correctly.'));
    return;
  }

  let claims: BCUninstallClaims;
  try {
    claims = jwt.verify(signed_payload_jwt, clientSecret, {
      algorithms: ['HS256'],
    }) as BCUninstallClaims;
  } catch (err) {
    console.warn('[uninstall] JWT verification failed:', err);
    res.status(401).send(renderError('Invalid Signature', 'Could not verify the uninstall request.'));
    return;
  }

  const storeHash = claims.sub.split('/')[1];
  if (storeHash) {
    deleteToken(storeHash);
    console.log(`[uninstall] removed store=${storeHash}`);
  }

  // BigCommerce requires a 200 response to confirm the uninstall was received
  res.status(200).send('<p>App uninstalled successfully.</p>');
};
