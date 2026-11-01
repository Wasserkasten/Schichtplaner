import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DB } from './db.js';

function stamp(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // 20261101-103000
}

/** Konsistente Sicherung im laufenden Betrieb (SQLite Online-Backup). */
export async function backupTo(db: DB, file: string): Promise<void> {
  mkdirSync(dirname(file), { recursive: true });
  await db.backup(file);
}

/** Legt eine Sicherung in `dir` an und behält nur die neuesten `keep` Dateien. */
export async function rotatingBackup(db: DB, dir: string, keep: number): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `schichtplaner-${stamp()}.db`);
  await backupTo(db, file);
  const old = readdirSync(dir)
    .filter((f) => /^schichtplaner-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse()
    .slice(keep);
  for (const f of old) rmSync(join(dir, f));
  return file;
}

/** Tägliche automatische Sicherung (erste ca. 1 Minute nach dem Start). */
export function scheduleBackups(db: DB, dir: string, keep: number, log: (msg: string) => void): void {
  const run = () =>
    rotatingBackup(db, dir, keep).then(
      (f) => log(`Backup erstellt: ${f}`),
      (e) => log(`Backup fehlgeschlagen: ${(e as Error).message}`),
    );
  setTimeout(run, 60_000).unref();
  setInterval(run, 24 * 3600_000).unref();
}
