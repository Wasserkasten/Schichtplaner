/**
 * Verwaltungswerkzeug für die Kommandozeile.
 *
 *   node server/dist/cli.js backup <zieldatei>
 *   node server/dist/cli.js restore <sicherung>     (nur bei gestopptem Server!)
 *   node server/dist/cli.js reset-password <benutzer> [neues-passwort]
 *   node server/dist/cli.js create-admin <benutzer> [passwort]
 *   node server/dist/cli.js list-users
 *   node server/dist/cli.js demo              Beispieldaten einfügen
 *   node server/dist/cli.js demo-remove       Beispieldaten wieder entfernen
 *
 * Die Datenbank wird über DB_FILE gefunden (wie beim Server).
 */
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPassword } from './auth.js';
import { backupTo } from './backup.js';
import { ensureEntryTypes } from './seed-lib.js';
import { DEMO_PASSWORD, DemoError, insertDemoData, removeDemoData, type DemoSummary } from './demo.js';

const here = dirname(fileURLToPath(import.meta.url));
const dbFile = process.env.DB_FILE ?? join(here, '..', 'data', 'schichtplaner.db');
const [cmd, a, b] = process.argv.slice(2);

function usage(): never {
  console.log(`Verwendung:
  backup <zieldatei>                    Sicherung der Datenbank anlegen
  restore <sicherung>                   Sicherung zurückspielen (Server vorher stoppen!)
  reset-password <benutzer> [passwort]  Passwort zurücksetzen (ohne Angabe: zufällig)
  create-admin <benutzer> [passwort]    zusätzlichen Administrator anlegen
  list-users                            Benutzer auflisten
  demo                                  Beispieldaten einfügen (zusätzlich zu vorhandenen Daten)
  demo-remove                           Beispieldaten wieder vollständig entfernen

Datenbank: ${dbFile}  (änderbar über DB_FILE)`);
  process.exit(cmd ? 1 : 0);
}

if (cmd === 'restore') {
  if (!a) usage();
  if (!existsSync(a)) {
    console.error(`Datei nicht gefunden: ${a}`);
    process.exit(1);
  }
  const src = new Database(a, { readonly: true, fileMustExist: true });
  try {
    src.prepare('SELECT COUNT(*) FROM users').get();
  } catch {
    console.error('Die Datei ist keine Schichtplaner-Datenbank.');
    process.exit(1);
  }
  if (existsSync(dbFile)) {
    // aktuellen Stand vorsichtshalber sichern, bevor er ersetzt wird
    const safety = `${dbFile}.vor-wiederherstellung.db`;
    const cur = openDb(dbFile);
    await backupTo(cur, safety);
    cur.close();
    console.log(`Bisheriger Stand gesichert: ${safety}`);
  }
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) rmSync(f, { force: true });
  await src.backup(dbFile);
  src.close();
  console.log(`Sicherung ${a} wurde nach ${dbFile} zurückgespielt.`);
  process.exit(0);
}

const db = openDb(dbFile);

switch (cmd) {
  case 'backup': {
    if (!a) usage();
    await backupTo(db, a);
    console.log(`Sicherung geschrieben: ${a}`);
    break;
  }
  case 'reset-password': {
    if (!a) usage();
    const pw = b || randomBytes(9).toString('base64url');
    const r = db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, active = 1 WHERE username = ?').run(hashPassword(pw), a);
    if (r.changes === 0) {
      console.error(`Benutzer "${a}" nicht gefunden.`);
      process.exit(1);
    }
    db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(a);
    console.log(`Neues Passwort für "${a}": ${pw}\n(muss bei der nächsten Anmeldung geändert werden)`);
    break;
  }
  case 'create-admin': {
    if (!a) usage();
    ensureEntryTypes(db);
    const pw = b || randomBytes(9).toString('base64url');
    db.prepare(
      'INSERT INTO users(username, display_name, password_hash, is_admin, must_change_password) VALUES (?, ?, ?, 1, 1)',
    ).run(a, a, hashPassword(pw));
    console.log(`Administrator "${a}" angelegt, Passwort: ${pw}`);
    break;
  }
  case 'list-users': {
    const rows = db.prepare('SELECT username, display_name, is_admin, active FROM users ORDER BY username').all() as {
      username: string;
      display_name: string;
      is_admin: number;
      active: number;
    }[];
    for (const u of rows) console.log(`${u.username.padEnd(20)} ${u.display_name.padEnd(30)} ${u.is_admin ? 'Admin' : ''}${u.active ? '' : ' (inaktiv)'}`);
    break;
  }
  case 'demo':
  case 'demo-remove': {
    try {
      if (cmd === 'demo') {
        printDemo('Beispieldaten eingefügt', insertDemoData(db));
        console.log(`\nAnmeldung mit diesen Benutzern, Passwort jeweils "${DEMO_PASSWORD}".`);
        console.log('Läuft der Server gerade, aktualisieren sich offene Pläne nach einem Neuladen der Seite.');
      } else {
        printDemo('Beispieldaten entfernt', removeDemoData(db).removed);
      }
    } catch (e) {
      if (!(e instanceof DemoError)) throw e;
      console.error(e.message);
      process.exit(1);
    }
    break;
  }
  default:
    usage();
}
db.close();

function printDemo(title: string, s: DemoSummary) {
  console.log(`${title}: ${s.departments} Abteilungen, ${s.teams} Teams, ${s.employees} Mitarbeiter, ${s.entries} Planeinträge`);
  for (const u of s.users) console.log(`  ${u.username.padEnd(18)} ${u.role}`);
}
