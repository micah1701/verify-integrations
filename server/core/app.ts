import express from 'express';
import { bigcommerceRouter } from '../bigcommerce/router';
import { errorHandler } from './middleware/error-handler';

export const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Default: deny framing from other origins. load.ts overrides this for BigCommerce.
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// Health check — no auth, no integration context
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

// Integration routers — each mounted at its own base path
app.use('/bigcommerce', bigcommerceRouter);

// Future integrations follow the same pattern:
// import { shopifyRouter } from '../shopify/router';
// app.use('/shopify', shopifyRouter);

// Global error handler — must be the last middleware registered
app.use(errorHandler);
