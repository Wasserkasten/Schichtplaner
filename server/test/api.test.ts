import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb, type DB } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { ensureEntryTypes } from '../src/seed-lib.js';
import { holidays, easterSunday } from '../src/holidays.js';

let db: DB;
let app: FastifyInstance;
let ids: Record<string, number>;

async function login(username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'geheim123' } });
  expect(res.statusCode).toBe(200);
  const c = res.cookies.find((c) => c.name === 'sp_session')!;
  return `sp_session=${c.value}`;
}

beforeEach(async () => {
  db = openDb(':memory:');
  ensureEntryTypes(db);
  const pw = hashPassword('geheim123');
  const run = (sql: string, ...p: unknown[]) => Number(db.prepare(sql).run(...p).lastInsertRowid);
  const d = run("INSERT INTO departments(name) VALUES ('Abt')");
  const tA = run('INSERT INTO teams(department_id, name) VALUES (?, ?)', d, 'A');
  const tB = run('INSERT INTO teams(department_id, name) VALUES (?, ?)', d, 'B');
  const eA = run("INSERT INTO employees(team_id, first_name, last_name) VALUES (?, 'Anna', 'A')", tA);
  const eB = run("INSERT INTO employees(team_id, first_name, last_name) VALUES (?, 'Bert', 'B')", tB);
  const admin = run("INSERT INTO users(username, display_name, password_hash, is_admin) VALUES ('admin', 'Admin', ?, 1)", pw);
  const anna = run("INSERT INTO users(username, display_name, password_hash, employee_id) VALUES ('anna', 'Anna', ?, ?)", pw, eA);
  const lead = run("INSERT INTO users(username, display_name, password_hash) VALUES ('lead', 'Lead', ?)", pw);
  run("INSERT INTO grants(user_id, scope, scope_id, level) VALUES (?, 'department', ?, 'edit')", lead, d);
  const typeK = (db.prepare("SELECT id FROM entry_types WHERE code = 'K'").get() as { id: number }).id;
  const typeF = (db.prepare("SELECT id FROM entry_types WHERE code = 'F'").get() as { id: number }).id;
  ids = { tA, tB, eA, eB, admin, anna, lead, typeK, typeF };
  ({ app } = await buildApp({ db }));
});

describe('Berechtigungen', () => {
  it('Mitarbeiter darf das eigene Team bearbeiten, aber kein fremdes', async () => {
    const cookie = await login('anna');
    const own = await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie }, payload: { employeeId: ids.eA, date: '2026-11-02', typeId: ids.typeF } });
    expect(own.statusCode).toBe(200);
    const other = await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie }, payload: { employeeId: ids.eB, date: '2026-11-02', typeId: ids.typeF } });
    expect(other.statusCode).toBe(403);
  });

  it('Freigabe auf Abteilungsebene erlaubt Bearbeitung aller Teams', async () => {
    const cookie = await login('lead');
    const res = await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie }, payload: { employeeId: ids.eB, date: '2026-11-02', text: 'Arzt' } });
    expect(res.statusCode).toBe(200);
  });

  it('ohne Anmeldung kein Zugriff', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bootstrap' });
    expect(res.statusCode).toBe(401);
  });

  it('Krankmeldungen sind für reine Leser maskiert', async () => {
    db.prepare("INSERT INTO entries(employee_id, date, type_id) VALUES (?, '2026-11-03', ?)").run(ids.eB, ids.typeK);
    const anna = await login('anna'); // nur Leserecht auf Team B
    const seen = (await app.inject({ method: 'GET', url: '/api/entries?from=2026-11-01&to=2026-11-30', headers: { cookie: anna } })).json();
    expect(seen[0]).toMatchObject({ typeId: null, text: 'abwesend', masked: true });
    const lead = await login('lead');
    const seenLead = (await app.inject({ method: 'GET', url: '/api/entries?from=2026-11-01&to=2026-11-30', headers: { cookie: lead } })).json();
    expect(seenLead[0]).toMatchObject({ typeId: ids.typeK });
  });
});

describe('Gleichzeitige Bearbeitung', () => {
  it('veraltete Version führt zu 409 und liefert den aktuellen Stand', async () => {
    const cookie = await login('lead');
    const e = (await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie }, payload: { employeeId: ids.eA, date: '2026-11-04', typeId: ids.typeF } })).json();
    const first = await app.inject({ method: 'PATCH', url: `/api/entries/${e.id}`, headers: { cookie }, payload: { version: e.version, text: 'eins' } });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'PATCH', url: `/api/entries/${e.id}`, headers: { cookie }, payload: { version: e.version, text: 'zwei' } });
    expect(second.statusCode).toBe(409);
    expect(second.json().data.text).toBe('eins');
  });

  it('Pinsel ersetzt Dienste, behält Notizen und protokolliert den Benutzer', async () => {
    const cookie = await login('anna');
    await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie }, payload: { employeeId: ids.eA, date: '2026-11-05', text: 'Notiz' } });
    await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie }, payload: { employeeId: ids.eA, date: '2026-11-05', typeId: ids.typeF } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/entries/bulk',
      headers: { cookie },
      payload: { action: 'set', typeId: ids.typeK, cells: [{ employeeId: ids.eA, date: '2026-11-05' }, { employeeId: ids.eA, date: '2026-11-06' }] },
    });
    expect(res.statusCode).toBe(200);
    const rows = db.prepare('SELECT type_id, text FROM entries WHERE employee_id = ? ORDER BY date, id').all(ids.eA);
    expect(rows).toEqual([
      { type_id: null, text: 'Notiz' },
      { type_id: ids.typeK, text: null },
      { type_id: ids.typeK, text: null },
    ]);
    const log = db.prepare("SELECT DISTINCT user_id FROM audit_log WHERE entity = 'entry'").all();
    expect(log).toEqual([{ user_id: ids.anna }]);
  });
});

