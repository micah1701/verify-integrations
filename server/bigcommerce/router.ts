import { Router } from 'express';
import express from 'express';
import path from 'path';
import { handleAuth } from './auth';
import { handleLoad } from './load';
import { handleUninstall } from './uninstall';
import { handleExtensionLoad } from './ext-load';
import { allowBcFraming } from './frame-headers';
import { extAuth, extCustomer, extOrder, extProduct, extProductSetFlag } from './ext-api';
import {
  handleCustomersList,
  handleCustomerDetail,
  handleOrdersList,
  handleOrderDetail,
} from './proxy';

export const bigcommerceRouter = Router();

// BigCommerce app lifecycle callbacks
bigcommerceRouter.get('/auth', allowBcFraming, handleAuth);
bigcommerceRouter.get('/load', allowBcFraming, handleLoad);
bigcommerceRouter.get('/uninstall', handleUninstall);

// App Extension panels (Action menu on BC Orders / Customers / Products)
bigcommerceRouter.get('/ext/:entity/:id', allowBcFraming, handleExtensionLoad);

// BC Management API proxy routes (storeHash in query string; access token stays server-side)
bigcommerceRouter.get('/api/customers', handleCustomersList);
bigcommerceRouter.get('/api/customers/:id', handleCustomerDetail);
bigcommerceRouter.get('/api/orders', handleOrdersList);
bigcommerceRouter.get('/api/orders/:id', handleOrderDetail);

// App Extension panel API — authenticated by the panel session token (Bearer), bound to one record
bigcommerceRouter.get('/api/ext/customers/:id', ...extAuth('customers'), extCustomer);
bigcommerceRouter.get('/api/ext/orders/:id', ...extAuth('orders'), extOrder);
bigcommerceRouter.get('/api/ext/products/:id', ...extAuth('products'), extProduct);
bigcommerceRouter.put('/api/ext/products/:id', ...extAuth('products'), extProductSetFlag);

// /auth redirects here inside the BC control-panel iframe, so the whole /admin tree must be framable
bigcommerceRouter.use('/admin', allowBcFraming);

// Redirect bare /admin path to trailing-slash version so relative asset paths resolve correctly
// Express routing is non-strict, so '/admin' also matches '/admin/' — only redirect when the
// request really lacks the trailing slash, otherwise this redirects to itself forever.
bigcommerceRouter.get('/admin', (req, res, next) => {
  const pathname = req.originalUrl.split('?')[0];
  if (pathname.endsWith('/')) {
    next();
    return;
  }
  res.redirect(301, '/bigcommerce/admin/');
});

// Serve the storefront IIFE bundle (used during development; replace with CDN URL in production)
bigcommerceRouter.use('/storefront', express.static(path.resolve('dist/storefront')));

// Serve the built React SPA and its assets
const adminDist = path.resolve('dist/admin');
bigcommerceRouter.use('/admin', express.static(adminDist));

// SPA fallback — /admin/ root and any /admin/* path that doesn't match a static file
bigcommerceRouter.get(['/admin/', '/admin/*'], (_req, res) => {
  res.sendFile(path.join(adminDist, 'index.html'));
});
