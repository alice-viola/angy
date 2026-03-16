import { serve } from '@hono/node-server';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseImpl } from '@angycode/core';
import { createApp } from './server.js';

const portArg = process.argv.indexOf('--port');
const port = portArg !== -1 ? parseInt(process.argv[portArg + 1], 10) : 7341;

const dbDir = join(homedir(), '.angycode');
mkdirSync(dbDir, { recursive: true });
const dbPath = join(dbDir, 'angycode.db');

const db = new DatabaseImpl(dbPath);
const app = createApp(db);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`ANGYCODE_SERVER_READY port=${info.port}`);
});
