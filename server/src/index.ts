import { buildServer } from './server.js';
import { closeBrowser } from './extract/extractor.js';

const PORT = Number(process.env.PORT ?? 5177);
const HOST = process.env.HOST ?? '127.0.0.1';

const app = await buildServer();

const shutdown = async () => {
  await app.close().catch(() => {});
  await closeBrowser();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: PORT, host: HOST });
