import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { buildApp } from './app.js';
import { ensureInitialAdmin } from './seed-lib.js';

const here = dirname(fileURLToPath(import.meta.url));
const dbFile = process.env.DB_FILE ?? join(here, '..', 'data', 'schichtplaner.db');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const staticDir = process.env.STATIC_DIR ?? join(here, '..', '..', 'web', 'dist');

const db = openDb(dbFile);
ensureInitialAdmin(db);

const { app } = await buildApp({
  db,
  staticDir,
  secureCookies: process.env.SECURE_COOKIES === 'true',
  logger: true,
});

await app.listen({ port, host });
