import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type DB = Database.Database;

const here = dirname(fileURLToPath(import.meta.url));

function loadSchema(): string {
  // im Build (dist/) liegt schema.sql nicht neben der JS-Datei -> auf src/ zurückfallen
  for (const p of [join(here, 'schema.sql'), join(here, '..', 'src', 'schema.sql')]) {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      /* nächsten Pfad probieren */
    }
  }
  throw new Error('schema.sql nicht gefunden');
}

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL'); // gleichzeitiges Lesen während Schreibvorgängen
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(loadSchema());
  return db;
}

export function getSetting(db: DB, key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function audit(
  db: DB,
  a: {
    userId: number | null;
    action: 'create' | 'update' | 'delete';
    entity: string;
    entityId: number | null;
    employeeId?: number | null;
    date?: string | null;
    before?: unknown;
    after?: unknown;
  },
): void {
  db.prepare(
    `INSERT INTO audit_log(user_id, action, entity, entity_id, employee_id, date, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.userId,
    a.action,
    a.entity,
    a.entityId,
    a.employeeId ?? null,
    a.date ?? null,
    a.before === undefined ? null : JSON.stringify(a.before),
    a.after === undefined ? null : JSON.stringify(a.after),
  );
}
