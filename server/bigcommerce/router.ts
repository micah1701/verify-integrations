import { Router } from 'express';
import express from 'express';
import path from 'path';
import { handleAuth } from './auth';
import { handleLoad } from './load';
import { handleUninstall } from './uninstall';
import {
  handleCustomersList,
  handleCustomerDetail,
  handleOrdersList,
  handleOrderDetail,
} from './proxy';

export const bigcommerceRouter = Router();

// BigCommerce app lifecycle callbacks
bigcommerceRouter.get('/auth', handleAuth);
bigcommerceRouter.get('/load', handleLoad);
bigcommerceRouter.get('/uninstall', handleUninstall);

// BC Management API proxy routes (storeHash in query string; access token stays server-side)
bigcommerceRouter.get('/api/customers', handleCustomersList);
bigcommerceRouter.get('/api/customers/:id', handleCustomerDetail);
bigcommerceRouter.get('/api/orders', handleOrdersList);
bigcommerceRouter.get('/api/orders/:id', handleOrderDetail);

// Redirect bare /admin path to trailing-slash version so relative asset paths resolve correctly
bigcommerceRouter.get('/admin', (_req, res) => {
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
