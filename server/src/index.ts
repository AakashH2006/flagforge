import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config.js';
import { pool } from './db/client.js';
import { closeRealtime, createRealtime } from './realtime.js';
import { redis } from './redis.js';
import { ensureUploadDir, uploadRoot } from './services/attachments.js';
import { scoreboardSnapshot } from './services/scoreboard.js';

// Fail at startup, not on the first upload, if attachments have nowhere to go.
await ensureUploadDir();

// Socket.io shares the HTTP server, so the API and the live scoreboard run on one port.
const server = createServer(createApp());
createRealtime(server, { snapshot: scoreboardSnapshot });

server.listen(env.PORT, () => {
  console.log(`FlagForge API listening on http://localhost:${env.PORT}`);
  console.log(`Challenge attachments in ${uploadRoot}`);
});

async function shutdown() {
  await closeRealtime();
  server.close();
  await Promise.allSettled([pool.end(), redis.quit()]);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
