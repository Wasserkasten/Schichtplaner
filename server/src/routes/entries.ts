import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, requireUser, type AppContext } from '../app.js';
import { audit } from '../db.js';
import { EntryContext, toDTO, type EntryRow } from '../entries.js';
import type { Permissions } from '../permissions.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/).nullable().optional();
const text = z.string().trim().max(200).nullable().optional();

const entryBody = z.object({
  employeeId: z.number().int(),
  date: isoDate,
  typeId: z.number().int().nullable().optional(),
  text,
  startTime: time,
  endTime: time,
});

const MAX_BULK_CELLS = 2000;

export async function entryRoutes(app: FastifyInstance, { db, hub }: AppContext) {
  const getEntry = db.prepare('SELECT * FROM entries WHERE id = ?');

  function teamOfEmployee(employeeId: number): number {
    const r = db.prepare('SELECT team_id FROM employees WHERE id = ?').get(employeeId) as { team_id: number } | undefined;
    if (!r) throw new HttpError(404, 'Mitarbeiter nicht gefunden');
    return r.team_id;
  }

  function assertCanEdit(perms: Permissions, employeeId: number) {
    if (!perms.can(teamOfEmployee(employeeId), 'edit')) {
      throw new HttpError(403, 'Keine Berechtigung, diesen Mitarbeiter zu bearbeiten');
    }
  }

  function assertType(typeId: number | null | undefined) {
    if (typeId == null) return;
    const t = db.prepare('SELECT active FROM entry_types WHERE id = ?').get(typeId) as { active: number } | undefined;
    if (!t || !t.active) throw new HttpError(400, 'Unbekannte oder inaktive Eintragsart');
  }

  function publish(action: 'upsert' | 'delete', rows: EntryRow[], userId: number) {
    if (rows.length === 0) return;
    const ec = new EntryContext(db);
    hub.broadcast('entries', (perms) => {
      const items =
        action === 'delete'
          ? rows.filter((r) => ec.present(r, perms) !== null).map((r) => ({ id: r.id }))
          : rows.map((r) => ec.present(r, perms)).filter((e) => e !== null);
      return items.length ? { action, by: userId, items } : null;
    });
  }

  function insert(userId: number, e: z.infer<typeof entryBody>): EntryRow {
    if (e.typeId == null && !e.text) throw new HttpError(400, 'Eintragsart oder Freitext erforderlich');
    const info = db
      .prepare(
        `INSERT INTO entries(employee_id, date, type_id, text, start_time, end_time, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.employeeId, e.date, e.typeId ?? null, e.text || null, e.startTime ?? null, e.endTime ?? null, userId, userId);
    const row = getEntry.get(info.lastInsertRowid) as EntryRow;
    audit(db, { userId, action: 'create', entity: 'entry', entityId: row.id, employeeId: row.employee_id, date: row.date, after: toDTO(row) });
    return row;
  }

  function remove(userId: number, row: EntryRow) {
    db.prepare('DELETE FROM entries WHERE id = ?').run(row.id);
    audit(db, { userId, action: 'delete', entity: 'entry', entityId: row.id, employeeId: row.employee_id, date: row.date, before: toDTO(row) });
  }

  app.post('/api/entries', async (req) => {
    const { user, perms } = requireUser(req);
    const body = entryBody.parse(req.body);
    assertCanEdit(perms, body.employeeId);
    assertType(body.typeId);
    const row = db.transaction(() => insert(user.id, body))();
    publish('upsert', [row], user.id);
    return toDTO(row);
  });

  app.patch('/api/entries/:id', async (req) => {
    const { user, perms } = requireUser(req);
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const body = entryBody.partial().extend({ version: z.number().int() }).parse(req.body);

    const row = db.transaction(() => {
      const cur = getEntry.get(id) as EntryRow | undefined;
      if (!cur) throw new HttpError(404, 'Eintrag nicht gefunden');
      assertCanEdit(perms, cur.employee_id);
      if (body.employeeId !== undefined && body.employeeId !== cur.employee_id) assertCanEdit(perms, body.employeeId);
      // Optimistische Sperre: wurde der Eintrag inzwischen von jemand anderem geändert?
      if (cur.version !== body.version) {
        throw new HttpError(409, 'Der Eintrag wurde inzwischen von jemand anderem geändert', toDTO(cur));
      }
      assertType(body.typeId);
      const next = {
        employee_id: body.employeeId ?? cur.employee_id,
        date: body.date ?? cur.date,
        type_id: body.typeId !== undefined ? body.typeId : cur.type_id,
        text: body.text !== undefined ? body.text || null : cur.text,
        start_time: body.startTime !== undefined ? body.startTime : cur.start_time,
        end_time: body.endTime !== undefined ? body.endTime : cur.end_time,
      };
      if (next.type_id == null && !next.text) throw new HttpError(400, 'Eintragsart oder Freitext erforderlich');
      db.prepare(
        `UPDATE entries SET employee_id=?, date=?, type_id=?, text=?, start_time=?, end_time=?,
           version = version + 1, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(next.employee_id, next.date, next.type_id, next.text, next.start_time, next.end_time, user.id, id);
      const updated = getEntry.get(id) as EntryRow;
      audit(db, { userId: user.id, action: 'update', entity: 'entry', entityId: id, employeeId: updated.employee_id, date: updated.date, before: toDTO(cur), after: toDTO(updated) });
      return { updated, cur };
    })();
    if (row.cur.employee_id !== row.updated.employee_id || row.cur.date !== row.updated.date) {
      publish('delete', [row.cur], user.id);
    }
    publish('upsert', [row.updated], user.id);
    return toDTO(row.updated);
  });

  app.delete('/api/entries/:id', async (req) => {
    const { user, perms } = requireUser(req);
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const { version } = z.object({ version: z.coerce.number().int().optional() }).parse(req.query);
    const cur = db.transaction(() => {
      const cur = getEntry.get(id) as EntryRow | undefined;
      if (!cur) throw new HttpError(404, 'Eintrag nicht gefunden');
      assertCanEdit(perms, cur.employee_id);
      if (version !== undefined && cur.version !== version) {
        throw new HttpError(409, 'Der Eintrag wurde inzwischen von jemand anderem geändert', toDTO(cur));
      }
      remove(user.id, cur);
      return cur;
    })();
    publish('delete', [cur], user.id);
    return { ok: true };
  });

  /**
   * Pinsel-Funktion: mehrere Zellen auf einmal setzen oder leeren.
   *  action 'set'   – vorhandene Einträge mit Eintragsart werden ersetzt, reine Freitext-Notizen bleiben erhalten
   *  action 'add'   – zusätzlicher Eintrag (z.B. Freitext-Notiz)
   *  action 'clear' – alle Einträge der Zellen löschen
   */
  app.post('/api/entries/bulk', async (req) => {
    const { user, perms } = requireUser(req);
    const body = z
      .object({
        action: z.enum(['set', 'add', 'clear']),
        cells: z.array(z.object({ employeeId: z.number().int(), date: isoDate })).min(1).max(MAX_BULK_CELLS),
        typeId: z.number().int().nullable().optional(),
        text,
        startTime: time,
        endTime: time,
      })
      .parse(req.body);

    for (const id of new Set(body.cells.map((c) => c.employeeId))) assertCanEdit(perms, id);
    if (body.action !== 'clear') {
      assertType(body.typeId);
      if (body.typeId == null && !body.text) throw new HttpError(400, 'Eintragsart oder Freitext erforderlich');
    }

    const result = db.transaction(() => {
      const created: EntryRow[] = [];
      const deleted: EntryRow[] = [];
      for (const c of body.cells) {
        const existing = db
          .prepare('SELECT * FROM entries WHERE employee_id = ? AND date = ?')
          .all(c.employeeId, c.date) as EntryRow[];
        const toDelete =
          body.action === 'clear' ? existing : body.action === 'set' ? existing.filter((e) => e.type_id != null) : [];
        // unverändert lassen, wenn die Zelle schon genau diesen Eintrag hat
        if (
          body.action === 'set' &&
          toDelete.length === 1 &&
          toDelete[0].type_id === (body.typeId ?? null) &&
          (toDelete[0].text ?? null) === (body.text || null)
        ) {
          continue;
        }
        for (const e of toDelete) {
          remove(user.id, e);
          deleted.push(e);
        }
        if (body.action !== 'clear') {
          created.push(
            insert(user.id, {
              employeeId: c.employeeId,
              date: c.date,
              typeId: body.typeId,
              text: body.text,
              startTime: body.startTime,
              endTime: body.endTime,
            }),
          );
        }
      }
      return { created, deleted };
    })();

    publish('delete', result.deleted, user.id);
    publish('upsert', result.created, user.id);
    return { created: result.created.map(toDTO), deleted: result.deleted.map((d) => d.id) };
  });

  /** Änderungshistorie einer Zelle (Mitarbeiter + Tag). */
  app.get('/api/audit', async (req) => {
    const { perms } = requireUser(req);
    const q = z
      .object({ employeeId: z.coerce.number().int().optional(), date: isoDate.optional(), limit: z.coerce.number().int().max(500).default(100) })
      .parse(req.query);
    if (q.employeeId === undefined) {
      if (!perms.isAdmin) throw new HttpError(403, 'Nur für Administratoren');
      return db
        .prepare(
          `SELECT a.*, u.display_name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
           ORDER BY a.id DESC LIMIT ?`,
        )
        .all(q.limit);
    }
    if (!perms.can(teamOfEmployee(q.employeeId), 'edit')) throw new HttpError(403, 'Keine Berechtigung');
    return db
      .prepare(
        `SELECT a.*, u.display_name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.employee_id = ? AND (? IS NULL OR a.date = ?) ORDER BY a.id DESC LIMIT ?`,
      )
      .all(q.employeeId, q.date ?? null, q.date ?? null, q.limit);
  });
}
