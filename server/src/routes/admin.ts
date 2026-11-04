import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, requireAdmin, requireUser, type AppContext } from '../app.js';
import { audit, getSetting, setSetting } from '../db.js';
import { hashPassword } from '../auth.js';
import { DemoError, demoSummary, insertDemoData, removeDemoData } from '../demo.js';
import { resyncOfficial } from '../holiday-store.js';
import { createPasswordLink, openLinks, unusablePasswordHash } from '../password-links.js';

const idParam = z.object({ id: z.coerce.number().int() });
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/).nullable().optional();
const level = z.enum(['view', 'edit', 'manage']);

export async function adminRoutes(app: FastifyInstance, { db, hub }: AppContext) {
  /** Führt Änderung aus, protokolliert sie und lässt Live-Clients ihre Stammdaten neu laden. */
  function change<T>(userId: number, entity: string, action: 'create' | 'update' | 'delete', fn: () => { id: number; before?: unknown; after?: unknown; ret?: T }) {
    const r = db.transaction(fn)();
    audit(db, { userId, action, entity, entityId: r.id, before: r.before, after: r.after });
    hub.invalidate();
    hub.broadcast('masterdata', () => ({ entity }));
    return r.ret ?? { id: r.id };
  }

  // ---------- Abteilungen ----------
  const deptBody = z.object({ name: z.string().trim().min(1), sortOrder: z.number().int().default(0) });
  app.post('/api/admin/departments', async (req) => {
    const { user } = requireAdmin(req);
    const b = deptBody.parse(req.body);
    return change(user.id, 'department', 'create', () => {
      const id = Number(db.prepare('INSERT INTO departments(name, sort_order) VALUES (?, ?)').run(b.name, b.sortOrder).lastInsertRowid);
      return { id, after: b };
    });
  });
  app.put('/api/admin/departments/:id', async (req) => {
    const { user } = requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const b = deptBody.parse(req.body);
    return change(user.id, 'department', 'update', () => {
      const before = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
      if (!before) throw new HttpError(404, 'Nicht gefunden');
      db.prepare('UPDATE departments SET name = ?, sort_order = ? WHERE id = ?').run(b.name, b.sortOrder, id);
      return { id, before, after: b };
    });
  });
  app.delete('/api/admin/departments/:id', async (req) => {
    const { user } = requireAdmin(req);
    const { id } = idParam.parse(req.params);
    return change(user.id, 'department', 'delete', () => {
      const n = (db.prepare('SELECT COUNT(*) n FROM teams WHERE department_id = ?').get(id) as { n: number }).n;
      if (n > 0) throw new HttpError(409, 'Abteilung enthält noch Teams');
      const before = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
      db.prepare('DELETE FROM departments WHERE id = ?').run(id);
      return { id, before };
    });
  });

  // ---------- Teams ----------
  const teamBody = z.object({ departmentId: z.number().int(), name: z.string().trim().min(1), sortOrder: z.number().int().default(0) });
  app.post('/api/admin/teams', async (req) => {
    const { user } = requireAdmin(req);
    const b = teamBody.parse(req.body);
    return change(user.id, 'team', 'create', () => {
      const id = Number(
        db.prepare('INSERT INTO teams(department_id, name, sort_order) VALUES (?, ?, ?)').run(b.departmentId, b.name, b.sortOrder).lastInsertRowid,
      );
      return { id, after: b };
    });
  });
  app.put('/api/admin/teams/:id', async (req) => {
    const { user } = requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const b = teamBody.parse(req.body);
    return change(user.id, 'team', 'update', () => {
      const before = db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
      if (!before) throw new HttpError(404, 'Nicht gefunden');
      db.prepare('UPDATE teams SET department_id = ?, name = ?, sort_order = ? WHERE id = ?').run(b.departmentId, b.name, b.sortOrder, id);
      return { id, before, after: b };
    });
  });
  app.delete('/api/admin/teams/:id', async (req) => {
    const { user } = requireAdmin(req);
    const { id } = idParam.parse(req.params);
    return change(user.id, 'team', 'delete', () => {
      const n = (db.prepare('SELECT COUNT(*) n FROM employees WHERE team_id = ?').get(id) as { n: number }).n;
      if (n > 0) throw new HttpError(409, 'Team enthält noch Mitarbeiter');
      const before = db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
      db.prepare("DELETE FROM grants WHERE scope = 'team' AND scope_id = ?").run(id);
      db.prepare('DELETE FROM teams WHERE id = ?').run(id);
      return { id, before };
    });
  });

  // ---------- Mitarbeiter (Recht 'manage' auf das Team genügt) ----------
  const empBody = z.object({
    teamId: z.number().int(),
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    shortName: z.string().trim().max(10).nullable().optional(),
    personnelNo: z.string().trim().max(30).nullable().optional(),
    sortOrder: z.number().int().default(0),
    active: z.boolean().default(true),
    vacationDaysPerYear: z.number().min(0).max(365).default(30),
    entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    exitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  });
  const assertDates = (b: { entryDate?: string | null; exitDate?: string | null }) => {
    if (b.entryDate && b.exitDate && b.exitDate < b.entryDate) throw new HttpError(400, 'Das Austrittsdatum liegt vor dem Eintrittsdatum');
  };
  const empValues = (b: z.infer<typeof empBody>) =>
    [b.teamId, b.firstName, b.lastName, b.shortName || null, b.personnelNo || null, b.sortOrder, b.active ? 1 : 0, b.vacationDaysPerYear, b.entryDate || null, b.exitDate || null] as const;

  function insertEmployee(b: z.infer<typeof empBody>): number {
    assertDates(b);
    return Number(
      db
        .prepare(
          `INSERT INTO employees(team_id, first_name, last_name, short_name, personnel_no, sort_order, active, vacation_days_per_year, entry_date, exit_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...empValues(b)).lastInsertRowid,
    );
  }

  /**
   * Benutzer anlegen. Ohne Passwort: unbenutzbares Passwort + Einrichtungslink, über den der Benutzer
   * sein Passwort selbst festlegt. Mit Passwort: muss bei der ersten Anmeldung geändert werden.
   */
  function insertUser(adminId: number, u: { username: string; displayName: string; employeeId: number | null; isAdmin?: boolean; active?: boolean; password?: string }) {
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(u.username)) throw new HttpError(409, `Benutzername „${u.username}“ ist schon vergeben`);
    const id = Number(
      db
        .prepare(
          `INSERT INTO users(username, display_name, password_hash, employee_id, is_admin, active, must_change_password)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(u.username, u.displayName, u.password ? hashPassword(u.password) : unusablePasswordHash(), u.employeeId, u.isAdmin ? 1 : 0, u.active === false ? 0 : 1, u.password ? 1 : 0)
        .lastInsertRowid,
    );
    const link = u.password ? null : createPasswordLink(db, id, 'setup', adminId);
    return { id, link };
  }

  const accountBody = z.object({ username: z.string().trim().min(2).max(50), displayName: z.string().trim().min(1).optional() });

  app.post('/api/admin/employees', async (req) => {
    const { user, perms } = requireUser(req);
    const b = empBody.extend({ account: accountBody.optional() }).parse(req.body);
    if (!perms.can(b.teamId, 'manage')) throw new HttpError(403, 'Keine Berechtigung für dieses Team');
    if (b.account && !perms.isAdmin) throw new HttpError(403, 'Benutzerkonten können nur Administratoren anlegen');
    return change(user.id, 'employee', 'create', () => {
      const id = insertEmployee(b);
      let account: { userId: number; username: string; link: ReturnType<typeof createPasswordLink> | null } | undefined;
      if (b.account) {
        const displayName = b.account.displayName || `${b.firstName} ${b.lastName}`;
        const u = insertUser(user.id, { username: b.account.username, displayName, employeeId: id });
        audit(db, { userId: user.id, action: 'create', entity: 'user', entityId: u.id, after: { username: b.account.username, displayName, employeeId: id } });
        account = { userId: u.id, username: b.account.username, link: u.link };
      }
      return { id, after: { ...b, account: undefined }, ret: { id, account } };
    });
  });
  app.put('/api/admin/employees/:id', async (req) => {
    const { user, perms } = requireUser(req);
    const { id } = idParam.parse(req.params);
    // outsideEntries: was mit vorhandenen Einträgen vor dem Eintritt bzw. nach dem Austritt geschehen soll
    const b = empBody.extend({ outsideEntries: z.enum(['delete', 'keep']).optional() }).parse(req.body);
    assertDates(b);
    const outside = db
      .prepare('SELECT COUNT(*) n, MIN(date) first, MAX(date) last FROM entries WHERE employee_id = ? AND ((? IS NOT NULL AND date < ?) OR (? IS NOT NULL AND date > ?))')
      .get(id, b.entryDate || null, b.entryDate || null, b.exitDate || null, b.exitDate || null) as { n: number; first: string; last: string };
    if (outside.n > 0 && !b.outsideEntries) {
      throw new HttpError(422, `Es gibt ${outside.n} Einträge außerhalb der Beschäftigung`, { outside: outside.n, first: outside.first, last: outside.last });
    }
    let deleted = 0;
    const result = change(user.id, 'employee', 'update', () => {
      const before = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as { team_id: number } | undefined;
      if (!before) throw new HttpError(404, 'Nicht gefunden');
      if (!perms.can(before.team_id, 'manage') || !perms.can(b.teamId, 'manage')) {
        throw new HttpError(403, 'Keine Berechtigung für dieses Team');
      }
      db.prepare(
        `UPDATE employees SET team_id=?, first_name=?, last_name=?, short_name=?, personnel_no=?, sort_order=?, active=?, vacation_days_per_year=?,
           entry_date=?, exit_date=? WHERE id = ?`,
      ).run(...empValues(b), id);
      if (outside.n > 0 && b.outsideEntries === 'delete') {
        deleted = db
          .prepare('DELETE FROM entries WHERE employee_id = ? AND ((? IS NOT NULL AND date < ?) OR (? IS NOT NULL AND date > ?))')
          .run(id, b.entryDate || null, b.entryDate || null, b.exitDate || null, b.exitDate || null).changes;
      }
      return { id, before, after: { ...b, deletedOutsideEntries: deleted || undefined } };
    });
    if (deleted) hub.broadcast('masterdata', () => ({ entity: 'employee', reloadEntries: true })); // offene Pläne neu laden
    return { ...result, deletedOutsideEntries: deleted };
  });
  app.delete('/api/admin/employees/:id', async (req) => {
    const { user } = requireAdmin(req); // endgültiges Löschen inkl. aller Einträge nur durch Admins
    const { id } = idParam.parse(req.params);
    return change(user.id, 'employee', 'delete', () => {
      const before = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
      if (!before) throw new HttpError(404, 'Nicht gefunden');
      db.prepare('DELETE FROM employees WHERE id = ?').run(id);
      return { id, before };
    });
  });

  // ---------- Eintragsarten ----------
  const typeBody = z.object({
    code: z.string().trim().min(1).max(6),
    name: z.string().trim().min(1),
    category: z.enum(['shift', 'presence', 'absence']),
    color: color.default('#cccccc'),
    textColor: color.default('#000000'),
    startTime: time,
    endTime: time,
    countsAsVacation: z.boolean().default(false),
    sensitive: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
    active: z.boolean().default(true),
  });
  const typeValues = (b: z.infer<typeof typeBody>) =>
    [b.code, b.name, b.category, b.color, b.textColor, b.startTime ?? null, b.endTime ?? null, b.countsAsVacation ? 1 : 0, b.sensitive ? 1 : 0, b.sortOrder, b.active ? 1 : 0] as const;

  app.post('/api/admin/entry-types', async (req) => {
    const { user } = requireAdmin(req);
    const b = typeBody.parse(req.body);
    return change(user.id, 'entry_type', 'create', () => {
      const id = Number(
        db
          .prepare(
            `INSERT INTO entry_types(code, name, category, color, text_color, start_time, end_time, counts_as_vacation, sensitive, sort_order, active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(...typeValues(b)).lastInsertRowid,
      );
      return { id, after: b };
    });
  });
  app.put('/api/admin/entry-types/:id', async (req) => {
    const { user } = requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const b = typeBody.parse(req.body);
    return change(user.id, 'entry_type', 'update', () => {
      const before = db.prepare('SELECT * FROM entry_types WHERE id = ?').get(id);
      if (!before) throw new HttpError(404, 'Nicht gefunden');
      db.prepare(
        `UPDATE entry_types SET code=?, name=?, category=?, color=?, text_color=?, start_time=?, end_time=?, counts_as_vacation=?, sensitive=?, sort_order=?, active=?
         WHERE id = ?`,
      ).run(...typeValues(b), id);
      return { id, before, after: b };
    });
  });

  // ---------- Benutzer & Berechtigungen ----------
  app.get('/api/admin/users', async (req) => {
    requireAdmin(req);
    const users = db
      .prepare(
        `SELECT id, username, display_name AS displayName, employee_id AS employeeId, is_admin AS isAdmin, active,
                must_change_password AS mustChangePassword, created_at AS createdAt FROM users ORDER BY display_name`,
      )
      .all() as Record<string, unknown>[];
    const grants = db.prepare('SELECT id, user_id AS userId, scope, scope_id AS scopeId, level FROM grants').all() as { userId: number }[];
    const links = openLinks(db);
    return users.map((u) => ({
      ...u,
      pendingLink: links.get(u.id as number) ?? null,
      isAdmin: !!u.isAdmin,
      active: !!u.active,
      mustChangePassword: !!u.mustChangePassword,
      grants: grants.filter((g) => g.userId === u.id),
    }));
  });

  const userBody = z.object({
    username: z.string().trim().min(2).max(50),
    displayName: z.string().trim().min(1),
    employeeId: z.number().int().nullable().optional(),
    isAdmin: z.boolean().default(false),
    active: z.boolean().default(true),
    password: z.string().min(8).optional(),
    grants: z
      .array(z.object({ scope: z.enum(['team', 'department', 'all']), scopeId: z.number().int().nullable().optional(), level }))
      .default([]),
  });

  function writeGrants(userId: number, grants: z.infer<typeof userBody>['grants']) {
    db.prepare('DELETE FROM grants WHERE user_id = ?').run(userId);
    const ins = db.prepare('INSERT OR REPLACE INTO grants(user_id, scope, scope_id, level) VALUES (?, ?, ?, ?)');
    for (const g of grants) {
      if (g.scope !== 'all' && g.scopeId == null) throw new HttpError(400, 'Freigabe ohne Team/Abteilung');
      ins.run(userId, g.scope, g.scope === 'all' ? null : g.scopeId, g.level);
    }
  }

  app.post('/api/admin/users', async (req) => {
    const { user } = requireAdmin(req);
    // ohne Passwort -> Einrichtungslink; mit newEmployee wird der Mitarbeiter gleich mit angelegt
    const b = userBody.extend({ newEmployee: empBody.optional() }).parse(req.body);
    if (b.newEmployee && b.employeeId) throw new HttpError(400, 'Entweder vorhandenen Mitarbeiter verknüpfen oder neuen anlegen');
    return change(user.id, 'user', 'create', () => {
      let employeeId = b.employeeId ?? null;
      if (b.newEmployee) {
        employeeId = insertEmployee(b.newEmployee);
        audit(db, { userId: user.id, action: 'create', entity: 'employee', entityId: employeeId, after: b.newEmployee });
      }
      const u = insertUser(user.id, { username: b.username, displayName: b.displayName, employeeId, isAdmin: b.isAdmin, active: b.active, password: b.password });
      writeGrants(u.id, b.grants);
      return { id: u.id, after: { ...b, password: b.password ? '***' : undefined }, ret: { id: u.id, employeeId, link: u.link } };
    });
  });

  /** Neuen Einrichtungs- bzw. Zurücksetz-Link erzeugen (alte Links werden ungültig). */
  app.post('/api/admin/users/:id/password-link', async (req) => {
    const { user } = requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const b = z.object({ purpose: z.enum(['setup', 'reset']).default('reset') }).parse(req.body ?? {});
    const u = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(id) as { username: string; display_name: string } | undefined;
    if (!u) throw new HttpError(404, 'Nicht gefunden');
    const link = createPasswordLink(db, id, b.purpose, user.id);
    audit(db, { userId: user.id, action: 'update', entity: 'user', entityId: id, after: { username: u.username, passwordLink: b.purpose } });
    return { userId: id, username: u.username, displayName: u.display_name, link };
  });

  app.put('/api/admin/users/:id', async (req) => {
    const { user } = requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const b = userBody.parse(req.body);
    if (id === user.id && (!b.isAdmin || !b.active)) throw new HttpError(400, 'Eigene Administratorrechte können nicht entzogen werden');
    return change(user.id, 'user', 'update', () => {
      const before = db.prepare('SELECT id, username, display_name, employee_id, is_admin, active FROM users WHERE id = ?').get(id);
      if (!before) throw new HttpError(404, 'Nicht gefunden');
      db.prepare('UPDATE users SET username=?, display_name=?, employee_id=?, is_admin=?, active=? WHERE id = ?').run(
        b.username,
        b.displayName,
        b.employeeId ?? null,
        b.isAdmin ? 1 : 0,
        b.active ? 1 : 0,
        id,
      );
      if (b.password) {
        db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hashPassword(b.password), id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      }
      if (!b.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      writeGrants(id, b.grants);
      return { id, before, after: { ...b, password: b.password ? '***' : undefined } };
    });
  });

  // ---------- Beispieldaten ----------
  app.get('/api/admin/demo', async (req) => {
    requireAdmin(req);
    return demoSummary(db);
  });
  const demoAction = (userId: number, action: 'create' | 'delete', fn: () => unknown) => {
    let result: unknown;
    try {
      result = fn();
    } catch (e) {
      if (e instanceof DemoError) throw new HttpError(409, e.message);
      throw e;
    }
    audit(db, { userId, action, entity: 'demo_data', entityId: null, after: action === 'create' ? result : undefined, before: action === 'delete' ? result : undefined });
    hub.invalidate();
    // offene Pläne laden Stammdaten und Einträge neu
    hub.broadcast('masterdata', () => ({ entity: 'demo_data', reloadEntries: true }));
    return result;
  };
  app.post('/api/admin/demo', async (req) => {
    const { user } = requireAdmin(req);
    return demoAction(user.id, 'create', () => insertDemoData(db));
  });
  app.delete('/api/admin/demo', async (req) => {
    const { user } = requireAdmin(req);
    return demoAction(user.id, 'delete', () => removeDemoData(db));
  });

  // ---------- Ansprechpartner bei Anmeldeproblemen ----------
  const contactBody = z.object({
    name: z.string().trim().max(100).default(''),
    phone: z.string().trim().max(50).default(''),
    email: z.string().trim().max(100).default(''),
    note: z.string().trim().max(300).default(''),
  });
  app.get('/api/admin/support-contact', async (req) => {
    requireAdmin(req);
    return contactBody.parse(JSON.parse(getSetting(db, 'support_contact', '{}')));
  });
  app.put('/api/admin/support-contact', async (req) => {
    const { user } = requireAdmin(req);
    const b = contactBody.parse(req.body);
    return change(user.id, 'settings', 'update', () => {
      setSetting(db, 'support_contact', JSON.stringify(b));
      return { id: 0, after: { supportContact: b }, ret: b };
    });
  });

  // ---------- Einstellungen ----------
  app.get('/api/admin/settings', async (req) => {
    requireAdmin(req);
    return {
      holidayState: getSetting(db, 'holiday_state', 'NW'),
      ownTeamLevel: getSetting(db, 'own_team_level', 'edit'),
      defaultLevel: getSetting(db, 'default_level', 'view'),
      planStart: getSetting(db, 'plan_start', '') || null,
    };
  });
  app.put('/api/admin/settings', async (req) => {
    const { user } = requireAdmin(req);
    const b = z
      .object({
        holidayState: z.enum(['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH']),
        ownTeamLevel: z.enum(['none', 'view', 'edit', 'manage']),
        defaultLevel: z.enum(['none', 'view', 'edit']),
        planStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      })
      .parse(req.body);
    const stateChanged = b.holidayState !== getSetting(db, 'holiday_state', 'NW');
    const result = change(user.id, 'settings', 'update', () => {
      setSetting(db, 'holiday_state', b.holidayState);
      // neues Bundesland: unveränderte gesetzliche Feiertage in allen eingerichteten Jahren austauschen
      if (stateChanged) resyncOfficial(db);
      setSetting(db, 'own_team_level', b.ownTeamLevel);
      setSetting(db, 'default_level', b.defaultLevel);
      if (b.planStart !== undefined) setSetting(db, 'plan_start', b.planStart ?? '');
      return { id: 0, after: b, ret: b };
    });
    if (stateChanged) hub.broadcast('holidays', () => ({}));
    return result;
  });
}
