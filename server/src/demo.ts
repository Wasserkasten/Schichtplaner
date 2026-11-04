/**
 * Beispieldaten zum Ausprobieren – einfügen und vollständig wieder entfernen.
 *
 * Die Beispieldaten werden zusätzlich zu vorhandenen Daten angelegt. Welche Datensätze dazugehören,
 * steht in settings.demo_data; nur diese werden beim Entfernen gelöscht.
 */
import type { DB } from './db.js';
import { getSetting, setSetting } from './db.js';
import { hashPassword } from './auth.js';
import { ensureEntryTypes } from './seed-lib.js';
import { holidays } from './holidays.js';

const KEY = 'demo_data';
export const DEMO_PASSWORD = 'demo1234';

interface DemoIds {
  departments: number[];
  teams: number[];
  employees: number[];
  users: number[];
  createdAt: string;
}

export interface DemoSummary {
  present: boolean;
  createdAt?: string;
  departments: number;
  teams: number;
  employees: number;
  users: { username: string; displayName: string; role: string }[];
  entries: number;
}

export class DemoError extends Error {}

/** Struktur: gleichnamige Teams in mehreren Abteilungen sind beabsichtigt. */
const STRUCTURE: { department: string; teams: { name: string; pattern: Pattern; people: string[] }[] }[] = [
  {
    department: 'Beispiel Nord',
    teams: [
      { name: 'Meisterei 1', pattern: 'rotation', people: ['Anna Becker', 'David Hoffmann', 'Greta Klein', 'Jonas Schwarz'] },
      { name: 'Meisterei 2', pattern: 'rotation', people: ['Ben Schulz', 'Eva Koch', 'Hannes Wolf', 'Katrin Zimmermann'] },
    ],
  },
  {
    department: 'Beispiel Süd',
    teams: [
      { name: 'Meisterei 1', pattern: 'rotation', people: ['Clara Wagner', 'Felix Richter', 'Ida Neumann'] },
      { name: 'Meisterei 2', pattern: 'rotation', people: ['Lukas Braun', 'Mia Krüger', 'Noah Hartmann'] },
    ],
  },
  {
    department: 'Beispiel Verwaltung',
    teams: [
      { name: 'Disposition', pattern: 'office', people: ['Paula Schmitt', 'Tim Lange', 'Sophie Werner'] },
      { name: 'Werkstatt', pattern: 'workshop', people: ['Erik Krause', 'Lena Meier', 'Jan Lehmann'] },
    ],
  },
];
type Pattern = 'rotation' | 'office' | 'workshop';

const NOTES = ['Arzttermin 10 Uhr', 'Schulung Winterdienst', 'Tausch mit Kollegin', 'Später Beginn 9 Uhr', 'Fahrzeugübergabe'];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function readIds(db: DB): DemoIds | null {
  const raw = getSetting(db, KEY, '');
  return raw ? (JSON.parse(raw) as DemoIds) : null;
}

function inList(ids: number[]): string {
  return ids.length ? ids.map(() => '?').join(',') : 'NULL';
}

export function demoSummary(db: DB): DemoSummary {
  const ids = readIds(db);
  if (!ids) return { present: false, departments: 0, teams: 0, employees: 0, users: [], entries: 0 };
  const users = (
    ids.users.length
      ? db.prepare(`SELECT username, display_name FROM users WHERE id IN (${inList(ids.users)}) ORDER BY id`).all(...ids.users)
      : []
  ) as { username: string; display_name: string }[];
  const entries = ids.employees.length
    ? (db.prepare(`SELECT COUNT(*) n FROM entries WHERE employee_id IN (${inList(ids.employees)})`).get(...ids.employees) as { n: number }).n
    : 0;
  const roles: Record<string, string> = {
    'demo.mitarbeiter': 'Mitarbeiterin, darf das eigene Team bearbeiten',
    'demo.teamleitung': 'Teamleitung, verwaltet das eigene Team und bearbeitet ein Nachbarteam',
    'demo.leser': 'nur ansehen, kein eigenes Team',
  };
  return {
    present: true,
    createdAt: ids.createdAt,
    departments: ids.departments.length,
    teams: ids.teams.length,
    employees: ids.employees.length,
    users: users.map((u) => ({ username: u.username, displayName: u.display_name, role: roles[u.username] ?? '' })),
    entries,
  };
}

