import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser, type AppContext } from '../app.js';
import { getSetting } from '../db.js';
import { APP_VERSION } from '../version.js';
import { dataStart, planStart } from '../employment.js';
import { EntryContext, type EntryRow } from '../entries.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function planRoutes(app: FastifyInstance, { db, hub }: AppContext) {
  /** Alles, was der Client nach dem Login für den Aufbau braucht. */
  app.get('/api/bootstrap', async (req) => {
    const { user, perms } = requireUser(req);
    const visible = new Set(perms.visibleTeamIds());

    const departments = db.prepare('SELECT * FROM departments ORDER BY sort_order, name').all();
    const teams = (
      db.prepare('SELECT * FROM teams ORDER BY sort_order, name').all() as {
        id: number;
        department_id: number;
        name: string;
        sort_order: number;
      }[]
    )
      .filter((t) => visible.has(t.id))
      .map((t) => ({ id: t.id, departmentId: t.department_id, name: t.name, sortOrder: t.sort_order, level: perms.team(t.id) }));

    const employees = (
      db.prepare('SELECT * FROM employees ORDER BY sort_order, last_name, first_name').all() as {
        id: number;
        team_id: number;
        first_name: string;
        last_name: string;
        short_name: string | null;
        personnel_no: string | null;
        sort_order: number;
        active: number;
        vacation_days_per_year: number;
        entry_date: string | null;
        exit_date: string | null;
      }[]
    )
      .filter((e) => visible.has(e.team_id))
      .map((e) => ({
        id: e.id,
        teamId: e.team_id,
        firstName: e.first_name,
        lastName: e.last_name,
        shortName: e.short_name,
        personnelNo: e.personnel_no,
        sortOrder: e.sort_order,
        active: !!e.active,
        vacationDaysPerYear: e.vacation_days_per_year,
        entryDate: e.entry_date,
        exitDate: e.exit_date,
      }));

    const entryTypes = (db.prepare('SELECT * FROM entry_types ORDER BY sort_order, name').all() as Record<string, unknown>[]).map(
      (t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        category: t.category,
        color: t.color,
        textColor: t.text_color,
        startTime: t.start_time,
        endTime: t.end_time,
        countsAsVacation: !!t.counts_as_vacation,
        sensitive: !!t.sensitive,
        sortOrder: t.sort_order,
        active: !!t.active,
      }),
    );

    const users = db.prepare('SELECT id, display_name AS displayName FROM users').all();

    return {
      me: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        employeeId: user.employee_id,
        isAdmin: !!user.is_admin,
        mustChangePassword: !!user.must_change_password,
        fontScale: user.font_scale ?? 1,
        theme: user.theme ?? 'auto',
      },
      permissions: perms.toJSON(),
      departments: (departments as Record<string, unknown>[]).map((d) => ({ id: d.id, name: d.name, sortOrder: d.sort_order })),
      teams,
      employees,
      entryTypes,
      users,
      settings: { holidayState: getSetting(db, 'holiday_state', 'NW'), planStart: planStart(db), dataStart: dataStart(db) },
      version: APP_VERSION,
    };
  });

  /** Einträge eines Zeitraums (optional auf Mitarbeiter eingeschränkt). */
  app.get('/api/entries', async (req) => {
    const { perms } = requireUser(req);
    const q = z
      .object({ from: isoDate, to: isoDate, employeeId: z.coerce.number().int().optional() })
      .parse(req.query);
    const rows = (
      q.employeeId
        ? db
            .prepare('SELECT * FROM entries WHERE date BETWEEN ? AND ? AND employee_id = ? ORDER BY date, id')
            .all(q.from, q.to, q.employeeId)
        : db.prepare('SELECT * FROM entries WHERE date BETWEEN ? AND ? ORDER BY date, id').all(q.from, q.to)
    ) as EntryRow[];
    const ec = new EntryContext(db);
    return rows.map((r) => ec.present(r, perms)).filter((e) => e !== null);
  });

  /** Live-Stream für Änderungen anderer Benutzer. */
  app.get('/api/events', (req, reply) => {
    const { user } = requireUser(req);
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: hello\ndata: {}\n\n`);
    const remove = hub.add(reply, user);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      remove();
    });
  });
}
