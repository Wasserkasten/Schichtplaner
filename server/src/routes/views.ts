import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, requireUser, type AppContext } from '../app.js';

/**
 * Gespeicherte Ansichten: Ansichtstyp + Filter (Teams, Mitarbeiter, Zeitraum).
 * Eine Ansicht kann als persönliche Standardansicht markiert werden.
 */
const viewConfig = z.object({
  kind: z.enum(['month', 'day', 'year']),
  teamIds: z.array(z.number().int()).default([]),
  employeeId: z.number().int().nullable().optional(),
  // Anzahl Tage in der Kalenderansicht; -1 = so viele, wie in die Fensterbreite passen
  days: z.union([z.literal(-1), z.number().int().min(7).max(62)]).optional(),
  showWeekends: z.boolean().optional(),
});
const viewBody = z.object({
  name: z.string().trim().min(1).max(60),
  config: viewConfig,
  isDefault: z.boolean().default(false),
  shared: z.boolean().default(false),
});

interface ViewRow {
  id: number;
  user_id: number;
  name: string;
  config_json: string;
  is_default: number;
  shared: number;
}

export async function viewRoutes(app: FastifyInstance, { db }: AppContext) {
  const present = (r: ViewRow, me: number) => ({
    id: r.id,
    name: r.name,
    config: JSON.parse(r.config_json),
    isDefault: !!r.is_default && r.user_id === me,
    shared: !!r.shared,
    own: r.user_id === me,
  });

  app.get('/api/views', async (req) => {
    const { user } = requireUser(req);
    const rows = db
      .prepare('SELECT * FROM saved_views WHERE user_id = ? OR shared = 1 ORDER BY name')
      .all(user.id) as ViewRow[];
    return rows.map((r) => present(r, user.id));
  });

  app.post('/api/views', async (req) => {
    const { user } = requireUser(req);
    const b = viewBody.parse(req.body);
    const id = db.transaction(() => {
      if (b.isDefault) db.prepare('UPDATE saved_views SET is_default = 0 WHERE user_id = ?').run(user.id);
      return Number(
        db
          .prepare('INSERT INTO saved_views(user_id, name, config_json, is_default, shared) VALUES (?, ?, ?, ?, ?)')
          .run(user.id, b.name, JSON.stringify(b.config), b.isDefault ? 1 : 0, b.shared && user.is_admin ? 1 : 0).lastInsertRowid,
      );
    })();
    return present(db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as ViewRow, user.id);
  });

  app.put('/api/views/:id', async (req) => {
    const { user } = requireUser(req);
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const b = viewBody.parse(req.body);
    db.transaction(() => {
      const cur = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as ViewRow | undefined;
      if (!cur || cur.user_id !== user.id) throw new HttpError(404, 'Ansicht nicht gefunden');
      if (b.isDefault) db.prepare('UPDATE saved_views SET is_default = 0 WHERE user_id = ?').run(user.id);
      db.prepare('UPDATE saved_views SET name=?, config_json=?, is_default=?, shared=? WHERE id = ?').run(
        b.name,
        JSON.stringify(b.config),
        b.isDefault ? 1 : 0,
        b.shared && user.is_admin ? 1 : 0,
        id,
      );
    })();
    return present(db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as ViewRow, user.id);
  });

  app.delete('/api/views/:id', async (req) => {
    const { user } = requireUser(req);
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const r = db.prepare('DELETE FROM saved_views WHERE id = ? AND user_id = ?').run(id, user.id);
    if (r.changes === 0) throw new HttpError(404, 'Ansicht nicht gefunden');
    return { ok: true };
  });
}
