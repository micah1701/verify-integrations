import type { RequestHandler } from 'express';
import { upsertToken } from '../core/db';
import { renderError } from './render-error';

interface BCTokenResponse {
  access_token: string;
  scope: string;
  user: { id: number; username: string; email: string };
  context: string; // "stores/HASH"
  account_uuid: string;
}

export const handleAuth: RequestHandler = async (req, res) => {
  const { code, scope, context } = req.query as Record<string, string>;

  if (!code || !context) {
    res.status(400).send(renderError('Invalid Request', 'Missing required parameters from BigCommerce.'));
    return;
  }

  const clientId = process.env.BC_CLIENT_ID;
  const clientSecret = process.env.BC_CLIENT_SECRET;
  const appBaseUrl = process.env.APP_BASE_URL;

  if (!clientId || !clientSecret || !appBaseUrl) {
    console.error('[auth] missing required env vars: BC_CLIENT_ID, BC_CLIENT_SECRET, APP_BASE_URL');
    res.status(500).send(renderError('Configuration Error', 'The app is not configured correctly. Contact the app developer.'));
    return;
  }

  try {
    const tokenRes = await fetch('https://login.bigcommerce.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        scope: scope ?? '',
        context,
        grant_type: 'authorization_code',
        redirect_uri: `${appBaseUrl}/bigcommerce/auth`,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error('[auth] BC token exchange failed:', tokenRes.status, body);
      res.status(502).send(renderError('Installation Failed', 'Could not exchange the authorization code with BigCommerce. Please try reinstalling.'));
      return;
    }

    const data = (await tokenRes.json()) as BCTokenResponse;
    // context = "stores/abc123"
    const storeHash = data.context.split('/')[1];

    upsertToken({
      store_hash: storeHash,
      access_token: data.access_token,
      scope: data.scope,
    });

    console.log(`[auth] installed store=${storeHash}`);
    res.redirect(302, '/bigcommerce/admin/');
  } catch (err) {
    console.error('[auth] unexpected error:', err);
    res.status(500).send(renderError('Server Error', 'An unexpected error occurred during installation.'));
  }
};
