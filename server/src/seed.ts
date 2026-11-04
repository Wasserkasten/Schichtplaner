/**
 * Entwicklung: leere Datenbank mit Administrator und Beispieldaten füllen.
 *   npm run seed            (DB_FILE optional)
 * Eine vorhandene Datenbank wird nicht verändert. Für bestehende Installationen gibt es
 * stattdessen "Verwaltung → Einstellungen → Beispieldaten" bzw. "node server/dist/cli.js demo".
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPassword } from './auth.js';
import { ensureEntryTypes } from './seed-lib.js';
import { DEMO_PASSWORD, insertDemoData } from './demo.js';

const here = dirname(fileURLToPath(import.meta.url));
const db = openDb(process.env.DB_FILE ?? join(here, '..', 'data', 'schichtplaner.db'));

if ((db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n > 0) {
  console.error('Datenbank ist nicht leer – nichts verändert.');
  console.error('Beispieldaten zusätzlich einfügen: Verwaltung → Einstellungen → Beispieldaten (oder: npm run cli -w server demo)');
  process.exit(1);
}

ensureEntryTypes(db);
db.prepare(
  "INSERT INTO users(username, display_name, password_hash, is_admin, must_change_password) VALUES ('admin', 'Administrator', ?, 1, 0)",
).run(hashPassword(DEMO_PASSWORD));
const s = insertDemoData(db);

console.log(`Demodaten angelegt: ${s.employees} Mitarbeiter in ${s.teams} Teams, ${s.entries} Planeinträge.`);
console.log(`Logins (Passwort jeweils "${DEMO_PASSWORD}"): admin, ${s.users.map((u) => u.username).join(', ')}`);
