import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, requireAdmin, requireUser, type AppContext } from '../app.js';
import { audit, getSetting, setSetting } from '../db.js';
import { hashPassword } from '../auth.js';
import { DemoError, demoSummary, insertDemoData, removeDemoData } from '../demo.js';
import { resyncOfficial } from '../holiday-store.js';

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
  });
  const empValues = (b: z.infer<typeof empBody>) =>
    [b.teamId, b.firstName, b.lastName, b.shortName || null, b.personnelNo || null, b.sortOrder, b.active ? 1 : 0, b.vacationDaysPerYear] as const;

  app.post('/api/admin/employees', async (req) => {
    const { user, perms } = requireUser(req);
    const b = empBody.parse(req.body);
    if (!perms.can(b.teamId, 'manage')) throw new HttpError(403, 'Keine Berechtigung für dieses Team');
    return change(user.id, 'employee', 'create', () => {
      const id = Number(
        db
          .prepare(
            `INSERT INTO employees(team_id, first_name, last_name, short_name, personnel_no, sort_order, active, vacation_days_per_year)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(...empValues(b)).lastInsertRowid,
      );
      return { id, after: b };
    });
  });
  app.put('/api/admin/employees/:id', async (req) => {
    const { user, perms } = requireUser(req);
    const { id } = idParam.parse(req.params);
    const b = empBody.parse(req.body);
    return change(user.id, 'employee', 'update', () => {
      const before = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as { team_id: number } | undefined;
      if (!before) throw new HttpError(404, 'Nicht gefunden');
      if (!perms.can(before.team_id, 'manage') || !perms.can(b.teamId, 'manage')) {
        throw new HttpError(403, 'Keine Berechtigung für dieses Team');
      }
      db.prepare(
        `UPDATE employees SET team_id=?, first_name=?, last_name=?, short_name=?, personnel_no=?, sort_order=?, active=?, vacation_days_per_year=?
         WHERE id = ?`,
      ).run(...empValues(b), id);
      return { id, before, after: b };
    });
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
    return users.map((u) => ({
      ...u,
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
    const b = userBody.parse(req.body);
    if (!b.password) throw new HttpError(400, 'Startpasswort erforderlich (mind. 8 Zeichen)');
    return change(user.id, 'user', 'create', () => {
      const id = Number(
        db
          .prepare(
            `INSERT INTO users(username, display_name, password_hash, employee_id, is_admin, active, must_change_password)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
          )
          .run(b.username, b.displayName, hashPassword(b.password!), b.employeeId ?? null, b.isAdmin ? 1 : 0, b.active ? 1 : 0).lastInsertRowid,
      );
      writeGrants(id, b.grants);
      return { id, after: { ...b, password: undefined } };
    });
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

  // ---------- Einstellungen ----------
  app.get('/api/admin/settings', async (req) => {
    requireAdmin(req);
    return {
      holidayState: getSetting(db, 'holiday_state', 'NW'),
      ownTeamLevel: getSetting(db, 'own_team_level', 'edit'),
      defaultLevel: getSetting(db, 'default_level', 'view'),
    };
  });
  app.put('/api/admin/settings', async (req) => {
    const { user } = requireAdmin(req);
    const b = z
      .object({
        holidayState: z.enum(['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH']),
        ownTeamLevel: z.enum(['none', 'view', 'edit', 'manage']),
        defaultLevel: z.enum(['none', 'view', 'edit']),
      })
      .parse(req.body);
    const stateChanged = b.holidayState !== getSetting(db, 'holiday_state', 'NW');
    const result = change(user.id, 'settings', 'update', () => {
      setSetting(db, 'holiday_state', b.holidayState);
      // neues Bundesland: unveränderte gesetzliche Feiertage in allen eingerichteten Jahren austauschen
      if (stateChanged) resyncOfficial(db);
      setSetting(db, 'own_team_level', b.ownTeamLevel);
      setSetting(db, 'default_level', b.defaultLevel);
      return { id: 0, after: b, ret: b };
    });
    if (stateChanged) hub.broadcast('holidays', () => ({}));
    return result;
  });
}
