import { Router } from 'express';
import express from 'express';
import path from 'path';
import { handleAuth } from './auth';
import { handleLoad } from './load';
import { handleUninstall } from './uninstall';

export const bigcommerceRouter = Router();

// BigCommerce app lifecycle callbacks
bigcommerceRouter.get('/auth', handleAuth);
bigcommerceRouter.get('/load', handleLoad);
bigcommerceRouter.get('/uninstall', handleUninstall);

// Redirect bare /admin path to trailing-slash version so relative asset paths resolve correctly
bigcommerceRouter.get('/admin', (_req, res) => {
  res.redirect(301, '/bigcommerce/admin/');
});

// Serve the built React SPA and its assets
const adminDist = path.resolve('dist/admin');
bigcommerceRouter.use('/admin', express.static(adminDist));

// SPA fallback — any /admin/* path that doesn't match a file serves index.html
bigcommerceRouter.get('/admin/*', (_req, res) => {
  res.sendFile(path.join(adminDist, 'index.html'));
});
