/**
 * Demodaten: npm run seed  (DB_FILE optional; vorhandene Datenbank wird NICHT gelöscht,
 * Demodaten werden nur in eine leere Datenbank geschrieben)
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPassword } from './auth.js';
import { ensureEntryTypes } from './seed-lib.js';

const here = dirname(fileURLToPath(import.meta.url));
const db = openDb(process.env.DB_FILE ?? join(here, '..', 'data', 'schichtplaner.db'));

if ((db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n > 0) {
  console.error('Datenbank ist nicht leer – Demodaten werden nicht eingespielt.');
  process.exit(1);
}

ensureEntryTypes(db);
const pw = hashPassword('demo1234');

db.transaction(() => {
  const dept = (name: string, i: number) => Number(db.prepare('INSERT INTO departments(name, sort_order) VALUES (?, ?)').run(name, i).lastInsertRowid);
  const team = (d: number, name: string, i: number) =>
    Number(db.prepare('INSERT INTO teams(department_id, name, sort_order) VALUES (?, ?, ?)').run(d, name, i).lastInsertRowid);

  const leit = dept('Leitstelle', 1);
  const tech = dept('Technik', 2);
  const teams = [team(leit, 'Team A', 1), team(leit, 'Team B', 2), team(tech, 'Werkstatt', 3)];

  const names = [
    ['Anna', 'Becker'], ['Ben', 'Schulz'], ['Clara', 'Wagner'], ['David', 'Hoffmann'], ['Eva', 'Koch'],
    ['Felix', 'Richter'], ['Greta', 'Klein'], ['Hannes', 'Wolf'], ['Ida', 'Neumann'], ['Jonas', 'Schwarz'],
    ['Katrin', 'Zimmermann'], ['Lukas', 'Braun'], ['Mia', 'Krüger'], ['Noah', 'Hartmann'],
  ];
  const empIds: number[] = [];
  names.forEach(([f, l], i) => {
    const teamId = teams[i % teams.length];
    empIds.push(
      Number(
        db
          .prepare('INSERT INTO employees(team_id, first_name, last_name, short_name, sort_order) VALUES (?, ?, ?, ?, ?)')
          .run(teamId, f, l, (f[0] + l.slice(0, 2)).toUpperCase(), i).lastInsertRowid,
      ),
    );
  });

  const user = (username: string, display: string, employeeId: number | null, isAdmin = 0) =>
    Number(
      db
        .prepare('INSERT INTO users(username, display_name, password_hash, employee_id, is_admin) VALUES (?, ?, ?, ?, ?)')
        .run(username, display, pw, employeeId, isAdmin).lastInsertRowid,
    );
  user('admin', 'Administrator', null, 1);
  user('anna', 'Anna Becker', empIds[0]); // Mitarbeiterin Team A -> darf Team A bearbeiten
  const lead = user('ben', 'Ben Schulz (Teamleitung)', empIds[1]); // Team B
  // Teamleitung darf zusätzlich Team A bearbeiten und im eigenen Team Mitarbeiter verwalten
  db.prepare("INSERT INTO grants(user_id, scope, scope_id, level) VALUES (?, 'team', ?, 'edit')").run(lead, teams[0]);
  db.prepare("INSERT INTO grants(user_id, scope, scope_id, level) VALUES (?, 'team', ?, 'manage')").run(lead, teams[1]);

  // Einträge für den aktuellen und nächsten Monat
  const types = Object.fromEntries(
    (db.prepare('SELECT id, code FROM entry_types').all() as { id: number; code: string }[]).map((t) => [t.code, t.id]),
  );
  const ins = db.prepare('INSERT INTO entries(employee_id, date, type_id, text, created_by, updated_by) VALUES (?, ?, ?, ?, 1, 1)');
  const start = new Date();
  start.setUTCDate(1);
  const rotation = ['F', 'F', 'S', 'S', 'N', 'N', null, null];
  for (let d = 0; d < 62; d++) {
    const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1 + d));
    const iso = day.toISOString().slice(0, 10);
    empIds.forEach((emp, i) => {
      const code = rotation[(d + i * 3) % rotation.length];
      if (i % 7 === 3 && d >= 10 && d < 20) ins.run(emp, iso, types.U, null);
      else if (i === 5 && d >= 3 && d < 6) ins.run(emp, iso, types.K, null);
      else if (code) ins.run(emp, iso, types[code], null);
    });
  }
  ins.run(empIds[2], new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 15)).toISOString().slice(0, 10), null, 'Arzttermin 10 Uhr');
})();

console.log('Demodaten angelegt. Logins (Passwort jeweils "demo1234"): admin, anna, ben');