/** Legt die Beispieldaten an (vorherigen bis nächsten Monat). Wirft DemoError bei Konflikten. */
export function insertDemoData(db: DB, today = new Date()): DemoSummary {
  if (readIds(db)) throw new DemoError('Beispieldaten sind bereits vorhanden.');
  ensureEntryTypes(db);

  const nameTaken = STRUCTURE.map((s) => s.department).filter((n) => db.prepare('SELECT 1 FROM departments WHERE name = ?').get(n));
  if (nameTaken.length) throw new DemoError(`Abteilung existiert bereits: ${nameTaken.join(', ')}`);
  const userTaken = ['demo.mitarbeiter', 'demo.teamleitung', 'demo.leser'].filter((u) => db.prepare('SELECT 1 FROM users WHERE username = ?').get(u));
  if (userTaken.length) throw new DemoError(`Benutzer existiert bereits: ${userTaken.join(', ')}`);

  // Eintragsarten möglichst über das Kürzel finden, sonst über Kategorie/Merkmale – die Arten sind änderbar
  const types = db
    .prepare('SELECT id, code, category, counts_as_vacation, sensitive FROM entry_types WHERE active = 1 ORDER BY sort_order, id')
    .all() as { id: number; code: string; category: string; counts_as_vacation: number; sensitive: number }[];
  const byCode = (c: string) => types.find((t) => t.code === c)?.id;
  const shifts = types.filter((t) => t.category === 'shift').map((t) => t.id);
  const presence = types.filter((t) => t.category === 'presence').map((t) => t.id);
  if (shifts.length === 0) throw new DemoError('Es gibt keine aktive Dienstart (Kategorie „Dienst“).');
  const T = {
    early: byCode('F') ?? shifts[0],
    late: byCode('S') ?? shifts[1] ?? shifts[0],
    night: byCode('N') ?? shifts[2] ?? shifts[0],
    day: byCode('T') ?? shifts[0],
    standby: byCode('B') ?? null,
    office: byCode('HO') ?? presence[0] ?? null,
    training: byCode('FB') ?? presence[1] ?? presence[0] ?? null,
    vacation: types.find((t) => t.counts_as_vacation)?.id ?? null,
    sick: types.find((t) => t.sensitive && t.category === 'absence')?.id ?? null,
  };

  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0));
  const state = getSetting(db, 'holiday_state', 'NW');
  const holidaySet = new Set(
    [start.getUTCFullYear(), end.getUTCFullYear()].flatMap((y) => holidays(y, state).map((h) => h.date)),
  );
  const days: string[] = [];
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400_000)) days.push(iso(d));
  const isWorkday = (date: string) => {
    const wd = new Date(date + 'T00:00:00Z').getUTCDay();
    return wd !== 0 && wd !== 6 && !holidaySet.has(date);
  };

  const ids: DemoIds = { departments: [], teams: [], employees: [], users: [], createdAt: new Date().toISOString() };
  const maxSort = (table: string) => (db.prepare(`SELECT COALESCE(MAX(sort_order), 0) m FROM ${table}`).get() as { m: number }).m;

  db.transaction(() => {
    const insEntry = db.prepare('INSERT INTO entries(employee_id, date, type_id, text) VALUES (?, ?, ?, ?)');
    const add = (emp: number, date: string, typeId: number | null, text: string | null = null) => {
      if (typeId != null || text) insEntry.run(emp, date, typeId, text);
    };
    let deptSort = maxSort('departments');
    let teamSort = maxSort('teams');
    let empSort = maxSort('employees');
    let n = 0; // laufende Nummer über alle Mitarbeiter, für Versatz von Schichten/Urlaub
    const empByName = new Map<string, { id: number; teamId: number }>();
    const teamByKey = new Map<string, number>();

    for (const s of STRUCTURE) {
      const deptId = Number(db.prepare('INSERT INTO departments(name, sort_order) VALUES (?, ?)').run(s.department, ++deptSort).lastInsertRowid);
      ids.departments.push(deptId);
      for (const t of s.teams) {
        const teamId = Number(
          db.prepare('INSERT INTO teams(department_id, name, sort_order) VALUES (?, ?, ?)').run(deptId, t.name, ++teamSort).lastInsertRowid,
        );
        ids.teams.push(teamId);
        teamByKey.set(`${s.department}/${t.name}`, teamId);
        for (const person of t.people) {
          const [first, last] = person.split(' ');
          const empId = Number(
            db
              .prepare('INSERT INTO employees(team_id, first_name, last_name, short_name, sort_order, vacation_days_per_year) VALUES (?, ?, ?, ?, ?, ?)')
              .run(teamId, first, last, (first[0] + last.slice(0, 2)).toUpperCase(), ++empSort, 30)
              .lastInsertRowid,
          );
          ids.employees.push(empId);
          empByName.set(person, { id: empId, teamId });

          // Urlaubsblock (5–7 Werktage) und gelegentlich Krankheit, je Mitarbeiter versetzt
          const vacStart = 8 + ((n * 11) % 60);
          const vacation = new Set(days.slice(vacStart, vacStart + 7 + (n % 3) * 2)); // Wochenenden darin bleiben frei
          const sickStart = n % 5 === 2 ? 20 + ((n * 7) % 40) : -1;
          const sick = new Set(sickStart >= 0 ? days.slice(sickStart, sickStart + 2 + (n % 2)) : []);

          days.forEach((date, i) => {
            const wd = new Date(date + 'T00:00:00Z').getUTCDay();
            if (T.vacation && vacation.has(date)) return isWorkday(date) ? add(empId, date, T.vacation) : undefined;
            if (T.sick && sick.has(date)) return add(empId, date, T.sick);
            if (t.pattern === 'rotation') {
              // F F S S N N frei frei – je Mitarbeiter versetzt
              const slot = (i + n * 3) % 8;
              add(empId, date, [T.early, T.early, T.late, T.late, T.night, T.night, null, null][slot]);
            } else if (t.pattern === 'office') {
              if (!isWorkday(date)) return;
              if (T.training && (i + n) % 23 === 0) return add(empId, date, T.training);
              add(empId, date, T.office && (wd === 3 + (n % 2) * 2) ? T.office : T.day);
            } else {
              if (isWorkday(date)) add(empId, date, T.day);
              else if (T.standby && Math.floor(i / 7) % 3 === n % 3) add(empId, date, T.standby);
            }
          });
          // ein paar Notizen
          if (n % 4 === 1) add(empId, days[(n * 13 + 30) % days.length], null, NOTES[n % NOTES.length]);
          n++;
        }
      }
    }

    // Beispielkonten
    const pw = hashPassword(DEMO_PASSWORD);
    const user = (username: string, display: string, employeeId: number | null) => {
      const id = Number(
        db
          .prepare('INSERT INTO users(username, display_name, password_hash, employee_id, must_change_password) VALUES (?, ?, ?, ?, 0)')
          .run(username, display, pw, employeeId)
          .lastInsertRowid,
      );
      ids.users.push(id);
      return id;
    };
    user('demo.mitarbeiter', 'Anna Becker (Beispiel)', empByName.get('Anna Becker')!.id);
    const lead = user('demo.teamleitung', 'Ben Schulz (Beispiel, Teamleitung)', empByName.get('Ben Schulz')!.id);
    user('demo.leser', 'Lesezugriff (Beispiel)', null);
    const grant = db.prepare('INSERT INTO grants(user_id, scope, scope_id, level) VALUES (?, ?, ?, ?)');
    grant.run(lead, 'team', teamByKey.get('Beispiel Nord/Meisterei 2'), 'manage');
    grant.run(lead, 'team', teamByKey.get('Beispiel Nord/Meisterei 1'), 'edit');

    setSetting(db, KEY, JSON.stringify(ids));
  })();

  return demoSummary(db);
}

