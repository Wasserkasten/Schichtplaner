import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError, requireUser, type AppContext } from '../app.js';
import { audit } from '../db.js';
import { EntryContext, toDTO, type EntryDTO, type EntryRow } from '../entries.js';
import { createEmploymentCheck } from '../employment.js';
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

interface AuditRow {
  id: number;
  user_id: number | null;
  action: 'create' | 'update' | 'delete';
  before_json: string | null;
  after_json: string | null;
}
/** Höchstzahl an Diensten/An-/Abwesenheiten (Einträge mit Eintragsart) je Mitarbeiter und Tag. Notizen zählen nicht mit. */
export const MAX_TYPED_PER_CELL = 3;

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

  function publish(action: 'upsert' | 'delete', rows: EntryRow[], userId: number, changeId?: string) {
    if (rows.length === 0) return;
    const ec = new EntryContext(db);
    hub.broadcast('entries', (perms) => {
      const items =
        action === 'delete'
          ? rows.filter((r) => ec.present(r, perms) !== null).map((r) => ({ id: r.id }))
          : rows.map((r) => ec.present(r, perms)).filter((e) => e !== null);
      return items.length ? { action, by: userId, changeId, items } : null;
    });
  }

  function insert(userId: number, e: z.infer<typeof entryBody>, changeId: string): EntryRow {
    if (e.typeId == null && !e.text) throw new HttpError(400, 'Eintragsart oder Freitext erforderlich');
    const info = db
      .prepare(
        `INSERT INTO entries(employee_id, date, type_id, text, start_time, end_time, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.employeeId, e.date, e.typeId ?? null, e.text || null, e.startTime ?? null, e.endTime ?? null, userId, userId);
    const row = getEntry.get(info.lastInsertRowid) as EntryRow;
    audit(db, { userId, action: 'create', entity: 'entry', entityId: row.id, employeeId: row.employee_id, date: row.date, after: toDTO(row), changeId });
    return row;
  }

  function remove(userId: number, row: EntryRow, changeId: string, undoOf?: string) {
    db.prepare('DELETE FROM entries WHERE id = ?').run(row.id);
    audit(db, { userId, action: 'delete', entity: 'entry', entityId: row.id, employeeId: row.employee_id, date: row.date, before: toDTO(row), changeId, undoOf });
  }

  /** Typisierte Einträge einer Zelle (ohne den Eintrag `exceptId`). */
  function typedInCell(employeeId: number, date: string, exceptId = 0): EntryRow[] {
    return db
      .prepare('SELECT * FROM entries WHERE employee_id = ? AND date = ? AND type_id IS NOT NULL AND id != ?')
      .all(employeeId, date, exceptId) as EntryRow[];
  }

  /** Prüft Obergrenze und doppelte Eintragsart für eine Zelle. */
  function assertRoom(employeeId: number, date: string, typeId: number | null | undefined, exceptId = 0) {
    if (typeId == null) return;
    const typed = typedInCell(employeeId, date, exceptId);
    if (typed.some((e) => e.type_id === typeId)) throw new HttpError(409, 'Diese Eintragsart ist an diesem Tag bereits eingetragen');
    if (typed.length >= MAX_TYPED_PER_CELL) {
      throw new HttpError(409, `Höchstens ${MAX_TYPED_PER_CELL} Dienste bzw. An-/Abwesenheiten pro Tag möglich`);
    }
  }

  app.post('/api/entries', async (req) => {
    const { user, perms } = requireUser(req);
    const body = entryBody.parse(req.body);
    assertCanEdit(perms, body.employeeId);
    assertType(body.typeId);
    const changeId = randomUUID();
    const row = db.transaction(() => {
      assertRoom(body.employeeId, body.date, body.typeId);
      const reason = createEmploymentCheck(db)(body.employeeId, body.date);
      if (reason) throw new HttpError(422, `Nicht möglich: ${reason}.`);
      return insert(user.id, body, changeId);
    })();
    publish('upsert', [row], user.id, changeId);
    return { ...toDTO(row), changeId };
  });

  app.patch('/api/entries/:id', async (req) => {
    const { user, perms } = requireUser(req);
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const body = entryBody.partial().extend({ version: z.number().int() }).parse(req.body);
    const changeId = randomUUID();

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
      if (next.type_id !== cur.type_id || next.employee_id !== cur.employee_id || next.date !== cur.date) {
        assertRoom(next.employee_id, next.date, next.type_id, cur.id);
      }
      // auch vorhandene Einträge außerhalb der Beschäftigung (z. B. nach dem Austritt behalten) nur noch löschen, nicht ändern
      const reason = createEmploymentCheck(db)(next.employee_id, next.date);
      if (reason) throw new HttpError(422, `Nicht möglich: ${reason}.`);
      db.prepare(
        `UPDATE entries SET employee_id=?, date=?, type_id=?, text=?, start_time=?, end_time=?,
           version = version + 1, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(next.employee_id, next.date, next.type_id, next.text, next.start_time, next.end_time, user.id, id);
      const updated = getEntry.get(id) as EntryRow;
      audit(db, { userId: user.id, action: 'update', entity: 'entry', entityId: id, employeeId: updated.employee_id, date: updated.date, before: toDTO(cur), after: toDTO(updated), changeId });
      return { updated, cur };
    })();
    if (row.cur.employee_id !== row.updated.employee_id || row.cur.date !== row.updated.date) {
      publish('delete', [row.cur], user.id, changeId);
    }
    publish('upsert', [row.updated], user.id, changeId);
    return { ...toDTO(row.updated), changeId };
  });

  app.delete('/api/entries/:id', async (req) => {
    const { user, perms } = requireUser(req);
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const { version } = z.object({ version: z.coerce.number().int().optional() }).parse(req.query);
    const changeId = randomUUID();
    const cur = db.transaction(() => {
      const cur = getEntry.get(id) as EntryRow | undefined;
      if (!cur) throw new HttpError(404, 'Eintrag nicht gefunden');
      assertCanEdit(perms, cur.employee_id);
      if (version !== undefined && cur.version !== version) {
        throw new HttpError(409, 'Der Eintrag wurde inzwischen von jemand anderem geändert', toDTO(cur));
      }
      remove(user.id, cur, changeId);
      return cur;
    })();
    publish('delete', [cur], user.id, changeId);
    return { ok: true, changeId };
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
        // nur bei 'clear': gezielt diese Eintragsarten bzw. Notizen (ohne Art) entfernen; ohne Angabe alles
        only: z.object({ typeIds: z.array(z.number().int()).default([]), notes: z.boolean().default(false) }).optional(),
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

    const changeId = randomUUID();
    const result = db.transaction(() => {
      const created: EntryRow[] = [];
      const deleted: EntryRow[] = [];
      let skipped = 0; // Zellen, in denen nichts hinzugefügt wurde (schon vorhanden bzw. voll)
      let outside = 0; // Zellen außerhalb der Beschäftigung bzw. vor dem Planungsbeginn
      const allowed = createEmploymentCheck(db);
      for (const c of body.cells) {
        if (body.action !== 'clear' && allowed(c.employeeId, c.date)) {
          outside++;
          continue;
        }
        const existing = db
          .prepare('SELECT * FROM entries WHERE employee_id = ? AND date = ?')
          .all(c.employeeId, c.date) as EntryRow[];
        if (body.action === 'add' && body.typeId != null) {
          const typed = existing.filter((e) => e.type_id != null);
          if (typed.some((e) => e.type_id === body.typeId) || typed.length >= MAX_TYPED_PER_CELL) {
            skipped++;
            continue;
          }
        }
        const toDelete =
          body.action === 'clear'
            ? existing.filter((e) => !body.only || (e.type_id != null ? body.only.typeIds.includes(e.type_id) : body.only.notes))
            : body.action === 'set' ? existing.filter((e) => e.type_id != null) : [];
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
          remove(user.id, e, changeId);
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
            }, changeId),
          );
        }
      }
      return { created, deleted, skipped, outside };
    })();

    publish('delete', result.deleted, user.id, changeId);
    publish('upsert', result.created, user.id, changeId);
    return { created: result.created.map(toDTO), deleted: result.deleted.map((d) => d.id), skipped: result.skipped, outside: result.outside, changeId };
  });

  /**
   * Eine Änderung (alle Protokollzeilen mit derselben change_id) rückgängig machen.
   * Wurde ein betroffener Eintrag inzwischen von jemandem geändert, wird nichts zurückgenommen.
   * Die Rücknahme ist selbst wieder eine Änderung – sie lässt sich also ebenso zurücknehmen.
   */
  app.post('/api/changes/:changeId/undo', async (req) => {
    const { user, perms } = requireUser(req);
    const { changeId } = z.object({ changeId: z.string().min(8).max(64) }).parse(req.params);
    const rows = db
      .prepare("SELECT * FROM audit_log WHERE change_id = ? AND entity = 'entry' ORDER BY id DESC")
      .all(changeId) as AuditRow[];
    if (rows.length === 0) throw new HttpError(404, 'Änderung nicht gefunden');
    if (rows[0].user_id !== user.id && !perms.isAdmin) throw new HttpError(403, 'Nur eigene Änderungen können zurückgenommen werden');
    if (db.prepare('SELECT 1 FROM audit_log WHERE undo_of = ? LIMIT 1').get(changeId)) {
      throw new HttpError(409, 'Diese Änderung wurde bereits rückgängig gemacht');
    }

    const undoId = randomUUID();
    const nameOf = (id: number | null) =>
      (id && (db.prepare('SELECT display_name FROM users WHERE id = ?').get(id) as { display_name: string } | undefined)?.display_name) || 'jemand';
    const changedMeanwhile = (cur: EntryRow) =>
      new HttpError(409, `Kann nicht rückgängig gemacht werden: ${nameOf(cur.updated_by)} hat den Eintrag am ${cur.date.split('-').reverse().join('.')} inzwischen geändert.`);

    const allowed = createEmploymentCheck(db);
    const assertAllowed = (employeeId: number, date: string) => {
      const reason = allowed(employeeId, date);
      if (reason) throw new HttpError(409, `Kann nicht rückgängig gemacht werden: ${reason}.`);
    };
    const result = db.transaction(() => {
      const upserted = new Map<number, EntryRow>();
      const deleted: EntryRow[] = [];
      let undone = 0;
      for (const a of rows) {
        const before = a.before_json ? (JSON.parse(a.before_json) as EntryDTO) : null;
        const after = a.after_json ? (JSON.parse(a.after_json) as EntryDTO) : null;
        if (a.action === 'create' && after) {
          // angelegt -> wieder löschen
          const cur = getEntry.get(after.id) as EntryRow | undefined;
          // Inzwischen gelöscht (oder ersetzt): Würde man den Rest trotzdem zurücknehmen, entstünde ein Mischstand
          // (z. B. alter Dienst neben dem neuen eines Kollegen) – daher die ganze Rücknahme ablehnen.
          if (!cur || cur.type_id !== after.typeId) {
            const last = db
              .prepare("SELECT user_id FROM audit_log WHERE entity = 'entry' AND entity_id = ? AND id > ? ORDER BY id DESC LIMIT 1")
              .get(after.id, a.id) as { user_id: number | null } | undefined;
            throw new HttpError(409, `Kann nicht rückgängig gemacht werden: ${nameOf(last?.user_id ?? null)} hat den Eintrag am ${after.date.split('-').reverse().join('.')} inzwischen geändert oder gelöscht.`);
          }
          if (cur.version !== after.version) throw changedMeanwhile(cur);
          assertCanEdit(perms, cur.employee_id);
          remove(user.id, cur, undoId, changeId);
          upserted.delete(cur.id);
          deleted.push(cur);
          undone++;
        } else if (a.action === 'delete' && before) {
          // gelöscht -> wiederherstellen (mit derselben ID, falls frei)
          assertCanEdit(perms, before.employeeId);
          if (before.typeId != null) {
            const typed = typedInCell(before.employeeId, before.date);
            if (typed.some((e) => e.type_id === before.typeId)) {
              throw new HttpError(409, `Kann nicht rückgängig gemacht werden: Am ${before.date.split('-').reverse().join('.')} ist diese Eintragsart inzwischen wieder eingetragen.`);
            }
            if (typed.length >= MAX_TYPED_PER_CELL) {
              throw new HttpError(409, `Kann nicht rückgängig gemacht werden: Am ${before.date.split('-').reverse().join('.')} sind inzwischen schon ${MAX_TYPED_PER_CELL} Dienste eingetragen.`);
            }
          }
          assertAllowed(before.employeeId, before.date);
          const idFree = !getEntry.get(before.id);
          const info = db
            .prepare(
              `INSERT INTO entries(id, employee_id, date, type_id, text, start_time, end_time, version, created_by, updated_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(idFree ? before.id : null, before.employeeId, before.date, before.typeId, before.text, before.startTime, before.endTime, before.version + 1, user.id, user.id);
          const row = getEntry.get(info.lastInsertRowid) as EntryRow;
          audit(db, { userId: user.id, action: 'create', entity: 'entry', entityId: row.id, employeeId: row.employee_id, date: row.date, after: toDTO(row), changeId: undoId, undoOf: changeId });
          upserted.set(row.id, row);
          undone++;
        } else if (a.action === 'update' && before && after) {
          // geändert -> alten Stand wiederherstellen
          const cur = getEntry.get(after.id) as EntryRow | undefined;
          if (!cur) throw new HttpError(409, 'Kann nicht rückgängig gemacht werden: Der Eintrag wurde inzwischen gelöscht.');
          if (cur.version !== after.version) throw changedMeanwhile(cur);
          assertCanEdit(perms, cur.employee_id);
          assertCanEdit(perms, before.employeeId);
          if (before.typeId !== cur.type_id || before.employeeId !== cur.employee_id || before.date !== cur.date) {
            assertRoom(before.employeeId, before.date, before.typeId, cur.id);
          }
          assertAllowed(before.employeeId, before.date);
          db.prepare(
            `UPDATE entries SET employee_id=?, date=?, type_id=?, text=?, start_time=?, end_time=?,
               version = version + 1, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
          ).run(before.employeeId, before.date, before.typeId, before.text, before.startTime, before.endTime, user.id, cur.id);
          const row = getEntry.get(cur.id) as EntryRow;
          audit(db, { userId: user.id, action: 'update', entity: 'entry', entityId: row.id, employeeId: row.employee_id, date: row.date, before: toDTO(cur), after: toDTO(row), changeId: undoId, undoOf: changeId });
          if (cur.employee_id !== row.employee_id || cur.date !== row.date) deleted.push(cur);
          upserted.set(row.id, row);
          undone++;
        }
      }
      if (undone === 0) throw new HttpError(409, 'Es gibt nichts mehr rückgängig zu machen.');
      return { upserted: [...upserted.values()], deleted };
    })();

    publish('delete', result.deleted, user.id, undoId);
    publish('upsert', result.upserted, user.id, undoId);
    return { changeId: undoId, upserted: result.upserted.map(toDTO), deleted: result.deleted.map((d) => d.id) };
  });

  /** Änderungshistorie einer Zelle (Mitarbeiter + Tag). */
  app.get('/api/audit', async (req) => {
    const { perms } = requireUser(req);
    const q = z
      .object({
        employeeId: z.coerce.number().int().optional(),
        date: isoDate.optional(),
        limit: z.coerce.number().int().max(1000).default(100),
        beforeId: z.coerce.number().int().optional(), // zum Nachladen älterer Einträge
      })
      .parse(req.query);
    if (q.employeeId === undefined) {
      // Gesamtprotokoll (Verwaltung): mit Mitarbeiternamen; Änderungen werden nicht über Seitengrenzen zerteilt
      if (!perms.isAdmin) throw new HttpError(403, 'Nur für Administratoren');
      const select = `SELECT a.*, u.display_name AS user_name, e.first_name || ' ' || e.last_name AS employee_name,
                             e.last_name AS employee_last, e.first_name AS employee_first
                      FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN employees e ON e.id = a.employee_id`;
      const rows = db.prepare(`${select} WHERE (? IS NULL OR a.id < ?) ORDER BY a.id DESC LIMIT ?`).all(q.beforeId ?? null, q.beforeId ?? null, q.limit) as {
        id: number;
        change_id: string | null;
      }[];
      const last = rows[rows.length - 1];
      if (rows.length === q.limit && last?.change_id) {
        rows.push(...(db.prepare(`${select} WHERE a.change_id = ? AND a.id < ? ORDER BY a.id DESC`).all(last.change_id, last.id) as typeof rows));
      }
      const changeIds = [...new Set(rows.map((r) => r.change_id).filter(Boolean))] as string[];
      const undone = changeIds.length
        ? (db.prepare(`SELECT DISTINCT undo_of FROM audit_log WHERE undo_of IN (${changeIds.map(() => '?').join(',')})`).all(...changeIds) as { undo_of: string }[]).map((r) => r.undo_of)
        : [];
      return { rows, undone, nextBeforeId: rows.length >= q.limit ? rows[rows.length - 1].id : null };
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
