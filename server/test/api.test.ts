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
