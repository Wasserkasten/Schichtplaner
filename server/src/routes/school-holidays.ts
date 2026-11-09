import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, requireAdmin, requireUser, type AppContext } from '../app.js';
import { audit, setSetting } from '../db.js';
import { SourceError, fetchSchoolHolidays, listSchoolHolidays, schoolHolidayState, toDTO, type SchoolHolidayRow } from '../school-holidays.js';

const STATES = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const year = z.coerce.number().int().min(1990).max(2100);
const period = z.object({ start: isoDate, end: isoDate, name: z.string().trim().min(1).max(80) }).refine((p) => p.end >= p.start, 'Ende liegt vor dem Beginn');

export async function schoolHolidayRoutes(app: FastifyInstance, { db, hub }: AppContext) {
  const changed = () => hub.broadcast('holidays', () => ({})); // offene Pläne laden Feiertage und Ferien neu
  const get = db.prepare('SELECT * FROM school_holidays WHERE id = ?');

  /** Für alle: Ferien, die das Jahr berühren. */
  app.get('/api/school-holidays', async (req) => {
    requireUser(req);
    const q = z.object({ year }).parse(req.query);
    return { state: schoolHolidayState(db), periods: listSchoolHolidays(db, `${q.year}-01-01`, `${q.year}-12-31`).map(toDTO) };
  });

  /** Ferien-Bundesland einstellen. */
  app.put('/api/admin/school-holidays/state', async (req) => {
    const { user } = requireAdmin(req);
    const b = z.object({ state: z.enum(STATES) }).parse(req.body);
    setSetting(db, 'school_holiday_state', b.state);
    audit(db, { userId: user.id, action: 'update', entity: 'settings', entityId: 0, after: { schoolHolidayState: b.state } });
    return { state: b.state };
  });

  /** Ferien eines Jahres aus der Quelle laden und mit den gespeicherten abgleichen (noch nichts speichern). */
  app.get('/api/admin/school-holidays/source', async (req) => {
    requireAdmin(req);
    const q = z.object({ year, state: z.enum(STATES).optional() }).parse(req.query);
    const state = q.state ?? schoolHolidayState(db);
    let periods;
    try {
      periods = await fetchSchoolHolidays(state, q.year);
    } catch (e) {
      if (e instanceof SourceError) throw new HttpError(502, e.message);
      throw e;
    }
    const stored = listSchoolHolidays(db, `${q.year}-01-01`, `${q.year}-12-31`);
    const items = periods.map((p) => {
      const same = stored.find((s) => s.start_date === p.start && s.end_date === p.end);
      const overlapping = stored.find((s) => s.start_date <= p.end && s.end_date >= p.start);
      return { ...p, status: same ? 'present' : overlapping ? 'different' : 'missing', current: overlapping ? toDTO(overlapping) : null };
    });
    return { year: q.year, state, items };
  });

  /** Ausgewählte Zeiträume übernehmen; überlappende eigene/alte Einträge werden ersetzt. */
  app.post('/api/admin/school-holidays/import', async (req) => {
    const { user } = requireAdmin(req);
    const b = z.object({ state: z.enum(STATES), items: z.array(period).max(50) }).parse(req.body);
    const n = db.transaction(() => {
      for (const p of b.items) {
        db.prepare('DELETE FROM school_holidays WHERE start_date <= ? AND end_date >= ?').run(p.end, p.start);
        db.prepare('INSERT INTO school_holidays(start_date, end_date, name, state, from_source) VALUES (?, ?, ?, ?, 1)').run(p.start, p.end, p.name, b.state);
      }
      return b.items.length;
    })();
    audit(db, { userId: user.id, action: 'update', entity: 'school_holidays', entityId: null, after: { state: b.state, imported: n, items: b.items } });
    changed();
    return { imported: n };
  });

  app.post('/api/admin/school-holidays', async (req) => {
    const { user } = requireAdmin(req);
    const p = period.parse(req.body);
    const id = Number(db.prepare('INSERT INTO school_holidays(start_date, end_date, name, state, from_source) VALUES (?, ?, ?, NULL, 0)').run(p.start, p.end, p.name).lastInsertRowid);
    audit(db, { userId: user.id, action: 'create', entity: 'school_holiday', entityId: id, after: p });
    changed();
    return toDTO(get.get(id) as SchoolHolidayRow);
  });

  app.put('/api/admin/school-holidays/:id', async (req) => {
    const { user } = requireAdmin(req);
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const p = period.parse(req.body);
    const before = get.get(id) as SchoolHolidayRow | undefined;
    if (!before) throw new HttpError(404, 'Nicht gefunden');
    db.prepare('UPDATE school_holidays SET start_date = ?, end_date = ?, name = ?, from_source = 0 WHERE id = ?').run(p.start, p.end, p.name, id);
    audit(db, { userId: user.id, action: 'update', entity: 'school_holiday', entityId: id, before: toDTO(before), after: p });
    changed();
    return toDTO(get.get(id) as SchoolHolidayRow);
  });

  app.delete('/api/admin/school-holidays/:id', async (req) => {
    const { user } = requireAdmin(req);
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const before = get.get(id) as SchoolHolidayRow | undefined;
    if (!before) throw new HttpError(404, 'Nicht gefunden');
    db.prepare('DELETE FROM school_holidays WHERE id = ?').run(id);
    audit(db, { userId: user.id, action: 'delete', entity: 'school_holiday', entityId: id, before: toDTO(before) });
    changed();
    return { ok: true };
  });
}