describe('Feiertage', () => {
  it('Ostersonntag', () => {
    expect(easterSunday(2026).toISOString().slice(0, 10)).toBe('2026-04-05');
    expect(easterSunday(2027).toISOString().slice(0, 10)).toBe('2027-03-28');
  });
  it('länderspezifisch', () => {
    const nw = holidays(2026, 'NW').map((h) => h.name);
    expect(nw).toContain('Fronleichnam');
    expect(nw).toContain('Allerheiligen');
    expect(nw).not.toContain('Reformationstag');
    const sn = holidays(2026, 'SN');
    expect(sn.find((h) => h.name === 'Buß- und Bettag')?.date).toBe('2026-11-18');
  });
});

describe('Backup', () => {
  it('behält nur die neuesten N Sicherungen', async () => {
    const { mkdtempSync, readdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { rotatingBackup } = await import('../src/backup.js');
    const dir = mkdtempSync(join(tmpdir(), 'sp-backup-'));
    for (const d of ['20260101', '20260102', '20260103']) writeFileSync(join(dir, `schichtplaner-${d}-000000.db`), '');
    writeFileSync(join(dir, 'fremd.txt'), '');
    await rotatingBackup(db, dir, 2);
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(3); // 2 Sicherungen + fremde Datei bleibt
    expect(files).toContain('fremd.txt');
    expect(files).not.toContain('schichtplaner-20260102-000000.db');
  });
});

describe('Beispieldaten', () => {
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;

  it('lassen sich einfügen und vollständig entfernen, echte Daten bleiben erhalten', async () => {
    const before = { departments: count('departments'), teams: count('teams'), employees: count('employees'), users: count('users') };
    db.prepare("INSERT INTO entries(employee_id, date, type_id, created_by) VALUES (?, '2026-11-10', ?, ?)").run(ids.eA, ids.typeF, ids.admin);
    const admin = await login('admin');

    expect((await app.inject({ method: 'POST', url: '/api/admin/demo', headers: { cookie: await login('anna') } })).statusCode).toBe(403);

    const res = await app.inject({ method: 'POST', url: '/api/admin/demo', headers: { cookie: admin } });
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s).toMatchObject({ present: true, departments: 3, teams: 6, employees: 20 });
    expect(s.users.map((u: { username: string }) => u.username)).toEqual(['demo.mitarbeiter', 'demo.teamleitung', 'demo.leser']);
    expect(s.entries).toBeGreaterThan(500);
    // gleichnamige Teams in verschiedenen Abteilungen
    expect(count("teams WHERE name = 'Meisterei 1'")).toBe(2);
    // ein zweites Mal geht nicht
    expect((await app.inject({ method: 'POST', url: '/api/admin/demo', headers: { cookie: admin } })).statusCode).toBe(409);

    // Beispiel-Teamleitung kann sich anmelden und arbeitet im Plan (erzeugt Protokolleintrag)
    const loginRes = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'demo.teamleitung', password: 'demo1234' } });
    expect(loginRes.statusCode).toBe(200);
    const leadCookie = `sp_session=${loginRes.cookies.find((c) => c.name === 'sp_session')!.value}`;
    const demoEmp = (db.prepare("SELECT e.id FROM employees e JOIN teams t ON t.id = e.team_id JOIN departments d ON d.id = t.department_id WHERE d.name = 'Beispiel Nord' AND t.name = 'Meisterei 1' LIMIT 1").get() as { id: number }).id;
    expect((await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie: leadCookie }, payload: { employeeId: demoEmp, date: '2026-11-20', text: 'Test' } })).statusCode).toBe(200);
    const auditBefore = count('audit_log');

    const del = await app.inject({ method: 'DELETE', url: '/api/admin/demo', headers: { cookie: admin } });
    expect(del.statusCode).toBe(200);
    expect({ departments: count('departments'), teams: count('teams'), employees: count('employees'), users: count('users') }).toEqual(before);
    expect(count(`entries WHERE employee_id = ${ids.eA}`)).toBe(1); // echter Eintrag noch da
    expect(count('audit_log')).toBe(auditBefore + 1); // Protokoll bleibt, plus Eintrag "entfernt"
    expect((await app.inject({ method: 'GET', url: '/api/admin/demo', headers: { cookie: admin } })).json().present).toBe(false);
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/demo', headers: { cookie: admin } })).statusCode).toBe(409);
  });

  it('werden nicht entfernt, wenn ein echter Mitarbeiter in ein Beispiel-Team verschoben wurde', async () => {
    const admin = await login('admin');
    await app.inject({ method: 'POST', url: '/api/admin/demo', headers: { cookie: admin } });
    const demoTeam = (db.prepare("SELECT t.id FROM teams t JOIN departments d ON d.id = t.department_id WHERE d.name = 'Beispiel Süd' LIMIT 1").get() as { id: number }).id;
    db.prepare('UPDATE employees SET team_id = ? WHERE id = ?').run(demoTeam, ids.eA);
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/demo', headers: { cookie: admin } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Anna A');
    expect(count('employees')).toBe(22); // nichts gelöscht
  });
});
