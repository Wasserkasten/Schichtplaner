import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { buildApp } from './app.js';
import { ensureInitialAdmin } from './seed-lib.js';
import { startBackupScheduler } from './backup.js';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const dbFile = env.DB_FILE ?? join(here, '..', 'data', 'schichtplaner.db');
const port = Number(env.PORT ?? 3000);
const host = env.HOST ?? '0.0.0.0';
const staticDir = env.STATIC_DIR ?? join(here, '..', '..', 'web', 'dist');

const db = openDb(dbFile);
ensureInitialAdmin(db);

const { app, ctx } = await buildApp({
  db,
  staticDir,
  secureCookies: env.SECURE_COOKIES === 'true',
  trustProxy: env.TRUST_PROXY !== 'false',
  logger: true,
});

// Zeitplan und Ordner: Verwaltung → Backups (Standard täglich 02:30, Ordner BACKUP_DIR bzw. data/backups)
startBackupScheduler(db, ctx.backupDir, (m) => app.log.info(m));

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port, host });
