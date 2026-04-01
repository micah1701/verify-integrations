import type { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('[error]', err);
  const status = (err as { status?: number }).status ?? 500;
  res.status(status).json({ error: (err as Error).message ?? 'Internal server error' });
};
