import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, requireAdmin, requireUser, type AppContext } from '../app.js';
import { audit, getSetting } from '../db.js';
import { sourceDays } from '../holidays.js';
import { listHolidays, markYear, toHolidayDTO, type HolidayRow } from '../holiday-store.js';

const year = z.coerce.number().int().min(1990).max(2100);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const kind = z.enum(['public', 'company']);
const dayBody = z.object({ date: isoDate, name: z.string().trim().min(1).max(80), kind });

export async function holidayRoutes(app: FastifyInstance, { db, hub }: AppContext) {
  const get = db.prepare('SELECT * FROM holidays WHERE id = ?');

  /** Offene Pläne laden die Feiertage neu. */
  const changed = () => hub.broadcast('holidays', () => ({}));

  // Für alle angemeldeten Benutzer: Feiertage und arbeitsfreie Tage eines Jahres
  app.get('/api/holidays', async (req) => {
    requireUser(req);
    const q = z.object({ year }).parse(req.query);
    return listHolidays(db, q.year).map(toHolidayDTO);
  });

  /** Was die eingebaute Quelle für ein Jahr anbietet – mit Abgleich gegen die gespeicherten Tage. */
  app.get('/api/admin/holidays/source', async (req) => {
    requireAdmin(req);
    const q = z.object({ year }).parse(req.query);
    const state = getSetting(db, 'holiday_state', 'NW');
    const stored = listHolidays(db, q.year);
    const byDate = new Map(stored.map((h) => [h.date, h]));
    const items = sourceDays(q.year, state).map((s) => {
      const cur = byDate.get(s.date);
      return {
        ...s,
        status: !cur ? 'missing' : cur.name === s.name && cur.kind === s.kind ? 'present' : 'different',
        current: cur ? toHolidayDTO(cur) : null,
      };
    });
    const offered = new Set(items.map((i) => i.date));
    // aus der Quelle übernommen, aber dort nicht mehr enthalten (z. B. nach Wechsel des Bundeslandes)
    const obsolete = stored.filter((h) => h.from_source && !offered.has(h.date)).map(toHolidayDTO);
    return { year: q.year, state, items, obsolete };
  });

  /** Ausgewählte Tage aus der Quelle übernehmen (vorhandene am selben Datum werden ersetzt) und ggf. entfernen. */
  app.post('/api/admin/holidays/import', async (req) => {
    const { user } = requireAdmin(req);
    const b = z
      .object({
        year,
        items: z.array(dayBody).max(100),
        removeIds: z.array(z.number().int()).max(100).default([]),
      })
      .parse(req.body);
    if (b.items.some((i) => !i.date.startsWith(`${b.year}-`))) throw new HttpError(400, 'Datum liegt nicht im gewählten Jahr');
    const result = db.transaction(() => {
      let imported = 0;
      for (const i of b.items) {
        db.prepare(
          `INSERT INTO holidays(date, name, kind, from_source) VALUES (?, ?, ?, 1)
           ON CONFLICT(date) DO UPDATE SET name = excluded.name, kind = excluded.kind, from_source = 1`,
        ).run(i.date, i.name, i.kind);
        imported++;
      }
      let removed = 0;
      for (const id of b.removeIds) removed += db.prepare('DELETE FROM holidays WHERE id = ?').run(id).changes;
      markYear(db, b.year);
      return { imported, removed };
    })();
    audit(db, { userId: user.id, action: 'update', entity: 'holidays', entityId: b.year, after: { ...result, items: b.items, removeIds: b.removeIds } });
    changed();
    return result;
  });

  app.post('/api/admin/holidays', async (req) => {
    const { user } = requireAdmin(req);
    const b = dayBody.parse(req.body);
    if (db.prepare('SELECT 1 FROM holidays WHERE date = ?').get(b.date)) throw new HttpError(409, 'Für dieses Datum gibt es bereits einen Eintrag');
    const row = db.transaction(() => {
      markYear(db, Number(b.date.slice(0, 4))); // sonst würde das Jahr später noch automatisch befüllt
      const id = Number(db.prepare('INSERT INTO holidays(date, name, kind, from_source) VALUES (?, ?, ?, 0)').run(b.date, b.name, b.kind).lastInsertRowid);
      return get.get(id) as HolidayRow;
    })();
    audit(db, { userId: user.id, action: 'create', entity: 'holiday', entityId: row.id, date: row.date, after: toHolidayDTO(row) });
    changed();
    return toHolidayDTO(row);
  });

  app.put('/api/admin/holidays/:id', async (req) => {
    const { user } = requireAdmin(req);
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const b = dayBody.parse(req.body);
    const before = get.get(id) as HolidayRow | undefined;
    if (!before) throw new HttpError(404, 'Nicht gefunden');
    if (b.date !== before.date && db.prepare('SELECT 1 FROM holidays WHERE date = ?').get(b.date)) {
      throw new HttpError(409, 'Für dieses Datum gibt es bereits einen Eintrag');
    }
    markYear(db, Number(b.date.slice(0, 4)));
    // geänderte Einträge gehören ab jetzt dir und werden beim Wechsel des Bundeslandes nicht ersetzt
    db.prepare('UPDATE holidays SET date = ?, name = ?, kind = ?, from_source = 0 WHERE id = ?').run(b.date, b.name, b.kind, id);
    const after = get.get(id) as HolidayRow;
    audit(db, { userId: user.id, action: 'update', entity: 'holiday', entityId: id, date: after.date, before: toHolidayDTO(before), after: toHolidayDTO(after) });
    changed();
    return toHolidayDTO(after);
  });

  app.delete('/api/admin/holidays/:id', async (req) => {
    const { user } = requireAdmin(req);
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const before = get.get(id) as HolidayRow | undefined;
    if (!before) throw new HttpError(404, 'Nicht gefunden');
    db.prepare('DELETE FROM holidays WHERE id = ?').run(id);
    audit(db, { userId: user.id, action: 'delete', entity: 'holiday', entityId: id, date: before.date, before: toHolidayDTO(before) });
    changed();
    return { ok: true };
  });
}
