import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser, type AppContext } from '../app.js';

/**
 * „Änderungen an meinem Plan“: Protokoll aller Änderungen an den eigenen Einträgen (verknüpfter Mitarbeiter)
 * und Hinweis nach der Anmeldung, wenn andere etwas geändert haben.
 */
export async function meRoutes(app: FastifyInstance, { db }: AppContext) {
  const maxAuditId = () => (db.prepare('SELECT COALESCE(MAX(id), 0) m FROM audit_log').get() as { m: number }).m;

  /** Zusammenfassung für den Hinweis: Änderungen durch andere seit dem letzten „gesehen“. */
  app.get('/api/me/changes/summary', async (req) => {
    const { user } = requireUser(req);
    if (!user.employee_id) return { count: 0, users: [] };
    if (user.changes_seen_id == null) {
      // erstes Mal (z. B. neues Konto oder nach dem Update): ab jetzt zählen, keine Altlasten melden
      db.prepare('UPDATE users SET changes_seen_id = ? WHERE id = ?').run(maxAuditId(), user.id);
      return { count: 0, users: [] };
    }
    const rows = db
      .prepare(
        `SELECT COUNT(DISTINCT COALESCE(a.change_id, 'r' || a.id)) n, GROUP_CONCAT(DISTINCT u.display_name) names
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.entity = 'entry' AND a.employee_id = ? AND a.id > ? AND (a.user_id IS NULL OR a.user_id != ?)`,
      )
      .get(user.employee_id, user.changes_seen_id, user.id) as { n: number; names: string | null };
    return { count: rows.n, users: rows.names ? rows.names.split(',') : [] };
  });

  /** Alles gesehen (Hinweis geschlossen oder Liste geöffnet). */
  app.post('/api/me/changes/seen', async (req) => {
    const { user } = requireUser(req);
    db.prepare('UPDATE users SET changes_seen_id = ? WHERE id = ?').run(maxAuditId(), user.id);
    return { ok: true };
  });

  /** Protokoll der eigenen Einträge, neueste zuerst; Änderungen anderer seit dem letzten Besuch als „neu“. */
  app.get('/api/me/changes', async (req) => {
    const { user } = requireUser(req);
    const q = z.object({ limit: z.coerce.number().int().max(500).default(200), beforeId: z.coerce.number().int().optional() }).parse(req.query);
    if (!user.employee_id) return { rows: [], undone: [], nextBeforeId: null, seenId: null, hasEmployee: false };
    const rows = db
      .prepare(
        `SELECT a.*, u.display_name AS user_name, e.first_name || ' ' || e.last_name AS employee_name,
                e.last_name AS employee_last, e.first_name AS employee_first
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN employees e ON e.id = a.employee_id
         WHERE a.entity = 'entry' AND a.employee_id = ? AND (? IS NULL OR a.id < ?)
         ORDER BY a.id DESC LIMIT ?`,
      )
      .all(user.employee_id, q.beforeId ?? null, q.beforeId ?? null, q.limit) as { id: number; change_id: string | null }[];
    const changeIds = [...new Set(rows.map((r) => r.change_id).filter(Boolean))] as string[];
    const undone = changeIds.length
      ? (db.prepare(`SELECT DISTINCT undo_of FROM audit_log WHERE undo_of IN (${changeIds.map(() => '?').join(',')})`).all(...changeIds) as { undo_of: string }[]).map((r) => r.undo_of)
      : [];
    return { rows, undone, nextBeforeId: rows.length >= q.limit ? rows[rows.length - 1].id : null, seenId: user.changes_seen_id, hasEmployee: true };
  });
}
