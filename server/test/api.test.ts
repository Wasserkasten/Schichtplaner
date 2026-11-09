import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb, type DB } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { ensureEntryTypes } from '../src/seed-lib.js';
import { holidays, easterSunday } from '../src/holidays.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: DB;
let app: FastifyInstance;
let ids: Record<string, number>;
let backupDir: string;

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
  backupDir = mkdtempSync(join(tmpdir(), 'sp-bk-'));
  ({ app } = await buildApp({ db, backupDir }));
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

describe('Backups über die Oberfläche', () => {
  it('Zeitplan: letzter fälliger Termin', async () => {
    const { lastSlot, nextSlot, defaultSchedule } = await import('../src/backup.js');
    const base = { ...defaultSchedule(), time: '02:30' };
    const now = new Date(2026, 10, 6, 10, 0); // Fr 06.11.2026 10:00 (lokal)
    expect(lastSlot({ ...base, mode: 'daily' }, now)).toEqual(new Date(2026, 10, 6, 2, 30));
    expect(lastSlot({ ...base, mode: 'daily' }, new Date(2026, 10, 6, 1, 0))).toEqual(new Date(2026, 10, 5, 2, 30));
    expect(lastSlot({ ...base, mode: 'hourly' }, now)).toEqual(new Date(2026, 10, 6, 9, 30));
    expect(lastSlot({ ...base, mode: 'weekly', weekday: 1 }, now)).toEqual(new Date(2026, 10, 2, 2, 30)); // Montag
    expect(lastSlot({ ...base, mode: 'weekly', weekday: 5 }, new Date(2026, 10, 6, 1, 0))).toEqual(new Date(2026, 9, 30, 2, 30));
    expect(nextSlot({ ...base, mode: 'daily' }, now)).toEqual(new Date(2026, 10, 7, 2, 30));
    expect(lastSlot({ ...base, mode: 'off' }, now)).toBeNull();
  });

  it('nur für Administratoren', async () => {
    const cookie = await login('anna');
    expect((await app.inject({ method: 'GET', url: '/api/admin/backups', headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/admin/backups', headers: { cookie } })).statusCode).toBe(403);
  });

  it('Jetzt sichern, Liste, Herunterladen, Löschen', async () => {
    const cookie = await login('admin');
    const made = await app.inject({ method: 'POST', url: '/api/admin/backups', headers: { cookie } });
    expect(made.statusCode).toBe(200);
    const name = made.json().name as string;
    expect(name).toMatch(/^manuell-\d{8}-\d{6}\.db$/);
    const list = (await app.inject({ method: 'GET', url: '/api/admin/backups', headers: { cookie } })).json();
    expect(list.files).toHaveLength(1);
    expect(list.files[0]).toMatchObject({ name, kind: 'manual' });
    expect(list.last.ok).toBe(true);
    const dl = await app.inject({ method: 'GET', url: `/api/admin/backups/${name}/download`, headers: { cookie } });
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3');
    // kein Ausbrechen aus dem Ordner
    expect((await app.inject({ method: 'GET', url: '/api/admin/backups/..%2F..%2Fetc%2Fpasswd/download', headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/backups/${name}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/admin/backups', headers: { cookie } })).json().files).toHaveLength(0);
  });

  it('Zeitplan speichern und prüfen', async () => {
    const cookie = await login('admin');
    const ok = await app.inject({ method: 'PUT', url: '/api/admin/backups/schedule', headers: { cookie }, payload: { mode: 'weekly', time: '23:15', weekday: 0, keep: 8, extraDir: '' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().next).toBeTruthy();
    const bad = await app.inject({ method: 'PUT', url: '/api/admin/backups/schedule', headers: { cookie }, payload: { mode: 'daily', time: '25:00', weekday: 0, keep: 8, extraDir: '' } });
    expect(bad.statusCode).toBe(400);
    const rel = await app.inject({ method: 'PUT', url: '/api/admin/backups/schedule', headers: { cookie }, payload: { mode: 'daily', time: '02:00', weekday: 0, keep: 8, extraDir: 'nas' } });
    expect(rel.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/admin/backups', headers: { cookie } })).json().schedule).toMatchObject({ mode: 'weekly', keep: 8 });
  });

  it('Einspielen im laufenden Betrieb: Stand zurück, Anmeldung bleibt, Sicherheitskopie', async () => {
    const cookie = await login('admin');
    await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie }, payload: { employeeId: ids.eA, date: '2026-11-02', typeId: ids.typeF } });
    const name = (await app.inject({ method: 'POST', url: '/api/admin/backups', headers: { cookie } })).json().name as string;
    // danach: weiterer Eintrag + Mitarbeiter umbenannt
    await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie }, payload: { employeeId: ids.eA, date: '2026-11-03', typeId: ids.typeK } });
    db.prepare("UPDATE employees SET last_name = 'Neu' WHERE id = ?").run(ids.eA);
    const res = await app.inject({ method: 'POST', url: `/api/admin/backups/${name}/restore`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().safety).toMatch(/^vor-wiederherstellung-/);
    const dates = (db.prepare('SELECT date FROM entries WHERE employee_id = ? ORDER BY date').all(ids.eA) as { date: string }[]).map((r) => r.date);
    expect(dates).toEqual(['2026-11-02']);
    expect((db.prepare('SELECT last_name FROM employees WHERE id = ?').get(ids.eA) as { last_name: string }).last_name).toBe('A');
    // weiterhin angemeldet, Protokoll enthält das Einspielen
    expect((await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie } })).statusCode).toBe(200);
    expect(db.prepare("SELECT 1 FROM audit_log WHERE entity = 'backup' AND after_json LIKE ?").get(`%${name}%`)).toBeTruthy();
    // Sicherheitskopie steht in der Liste
    const kinds = (await app.inject({ method: 'GET', url: '/api/admin/backups', headers: { cookie } })).json().files.map((f: { kind: string }) => f.kind);
    expect(kinds.sort()).toEqual(['manual', 'safety']);
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
  });

  it('Hochladen prüft die Datei', async () => {
    const cookie = await login('admin');
    const junk = await app.inject({ method: 'POST', url: '/api/admin/backups/upload', headers: { cookie, 'content-type': 'application/octet-stream' }, payload: Buffer.from('kein sqlite') });
    expect(junk.statusCode).toBe(400);
    const name = (await app.inject({ method: 'POST', url: '/api/admin/backups', headers: { cookie } })).json().name as string;
    const data = (await app.inject({ method: 'GET', url: `/api/admin/backups/${name}/download`, headers: { cookie } })).rawPayload;
    const up = await app.inject({ method: 'POST', url: '/api/admin/backups/upload', headers: { cookie, 'content-type': 'application/octet-stream' }, payload: data });
    expect(up.statusCode).toBe(200);
    expect(up.json().name).toMatch(/^hochgeladen-/);
    const files = (await app.inject({ method: 'GET', url: '/api/admin/backups', headers: { cookie } })).json().files;
    expect(files.map((f: { kind: string }) => f.kind).sort()).toEqual(['manual', 'upload']);
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

describe('Feiertage verwalten', () => {
  const holidaysOf = async (cookie: string, year: number) =>
    (await app.inject({ method: 'GET', url: `/api/holidays?year=${year}`, headers: { cookie } })).json() as { id: number; date: string; name: string; kind: string; fromSource: boolean }[];

  it('Jahr wird beim ersten Abruf automatisch mit gesetzlichen Feiertagen befüllt', async () => {
    const list = await holidaysOf(await login('anna'), 2027);
    expect(list.find((h) => h.name === 'Fronleichnam')).toMatchObject({ kind: 'public', fromSource: true }); // NW
    expect(list.some((h) => h.name === 'Rosenmontag')).toBe(false); // kein Feiertag
  });

  it('Quelle bietet arbeitsfreie Tage an; Übernehmen, Anlegen, Ändern, Löschen', async () => {
    const admin = await login('admin');
    const src = (await app.inject({ method: 'GET', url: '/api/admin/holidays/source?year=2027', headers: { cookie: admin } })).json();
    const rosen = src.items.find((i: { name: string }) => i.name === 'Rosenmontag');
    expect(rosen).toMatchObject({ date: '2027-02-08', kind: 'company', group: 'common', status: 'missing' });
    expect(src.items.find((i: { name: string }) => i.name === 'Neujahr').status).toBe('present');

    const pick = src.items.filter((i: { name: string }) => ['Rosenmontag', 'Heiligabend', 'Silvester'].includes(i.name));
    const imp = await app.inject({ method: 'POST', url: '/api/admin/holidays/import', headers: { cookie: admin }, payload: { year: 2027, items: pick } });
    expect(imp.json()).toEqual({ imported: 3, removed: 0 });

    const created = await app.inject({ method: 'POST', url: '/api/admin/holidays', headers: { cookie: admin }, payload: { date: '2027-06-18', name: 'Betriebsausflug', kind: 'company' } });
    expect(created.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/admin/holidays', headers: { cookie: admin }, payload: { date: '2027-06-18', name: 'Doppelt', kind: 'company' } })).statusCode).toBe(409);

    let list = await holidaysOf(admin, 2027);
    const neujahr = list.find((h) => h.name === 'Neujahr')!;
    await app.inject({ method: 'PUT', url: `/api/admin/holidays/${neujahr.id}`, headers: { cookie: admin }, payload: { date: neujahr.date, name: 'Neujahr (Betrieb geschlossen)', kind: 'public' } });
    const allerheiligen = list.find((h) => h.name === 'Allerheiligen')!;
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/holidays/${allerheiligen.id}`, headers: { cookie: admin } })).statusCode).toBe(200);

    list = await holidaysOf(admin, 2027);
    expect(list.find((h) => h.date === '2027-12-24')).toMatchObject({ name: 'Heiligabend', kind: 'company' });
    expect(list.find((h) => h.date === '2027-06-18')).toMatchObject({ name: 'Betriebsausflug', fromSource: false });
    expect(list.find((h) => h.date === '2027-01-01')).toMatchObject({ name: 'Neujahr (Betrieb geschlossen)', fromSource: false });
    expect(list.some((h) => h.name === 'Allerheiligen')).toBe(false);
    // gelöschter Feiertag wird nicht von selbst wieder angelegt
    expect((await holidaysOf(admin, 2027)).some((h) => h.name === 'Allerheiligen')).toBe(false);
  });

  it('nur Administratoren dürfen ändern', async () => {
    const anna = await login('anna');
    expect((await app.inject({ method: 'POST', url: '/api/admin/holidays', headers: { cookie: anna }, payload: { date: '2027-06-18', name: 'X', kind: 'company' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/admin/holidays/source?year=2027', headers: { cookie: anna } })).statusCode).toBe(403);
  });

  it('Wechsel des Bundeslandes tauscht nur unveränderte gesetzliche Feiertage aus', async () => {
    const admin = await login('admin');
    await holidaysOf(admin, 2027); // Jahr einrichten (NW)
    await app.inject({ method: 'POST', url: '/api/admin/holidays', headers: { cookie: admin }, payload: { date: '2027-12-24', name: 'Heiligabend', kind: 'company' } });
    const res = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie: admin }, payload: { holidayState: 'SN', ownTeamLevel: 'edit', defaultLevel: 'view' } });
    expect(res.statusCode).toBe(200);
    const names = (await holidaysOf(admin, 2027)).map((h) => h.name);
    expect(names).toContain('Buß- und Bettag'); // neu (SN)
    expect(names).toContain('Reformationstag'); // neu (SN)
    expect(names).not.toContain('Fronleichnam'); // NW-Feiertag entfernt
    expect(names).toContain('Heiligabend'); // eigener Eintrag bleibt
  });
});

describe('Quelle', () => {
  it('liefert regionale Feiertage gesondert', async () => {
    const { sourceDays } = await import('../src/holidays.js');
    const by = sourceDays(2026, 'BY');
    expect(by.find((d) => d.name === 'Mariä Himmelfahrt')).toMatchObject({ group: 'regional', date: '2026-08-15' });
    expect(by.find((d) => d.name === 'Heiligabend')).toMatchObject({ group: 'common', kind: 'company' });
    expect(by.find((d) => d.name === 'Rosenmontag')!.date).toBe('2026-02-16');
  });
});

describe('Mehrere Dienste pro Tag', () => {
  const typeId = (code: string) => (db.prepare('SELECT id FROM entry_types WHERE code = ?').get(code) as { id: number }).id;
  const post = (cookie: string, payload: object) => app.inject({ method: 'POST', url: '/api/entries', headers: { cookie }, payload });

  it('bis zu drei Dienste, keine doppelte Eintragsart, Notizen zählen nicht mit', async () => {
    const cookie = await login('anna');
    const cell = { employeeId: ids.eA, date: '2026-11-12' };
    for (const c of ['F', 'B', 'HO']) expect((await post(cookie, { ...cell, typeId: typeId(c) })).statusCode).toBe(200);
    expect((await post(cookie, { ...cell, typeId: typeId('F') })).json().error).toContain('bereits eingetragen');
    const fourth = await post(cookie, { ...cell, typeId: typeId('S') });
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json().error).toContain('Höchstens 3');
    expect((await post(cookie, { ...cell, text: 'Notiz geht trotzdem' })).statusCode).toBe(200);
  });

  it('Ändern in eine volle Zelle wird abgelehnt', async () => {
    const cookie = await login('anna');
    for (const c of ['F', 'B', 'HO']) await post(cookie, { employeeId: ids.eA, date: '2026-11-13', typeId: typeId(c) });
    const other = (await post(cookie, { employeeId: ids.eA, date: '2026-11-14', typeId: typeId('S') })).json();
    const res = await app.inject({ method: 'PATCH', url: `/api/entries/${other.id}`, headers: { cookie }, payload: { version: other.version, date: '2026-11-13' } });
    expect(res.statusCode).toBe(409);
  });

  it('Pinsel "hinzufügen" ergänzt und überspringt volle bzw. schon belegte Tage', async () => {
    const cookie = await login('anna');
    await post(cookie, { employeeId: ids.eA, date: '2026-11-16', typeId: typeId('F') });
    for (const c of ['F', 'B', 'HO']) await post(cookie, { employeeId: ids.eA, date: '2026-11-17', typeId: typeId(c) });
    const res = await app.inject({
      method: 'POST', url: '/api/entries/bulk', headers: { cookie },
      payload: { action: 'add', typeId: typeId('B'), cells: ['2026-11-15', '2026-11-16', '2026-11-17'].map((date) => ({ employeeId: ids.eA, date })) },
    });
    expect(res.json()).toMatchObject({ skipped: 1 });
    expect(res.json().created).toHaveLength(2);
    const day16 = db.prepare("SELECT COUNT(*) n FROM entries WHERE employee_id = ? AND date = '2026-11-16'").get(ids.eA) as { n: number };
    expect(day16.n).toBe(2); // F + B
  });
});

describe('Persönliche Einstellungen', () => {
  it('Schriftgröße wird je Benutzer gespeichert', async () => {
    const cookie = await login('anna');
    expect((await app.inject({ method: 'PUT', url: '/api/me/preferences', headers: { cookie }, payload: { fontScale: 1.3 } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie } })).json().me.fontScale).toBe(1.3);
    expect((await app.inject({ method: 'PUT', url: '/api/me/preferences', headers: { cookie }, payload: { fontScale: 5 } })).statusCode).toBe(400);
  });

  it('bestehende Datenbank ohne Spalte wird beim Öffnen ergänzt', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const Database = (await import('better-sqlite3')).default;
    const file = join(mkdtempSync(join(tmpdir(), 'sp-mig-')), 'alt.db');
    const old = new Database(file);
    old.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, employee_id INTEGER, is_admin INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
    old.close();
    const migrated = openDb(file);
    const cols = (migrated.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('font_scale');
  });
});

describe('Rückgängig', () => {
  const typeId = (code: string) => (db.prepare('SELECT id FROM entry_types WHERE code = ?').get(code) as { id: number }).id;
  const cellCodes = (date: string) =>
    (db.prepare('SELECT t.code FROM entries e JOIN entry_types t ON t.id = e.type_id WHERE e.employee_id = ? AND e.date = ? ORDER BY t.code').all(ids.eA, date) as { code: string }[]).map((r) => r.code).join(',');
  const undo = (cookie: string, changeId: string) => app.inject({ method: 'POST', url: `/api/changes/${changeId}/undo`, headers: { cookie } });

  it('nimmt einen Pinselstrich über mehrere Tage komplett zurück – und wieder her', async () => {
    const cookie = await login('anna');
    for (const date of ['2026-12-01', '2026-12-02']) await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie }, payload: { employeeId: ids.eA, date, typeId: typeId('F') } });
    const bulk = (await app.inject({
      method: 'POST', url: '/api/entries/bulk', headers: { cookie },
      payload: { action: 'set', typeId: typeId('U'), cells: ['2026-12-01', '2026-12-02', '2026-12-03'].map((date) => ({ employeeId: ids.eA, date })) },
    })).json();
    expect([cellCodes('2026-12-01'), cellCodes('2026-12-03')]).toEqual(['U', 'U']);

    const u = await undo(cookie, bulk.changeId);
    expect(u.statusCode).toBe(200);
    expect([cellCodes('2026-12-01'), cellCodes('2026-12-02'), cellCodes('2026-12-03')]).toEqual(['F', 'F', '']);
    expect((await undo(cookie, bulk.changeId)).statusCode).toBe(409); // schon zurückgenommen

    const redo = await undo(cookie, u.json().changeId); // Rücknahme zurücknehmen = wiederholen
    expect(redo.statusCode).toBe(200);
    expect([cellCodes('2026-12-01'), cellCodes('2026-12-03')]).toEqual(['U', 'U']);
  });

  it('Änderung eines Eintrags zurücknehmen', async () => {
    const cookie = await login('anna');
    const e = (await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie }, payload: { employeeId: ids.eA, date: '2026-12-05', typeId: typeId('F') } })).json();
    const p = (await app.inject({ method: 'PATCH', url: `/api/entries/${e.id}`, headers: { cookie }, payload: { version: e.version, typeId: typeId('S') } })).json();
    expect((await undo(cookie, p.changeId)).statusCode).toBe(200);
    expect(cellCodes('2026-12-05')).toBe('F');
    const d = (await app.inject({ method: 'DELETE', url: `/api/entries/${e.id}`, headers: { cookie } })).json();
    expect((await undo(cookie, d.changeId)).statusCode).toBe(200);
    expect(cellCodes('2026-12-05')).toBe('F');
  });

  it('verweigert, wenn jemand anderes den Eintrag inzwischen geändert hat', async () => {
    const anna = await login('anna');
    const lead = await login('lead');
    const e = (await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie: anna }, payload: { employeeId: ids.eA, date: '2026-12-06', typeId: typeId('F') } })).json();
    await app.inject({ method: 'PATCH', url: `/api/entries/${e.id}`, headers: { cookie: lead }, payload: { version: e.version, typeId: typeId('N') } });
    const res = await undo(anna, e.changeId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Lead');
    expect(cellCodes('2026-12-06')).toBe('N'); // nichts verändert
  });

  it('fremde Änderungen nur als Administrator', async () => {
    const anna = await login('anna');
    const e = (await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie: anna }, payload: { employeeId: ids.eA, date: '2026-12-07', typeId: typeId('F') } })).json();
    expect((await undo(await login('lead'), e.changeId)).statusCode).toBe(403);
    expect((await undo(await login('admin'), e.changeId)).statusCode).toBe(200);
  });
});

describe('PDF, Version, Protokoll', () => {
  it('Jahresübersicht als PDF für Mitarbeiter und Team, mit Rechteprüfung', async () => {
    const anna = await login('anna');
    const res = await app.inject({ method: 'GET', url: `/api/pdf/year?year=2026&employeeId=${ids.eA}`, headers: { cookie: anna } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('Jahresuebersicht_2026');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const team = await app.inject({ method: 'GET', url: `/api/pdf/year?year=2026&teamId=${ids.tB}`, headers: { cookie: anna } });
    expect(team.statusCode).toBe(200);
    db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('default_level', 'none')").run();
    expect((await app.inject({ method: 'GET', url: `/api/pdf/year?year=2026&teamId=${ids.tB}`, headers: { cookie: anna } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/pdf/year?year=2026', headers: { cookie: anna } })).statusCode).toBe(400);
  });

  it('Version und Changelog', async () => {
    const pkg = JSON.parse((await import('node:fs')).readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json().version).toBe(pkg.version);
    expect((await app.inject({ method: 'GET', url: '/api/admin/changelog', headers: { cookie: await login('anna') } })).statusCode).toBe(403);
    const cl = (await app.inject({ method: 'GET', url: '/api/admin/changelog', headers: { cookie: await login('admin') } })).json();
    expect(cl.markdown).toContain(`## [${pkg.version}]`);
  });

  it('Gesamtprotokoll mit Namen, Änderungs-ID und Rücknahme-Status', async () => {
    const anna = await login('anna');
    const typeF = ids.typeF;
    const bulk = (await app.inject({ method: 'POST', url: '/api/entries/bulk', headers: { cookie: anna }, payload: { action: 'set', typeId: typeF, cells: ['2026-12-10', '2026-12-11'].map((date) => ({ employeeId: ids.eA, date })) } })).json();
    await app.inject({ method: 'POST', url: `/api/changes/${bulk.changeId}/undo`, headers: { cookie: anna } });
    const log = (await app.inject({ method: 'GET', url: '/api/audit?limit=3', headers: { cookie: await login('admin') } })).json();
    const ofBulk = log.rows.filter((r: { change_id: string }) => r.change_id === bulk.changeId);
    expect(ofBulk).toHaveLength(2); // Änderung nicht über die Seitengrenze zerteilt
    expect(ofBulk[0]).toMatchObject({ employee_name: 'Anna A', user_name: 'Anna' });
    expect(log.undone).toContain(bulk.changeId);
  });
});

describe('Rückgängig – Mischstände vermeiden', () => {
  it('lehnt ab, wenn ein angelegter Eintrag inzwischen von jemand anderem ersetzt wurde', async () => {
    const typeId = (code: string) => (db.prepare('SELECT id FROM entry_types WHERE code = ?').get(code) as { id: number }).id;
    const anna = await login('anna');
    const lead = await login('lead');
    const cell = [{ employeeId: ids.eA, date: '2026-12-20' }];
    await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie: anna }, payload: { ...cell[0], typeId: typeId('F') } });
    const k = (await app.inject({ method: 'POST', url: '/api/entries/bulk', headers: { cookie: anna }, payload: { action: 'set', typeId: typeId('K'), cells: cell } })).json();
    await app.inject({ method: 'POST', url: '/api/entries/bulk', headers: { cookie: lead }, payload: { action: 'set', typeId: typeId('S'), cells: cell } });
    const res = await app.inject({ method: 'POST', url: `/api/changes/${k.changeId}/undo`, headers: { cookie: anna } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Lead');
    const codes = (db.prepare("SELECT t.code FROM entries e JOIN entry_types t ON t.id = e.type_id WHERE e.employee_id = ? AND e.date = '2026-12-20'").all(ids.eA) as { code: string }[]).map((r) => r.code);
    expect(codes).toEqual(['S']); // kein „F S“
  });
});

describe('Neuigkeiten', () => {
  const CL = `# Changelog
## [0.4.0] – 2027-01-10
### Für alle
- Neue Kürzel ab Januar
### Wichtig
- Ab 1.1. gilt **IV** statt **I**.
### Neu
- technische Details
## [0.3.0] – 2026-11-04
### Für alle
- Rückgängig
### Behoben
- etwas Technisches
## [0.2.0] – 2026-11-04
### Neu
- nur Technik
`;

  it('liest „Für alle“ und „Wichtig“ je Version aus dem Changelog', async () => {
    const { parseChangelog, compareVersions } = await import('../src/news.js');
    const n = parseChangelog(CL);
    expect(n.map((x) => x.version)).toEqual(['0.4.0', '0.3.0', '0.2.0']);
    expect(n[0]).toMatchObject({ date: '2027-01-10', forAll: '- Neue Kürzel ab Januar', important: '- Ab 1.1. gilt **IV** statt **I**.' });
    expect(n[2].forAll).toBe('');
    expect(compareVersions('0.10.0', '0.9.1')).toBeGreaterThan(0);
  });

  it('Leiste/Popup je nach Lesestand; neue Konten sehen keine alten Neuigkeiten', async () => {
    const { parseChangelog, newsFor, acknowledgements } = await import('../src/news.js');
    const notes = parseChangelog(CL);
    const user = (seen: string | null, ack: string | null, admin = 0) => ({ seen_version: seen, ack_version: ack, is_admin: admin }) as never;
    // war auf 0.2.0: sieht Neuigkeiten aus 0.3.0 und 0.4.0, dazu das Popup
    const a = newsFor(user('0.2.0', '0.2.0'), notes, '0.4.0');
    expect(a.banner).toBe(true);
    expect(a.unseen.map((x) => x.version)).toEqual(['0.4.0', '0.3.0']);
    expect(a.important.map((x) => x.version)).toEqual(['0.4.0']);
    // gelesen und bestätigt: nichts mehr
    const b = newsFor(user('0.4.0', '0.4.0'), notes, '0.4.0');
    expect([b.banner, b.important.length]).toEqual([false, 0]);
    // Version ohne „Für alle“: Mitarbeiter keine Leiste, Admin schon
    const notesOnlyTech = parseChangelog('## [0.5.0] – x\n### Neu\n- Technik\n');
    expect(newsFor(user('0.4.0', '0.4.0'), notesOnlyTech, '0.5.0').banner).toBe(false);
    expect(newsFor(user('0.4.0', '0.4.0', 1), notesOnlyTech, '0.5.0').banner).toBe(true);
    // Bestätigungen: Anna (aus dem Test-Setup) hat noch nicht bestätigt
    db.prepare('UPDATE users SET ack_version = ?').run('0.4.0');
    db.prepare("UPDATE users SET ack_version = '0.3.0' WHERE username = 'anna'").run();
    expect(acknowledgements(db, notes)).toMatchObject({ version: '0.4.0', total: 3, acknowledged: 2, missing: ['Anna'] });
  });

  it('über die API: gesehen / bestätigt wird am Konto gespeichert, neue Benutzer starten aktuell', async () => {
    const { APP_VERSION } = await import('../src/version.js');
    db.prepare('UPDATE users SET seen_version = NULL, ack_version = NULL').run(); // wie nach einem Update von einer alten Version
    const anna = await login('anna');
    const before = (await app.inject({ method: 'GET', url: '/api/news', headers: { cookie: anna } })).json();
    expect(before.version).toBe(APP_VERSION);
    await app.inject({ method: 'POST', url: '/api/news/seen', headers: { cookie: anna } });
    await app.inject({ method: 'POST', url: '/api/news/ack', headers: { cookie: anna } });
    const after = (await app.inject({ method: 'GET', url: '/api/news', headers: { cookie: anna } })).json();
    expect([after.banner, after.unseen.length, after.important.length]).toEqual([false, 0, 0]);
    // neuer Benutzer über die Verwaltung
    const admin = await login('admin');
    await app.inject({ method: 'POST', url: '/api/admin/users', headers: { cookie: admin }, payload: { username: 'neu', displayName: 'Neu', password: 'geheim123', grants: [] } });
    expect(db.prepare("SELECT seen_version, ack_version FROM users WHERE username = 'neu'").get()).toEqual({ seen_version: APP_VERSION, ack_version: APP_VERSION });
  });
});

describe('Konten anlegen und Einrichtungslinks', () => {
  const info = (token: string) => app.inject({ method: 'POST', url: '/api/password-link/info', payload: { token } });
  const use = (token: string, secret: string, password = 'NeuesPasswort1') => app.inject({ method: 'POST', url: '/api/password-link/use', payload: { token, secret, password } });
  const loginWith = (username: string, password: string) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });

  it('Mitarbeiter mit Konto anlegen; Link mit Personalnummer einlösen; danach angemeldet', async () => {
    const admin = await login('admin');
    const res = await app.inject({
      method: 'POST', url: '/api/admin/employees', headers: { cookie: admin },
      payload: { teamId: ids.tA, firstName: 'Carla', lastName: 'Cramer', personnelNo: '4711', account: { username: 'carla.cramer' } },
    });
    expect(res.statusCode).toBe(200);
    const { account, id: empId } = res.json();
    expect(account).toMatchObject({ username: 'carla.cramer', link: { secretKind: 'personnel_no', purpose: 'setup' } });
    expect(db.prepare('SELECT employee_id, display_name FROM users WHERE username = ?').get('carla.cramer')).toEqual({ employee_id: empId, display_name: 'Carla Cramer' });

    const token = account.link.token;
    expect((await info(token)).json()).toMatchObject({ username: 'carla.cramer', secretLabel: 'Personalnummer', purpose: 'setup' });
    const wrong = await use(token, '1234');
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error).toContain('Noch 4 Versuche');
    const ok = await use(token, ' 4711 ');
    expect(ok.statusCode).toBe(200);
    expect(ok.cookies.some((c) => c.name === 'sp_session')).toBe(true); // gleich angemeldet
    expect((await loginWith('carla.cramer', 'NeuesPasswort1')).statusCode).toBe(200);
    expect((await use(token, '4711')).statusCode).toBe(410); // nur einmal nutzbar
  });

  it('Sperre nach 5 Fehlversuchen, Ablauf, neuer Link macht alten ungültig', async () => {
    const admin = await login('admin');
    db.prepare("UPDATE employees SET short_name = 'AAN' WHERE id = ?").run(ids.eA);
    const mk = async () => (await app.inject({ method: 'POST', url: `/api/admin/users/${ids.anna}/password-link`, headers: { cookie: admin }, payload: {} })).json();
    const l1 = await mk();
    expect(l1.link.secretKind).toBe('short_name');
    for (let i = 0; i < 5; i++) await use(l1.link.token, 'falsch');
    expect((await use(l1.link.token, 'aan')).statusCode).toBe(423); // gesperrt
    const l2 = await mk();
    const l3 = await mk();
    expect((await info(l2.link.token)).statusCode).toBe(404); // durch l3 ersetzt
    db.prepare("UPDATE password_tokens SET expires_at = '2000-01-01T00:00:00Z'").run();
    expect((await info(l3.link.token)).statusCode).toBe(410);
  });

  it('Benutzer mit neuem Mitarbeiter anlegen; ohne Passwort gibt es einen Link', async () => {
    const admin = await login('admin');
    const res = (await app.inject({
      method: 'POST', url: '/api/admin/users', headers: { cookie: admin },
      payload: { username: 'dora', displayName: 'Dora D', grants: [], newEmployee: { teamId: ids.tB, firstName: 'Dora', lastName: 'D', shortName: 'DOD' } },
    })).json();
    expect(res.link).toMatchObject({ secretKind: 'short_name' });
    expect(db.prepare('SELECT team_id FROM employees WHERE id = ?').get(res.employeeId)).toEqual({ team_id: ids.tB });
    const list = (await app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: admin } })).json();
    expect(list.find((u: { username: string }) => u.username === 'dora').pendingLink).toMatchObject({ purpose: 'setup' });
    // Benutzername schon vergeben
    const dup = await app.inject({ method: 'POST', url: '/api/admin/users', headers: { cookie: admin }, payload: { username: 'dora', displayName: 'X', grants: [] } });
    expect(dup.statusCode).toBe(409);
  });

  it('Teamverwalter dürfen Mitarbeiter, aber keine Konten anlegen', async () => {
    db.prepare("INSERT INTO grants(user_id, scope, scope_id, level) VALUES (?, 'team', ?, 'manage')").run(ids.anna, ids.tA);
    const anna = await login('anna');
    const base = { teamId: ids.tA, firstName: 'E', lastName: 'E' };
    expect((await app.inject({ method: 'POST', url: '/api/admin/employees', headers: { cookie: anna }, payload: base })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/admin/employees', headers: { cookie: anna }, payload: { ...base, account: { username: 'e.e' } } })).statusCode).toBe(403);
  });

  it('Ansprechpartner erscheint öffentlich auf der Anmeldeseite', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/public/login-info' })).json()).toEqual({ contact: null });
    const admin = await login('admin');
    await app.inject({ method: 'PUT', url: '/api/admin/support-contact', headers: { cookie: admin }, payload: { name: 'Leitstelle, Herr Meier', phone: '0221 123-45' } });
    expect((await app.inject({ method: 'GET', url: '/api/public/login-info' })).json().contact).toMatchObject({ name: 'Leitstelle, Herr Meier', phone: '0221 123-45', email: '' });
  });
});

describe('Eintritt, Austritt, Planungsbeginn', () => {
  const emp = { teamId: 0, firstName: 'Ina', lastName: 'Intern', entryDate: '2026-03-01', exitDate: '2026-06-30' };
  const mkEmp = async (admin: string, extra: object = {}) =>
    (await app.inject({ method: 'POST', url: '/api/admin/employees', headers: { cookie: admin }, payload: { ...emp, teamId: ids.tA, ...extra } })).json().id as number;

  it('keine Einträge vor dem Eintritt und nach dem Austritt; Pinsel überspringt diese Tage', async () => {
    const admin = await login('admin');
    const id = await mkEmp(admin);
    const post = (date: string) => app.inject({ method: 'POST', url: '/api/entries', headers: { cookie: admin }, payload: { employeeId: id, date, typeId: ids.typeF } });
    const before = await post('2026-02-28');
    expect(before.statusCode).toBe(422);
    expect(before.json().error).toContain('tritt erst am 01.03.2026 ein');
    expect((await post('2026-07-01')).json().error).toContain('am 30.06.2026 ausgetreten');
    expect((await post('2026-03-01')).statusCode).toBe(200);
    const bulk = (await app.inject({
      method: 'POST', url: '/api/entries/bulk', headers: { cookie: admin },
      payload: { action: 'set', typeId: ids.typeF, cells: ['2026-02-27', '2026-02-28', '2026-03-02'].map((date) => ({ employeeId: id, date })) },
    })).json();
    expect([bulk.created.length, bulk.outside]).toEqual([1, 2]);
    expect((await app.inject({ method: 'POST', url: '/api/admin/employees', headers: { cookie: admin }, payload: { ...emp, teamId: ids.tA, exitDate: '2026-01-01' } })).statusCode).toBe(400);
  });

  it('Austritt vorziehen: Rückfrage, dann Einträge danach löschen oder behalten (nur noch löschbar)', async () => {
    const admin = await login('admin');
    const id = await mkEmp(admin, { exitDate: null });
    const e = (await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie: admin }, payload: { employeeId: id, date: '2026-08-10', typeId: ids.typeF } })).json();
    const put = (extra: object) => app.inject({ method: 'PUT', url: `/api/admin/employees/${id}`, headers: { cookie: admin }, payload: { ...emp, teamId: ids.tA, exitDate: '2026-07-31', ...extra } });
    const ask = await put({});
    expect(ask.statusCode).toBe(422);
    expect(ask.json().data).toMatchObject({ outside: 1, first: '2026-08-10' });
    expect((await put({ outsideEntries: 'keep' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/entries/${e.id}`, headers: { cookie: admin }, payload: { version: e.version, text: 'x' } })).statusCode).toBe(422);
    expect((await put({ exitDate: '2026-07-30', outsideEntries: 'delete' })).json().deletedOutsideEntries).toBe(1);
  });

  it('Planungsbeginn: davor nichts eintragbar; Bootstrap liefert Grenzen', async () => {
    const admin = await login('admin');
    await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie: admin }, payload: { holidayState: 'NW', ownTeamLevel: 'edit', defaultLevel: 'view', planStart: '2026-10-01' } });
    const res = await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie: admin }, payload: { employeeId: ids.eA, date: '2026-09-30', typeId: ids.typeF } });
    expect(res.json().error).toContain('vor dem Planungsbeginn am 01.10.2026');
    await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie: admin }, payload: { employeeId: ids.eA, date: '2026-10-05', typeId: ids.typeF } });
    const boot = (await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie: admin } })).json();
    expect(boot.settings).toMatchObject({ planStart: '2026-10-01', dataStart: '2026-10-05' });
  });
});

describe('Leeren mit Auswahl', () => {
  it('entfernt nur die gewählten Eintragsarten bzw. Notizen', async () => {
    const admin = await login('admin');
    const typeId = (code: string) => (db.prepare('SELECT id FROM entry_types WHERE code = ?').get(code) as { id: number }).id;
    const cell = { employeeId: ids.eA, date: '2026-12-15' };
    for (const c of ['F', 'B']) await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie: admin }, payload: { ...cell, typeId: typeId(c) } });
    await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie: admin }, payload: { ...cell, text: 'Notiz' } });
    const clear = (only: object) => app.inject({ method: 'POST', url: '/api/entries/bulk', headers: { cookie: admin }, payload: { action: 'clear', cells: [cell], only } });
    expect((await clear({ typeIds: [typeId('B')] })).json().deleted).toHaveLength(1);
    const left = () => (db.prepare("SELECT COALESCE(t.code, 'Notiz') c FROM entries e LEFT JOIN entry_types t ON t.id = e.type_id WHERE e.employee_id = ? AND e.date = '2026-12-15' ORDER BY c").all(ids.eA) as { c: string }[]).map((r) => r.c);
    expect(left()).toEqual(['F', 'Notiz']);
    await clear({ typeIds: [], notes: true });
    expect(left()).toEqual(['F']);
  });
});

describe('Änderungen an meinem Plan', () => {
  it('meldet Änderungen anderer seit dem letzten Besuch und listet das eigene Protokoll', async () => {
    const anna = await login('anna');
    const lead = await login('lead');
    const summary = async () => (await app.inject({ method: 'GET', url: '/api/me/changes/summary', headers: { cookie: anna } })).json();
    expect(await summary()).toEqual({ count: 0, users: [] }); // erster Aufruf setzt nur den Startpunkt
    // eigene Änderung zählt nicht, die der Teamleitung (Pinsel über 2 Tage = 1 Änderung) schon
    await app.inject({ method: 'POST', url: '/api/entries', headers: { cookie: anna }, payload: { employeeId: ids.eA, date: '2026-12-01', typeId: ids.typeF } });
    await app.inject({ method: 'POST', url: '/api/entries/bulk', headers: { cookie: lead }, payload: { action: 'set', typeId: ids.typeK, cells: ['2026-12-02', '2026-12-03'].map((date) => ({ employeeId: ids.eA, date })) } });
    expect(await summary()).toEqual({ count: 1, users: ['Lead'] });
    const list = (await app.inject({ method: 'GET', url: '/api/me/changes', headers: { cookie: anna } })).json();
    expect(list.rows.map((r: { user_name: string }) => r.user_name)).toEqual(['Lead', 'Lead', 'Anna']);
    expect(list.rows[0].id).toBeGreaterThan(list.seenId); // als neu erkennbar
    await app.inject({ method: 'POST', url: '/api/me/changes/seen', headers: { cookie: anna } });
    expect((await summary()).count).toBe(0);
    // Benutzer ohne verknüpften Mitarbeiter
    expect((await app.inject({ method: 'GET', url: '/api/me/changes', headers: { cookie: lead } })).json().hasEmployee).toBe(false);
  });
});

describe('Schulferien', () => {
  const sample = [
    { startDate: '2025-12-22', endDate: '2026-01-06', name: [{ language: 'DE', text: 'Weihnachtsferien' }] },
    { startDate: '2026-10-17', endDate: '2026-10-31', name: [{ language: 'DE', text: 'Herbstferien' }] },
  ];
  it('aus der Quelle laden, übernehmen, bearbeiten; für alle lesbar', async () => {
    const { vi } = await import('vitest');
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { calls.push(url); return new Response(JSON.stringify(sample), { status: 200 }); });
    try {
      const admin = await login('admin');
      const src = (await app.inject({ method: 'GET', url: '/api/admin/school-holidays/source?year=2026&state=BY', headers: { cookie: admin } })).json();
      expect(calls[0]).toContain('subdivisionCode=DE-BY');
      expect(src.items.map((i: { name: string; status: string }) => `${i.name}:${i.status}`)).toEqual(['Weihnachtsferien:missing', 'Herbstferien:missing']);
      await app.inject({ method: 'POST', url: '/api/admin/school-holidays/import', headers: { cookie: admin }, payload: { state: 'BY', items: src.items.map((i: object) => i) } });
      const again = (await app.inject({ method: 'GET', url: '/api/admin/school-holidays/source?year=2026&state=BY', headers: { cookie: admin } })).json();
      expect(again.items.every((i: { status: string }) => i.status === 'present')).toBe(true);
      // eigener Zeitraum und für alle lesbar (inkl. Jahreswechsel)
      await app.inject({ method: 'POST', url: '/api/admin/school-holidays', headers: { cookie: admin }, payload: { start: '2026-05-15', end: '2026-05-15', name: 'Beweglicher Ferientag' } });
      const anna = await login('anna');
      const y25 = (await app.inject({ method: 'GET', url: '/api/school-holidays?year=2025', headers: { cookie: anna } })).json();
      expect(y25.periods.map((p: { name: string }) => p.name)).toEqual(['Weihnachtsferien']);
      expect((await app.inject({ method: 'GET', url: '/api/school-holidays?year=2026', headers: { cookie: anna } })).json().periods).toHaveLength(3);
      expect((await app.inject({ method: 'POST', url: '/api/admin/school-holidays', headers: { cookie: anna }, payload: { start: '2026-01-01', end: '2026-01-02', name: 'x' } })).statusCode).toBe(403);
      // Quelle nicht erreichbar -> verständliche Meldung
      vi.stubGlobal('fetch', async () => { throw new Error('getaddrinfo ENOTFOUND'); });
      const down = await app.inject({ method: 'GET', url: '/api/admin/school-holidays/source?year=2026', headers: { cookie: admin } });
      expect(down.statusCode).toBe(502);
      expect(down.json().error).toContain('nicht erreichbar');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