/**
 * Entfernt genau die Beispieldaten. Echte Daten bleiben unberührt; liegen echte Teams oder
 * Mitarbeiter inzwischen in Beispiel-Abteilungen/-Teams, wird abgebrochen.
 */
export function removeDemoData(db: DB): { removed: DemoSummary } {
  const ids = readIds(db);
  if (!ids) throw new DemoError('Es sind keine Beispieldaten vorhanden.');
  const summary = demoSummary(db);

  db.transaction(() => {
    const foreignTeams = ids.departments.length
      ? (db
          .prepare(`SELECT name FROM teams WHERE department_id IN (${inList(ids.departments)}) AND id NOT IN (${inList(ids.teams)})`)
          .all(...ids.departments, ...ids.teams) as { name: string }[])
      : [];
    if (foreignTeams.length) {
      throw new DemoError(`Beispiel-Abteilungen enthalten eigene Teams (${foreignTeams.map((t) => t.name).join(', ')}). Bitte zuerst verschieben oder löschen.`);
    }
    const foreignEmps = ids.teams.length
      ? (db
          .prepare(`SELECT first_name || ' ' || last_name AS name FROM employees WHERE team_id IN (${inList(ids.teams)}) AND id NOT IN (${inList(ids.employees)})`)
          .all(...ids.teams, ...ids.employees) as { name: string }[])
      : [];
    if (foreignEmps.length) {
      throw new DemoError(`Beispiel-Teams enthalten eigene Mitarbeiter (${foreignEmps.map((e) => e.name).join(', ')}). Bitte zuerst in ein anderes Team verschieben.`);
    }

    if (ids.users.length) {
      const u = inList(ids.users);
      // Spuren der Beispielkonten in echten Daten lösen (Protokoll bleibt erhalten, nur ohne Benutzer)
      db.prepare(`UPDATE audit_log SET user_id = NULL WHERE user_id IN (${u})`).run(...ids.users);
      db.prepare(`UPDATE entries SET created_by = NULL WHERE created_by IN (${u})`).run(...ids.users);
      db.prepare(`UPDATE entries SET updated_by = NULL WHERE updated_by IN (${u})`).run(...ids.users);
      db.prepare(`DELETE FROM users WHERE id IN (${u})`).run(...ids.users); // Rechte, Sitzungen, Ansichten werden mitgelöscht
    }
    if (ids.employees.length) {
      db.prepare(`DELETE FROM employees WHERE id IN (${inList(ids.employees)})`).run(...ids.employees); // Einträge werden mitgelöscht
    }
    if (ids.teams.length) {
      db.prepare(`DELETE FROM grants WHERE scope = 'team' AND scope_id IN (${inList(ids.teams)})`).run(...ids.teams);
      db.prepare(`DELETE FROM teams WHERE id IN (${inList(ids.teams)})`).run(...ids.teams);
    }
    if (ids.departments.length) {
      db.prepare(`DELETE FROM grants WHERE scope = 'department' AND scope_id IN (${inList(ids.departments)})`).run(...ids.departments);
      db.prepare(`DELETE FROM departments WHERE id IN (${inList(ids.departments)})`).run(...ids.departments);
    }
    db.prepare('DELETE FROM settings WHERE key = ?').run(KEY);
  })();

  return { removed: summary };
}
