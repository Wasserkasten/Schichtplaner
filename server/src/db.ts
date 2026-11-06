import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { APP_VERSION } from './version.js';
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
  migrate(db);
  setSetting(db, 'app_version', APP_VERSION); // für den Trigger „neue Benutzer sehen keine alten Neuigkeiten“
  return db;
}

/** Ergänzt Spalten in bestehenden Datenbanken (CREATE TABLE IF NOT EXISTS ändert vorhandene Tabellen nicht). */
function migrate(db: DB): void {
  const has = (table: string, col: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
  if (!has('users', 'font_scale')) db.exec('ALTER TABLE users ADD COLUMN font_scale REAL NOT NULL DEFAULT 1');
  // Änderungs-ID: alle Protokollzeilen einer Aktion (z. B. ein Pinselstrich) gehören zusammen und lassen sich gemeinsam zurücknehmen
  if (!has('audit_log', 'change_id')) db.exec('ALTER TABLE audit_log ADD COLUMN change_id TEXT');
  if (!has('audit_log', 'undo_of')) db.exec('ALTER TABLE audit_log ADD COLUMN undo_of TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_audit_change ON audit_log(change_id)');
  // Neuigkeiten: bis zu welcher Version hat der Benutzer die Hinweise gesehen bzw. „Wichtiges“ bestätigt?
  // Eintritts-/Austrittsdatum (ISO); außerhalb sind keine Einträge möglich
  if (!has('employees', 'entry_date')) db.exec('ALTER TABLE employees ADD COLUMN entry_date TEXT');
  if (!has('employees', 'exit_date')) db.exec('ALTER TABLE employees ADD COLUMN exit_date TEXT');
  // Darstellung je Benutzer: auto (wie System) | light | dark
  if (!has('users', 'theme')) db.exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'auto'");
  if (!has('users', 'seen_version')) db.exec('ALTER TABLE users ADD COLUMN seen_version TEXT');
  if (!has('users', 'ack_version')) db.exec('ALTER TABLE users ADD COLUMN ack_version TEXT');
  // Neue Konten sollen keine alten Neuigkeiten sehen: beim Anlegen auf die laufende Version setzen
  db.exec(`CREATE TRIGGER IF NOT EXISTS users_news_start AFTER INSERT ON users WHEN NEW.seen_version IS NULL
           BEGIN
             UPDATE users SET seen_version = (SELECT value FROM settings WHERE key = 'app_version'),
                              ack_version  = (SELECT value FROM settings WHERE key = 'app_version')
             WHERE id = NEW.id;
           END`);
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
    /** gemeinsame ID aller Zeilen einer Aktion */
    changeId?: string | null;
    /** bei einer Rücknahme: die zurückgenommene Änderungs-ID */
    undoOf?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO audit_log(user_id, action, entity, entity_id, employee_id, date, before_json, after_json, change_id, undo_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.userId,
    a.action,
    a.entity,
    a.entityId,
    a.employeeId ?? null,
    a.date ?? null,
    a.before === undefined ? null : JSON.stringify(a.before),
    a.after === undefined ? null : JSON.stringify(a.after),
    a.changeId ?? null,
    a.undoOf ?? null,
  );
}
