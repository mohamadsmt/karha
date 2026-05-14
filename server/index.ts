import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { handleNodeRequest } from './app';
import { KarhaDatabase } from './database';
import { resolveDataPaths } from './dataPaths';
import { loadLocalEnv } from './localEnv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
loadLocalEnv(repoRoot);
const { dataDir, dbPath } = resolveDataPaths({ repoRoot });
const store = new KarhaDatabase(dbPath);
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3737);
const distDir = path.join(repoRoot, 'dist');

const server = createServer((req, res) => {
  void handleNodeRequest(req, res, {
    store,
    settings: {
      appName: 'کارها',
      dataDir,
      dbPath,
      locale: 'fa-IR',
      calendar: 'persian',
      notifications: 'browser-only'
    },
    distDir: existsSync(distDir) ? distDir : undefined
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Karha API listening on http://127.0.0.1:${port}`);
  console.log(`Data: ${dbPath}`);
});

const shutdown = () => {
  server.close(() => {
    store.close();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
