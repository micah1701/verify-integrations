import 'dotenv/config';
import { createServer } from 'http';
import { app } from './core/app';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const server = createServer(app);

server.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
