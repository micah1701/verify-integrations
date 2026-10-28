import type { RequestHandler } from 'express';

/**
 * Allows a route to be embedded in the BigCommerce control panel iframe.
 * Runs BEFORE the handler so error pages (bad JWT, store not found, ...) are framable too —
 * otherwise the browser blocks them and the merchant only sees an X-Frame-Options error
 * instead of the real message.
 */
export const allowBcFraming: RequestHandler = (_req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://*.bigcommerce.com https://*.mybigcommerce.com",
  );
  next();
};
