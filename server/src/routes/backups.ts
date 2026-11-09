import type { FastifyInstance } from 'fastify';
import { createReadStream, rmSync, statSync } from 'node:fs';
import { z } from 'zod';
import { HttpError, requireAdmin, type AppContext } from '../app.js';
import { audit, setSetting } from '../db.js';
import {
  backupPath,
  createBackup,
  getLastBackup,
  getSchedule,
  listBackups,
  nextSlot,
  restoreLive,
  storeUpload,
  type Schedule,
} from '../backup.js';

const schedule = z.object({
  mode: z.enum(['off', 'hourly', 'daily', 'weekly']),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM'),
  weekday: z.number().int().min(0).max(6),
  keep: z.number().int().min(1).max(365),
  extraDir: z.string().trim().max(500),
});

/** Verwaltung → Backups: Zeitplan, Liste, Jetzt sichern, Herunterladen, Hochladen, Einspielen. */
export async function backupRoutes(app: FastifyInstance, { db, hub, backupDir }: AppContext) {
  const file = (name: string) => {
    const p = backupPath(backupDir, name);
    if (!p) throw new HttpError(404, 'Sicherung nicht gefunden');
    return p;
  };

  // Hochladen schickt die Datei roh (application/octet-stream)
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 1024 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.get('/api/admin/backups', async (req) => {
    requireAdmin(req);
    const s = getSchedule(db);
    return { dir: backupDir, schedule: s, last: getLastBackup(db), next: nextSlot(s)?.toISOString() ?? null, files: listBackups(backupDir) };
  });

  app.put('/api/admin/backups/schedule', async (req) => {
    const { user } = requireAdmin(req);
    const s: Schedule = schedule.parse(req.body);
    if (s.extraDir && !s.extraDir.startsWith('/')) throw new HttpError(400, 'Der zusätzliche Speicherort muss ein absoluter Pfad sein (z. B. /mnt/nas/schichtplaner).');
    setSetting(db, 'backup_schedule', JSON.stringify(s));
    audit(db, { userId: user.id, action: 'update', entity: 'settings', entityId: 0, after: { backupSchedule: s } });
    return { schedule: s, next: nextSlot(s)?.toISOString() ?? null };
  });

  app.post('/api/admin/backups', async (req) => {
    const { user } = requireAdmin(req);
    let f: string;
    try {
      f = await createBackup(db, backupDir, 'manual');
    } catch (e) {
      throw new HttpError(500, `Sicherung fehlgeschlagen: ${(e as Error).message}`);
    }
    const name = f.split('/').pop()!;
    audit(db, { userId: user.id, action: 'create', entity: 'backup', entityId: null, after: { name } });
    return { name, last: getLastBackup(db) };
  });

  app.get('/api/admin/backups/:name/download', async (req, reply) => {
    requireAdmin(req);
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const p = file(name);
    return reply
      .type('application/vnd.sqlite3')
      .header('Content-Disposition', `attachment; filename="${name}"`)
      .header('Content-Length', statSync(p).size)
      .header('Cache-Control', 'no-store')
      .send(createReadStream(p));
  });

  app.delete('/api/admin/backups/:name', async (req) => {
    const { user } = requireAdmin(req);
    const { name } = z.object({ name: z.string() }).parse(req.params);
    rmSync(file(name));
    audit(db, { userId: user.id, action: 'delete', entity: 'backup', entityId: null, before: { name } });
    return { ok: true };
  });

  /** Sicherungsdatei hochladen (roh als Binärdaten), wird geprüft und in die Liste übernommen. */
  app.post(
    '/api/admin/backups/upload',
    { bodyLimit: 1024 * 1024 * 1024 },
    async (req) => {
      const { user } = requireAdmin(req);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'Keine Datei empfangen');
      const r = storeUpload(backupDir, req.body);
      if ('error' in r) throw new HttpError(400, r.error);
      audit(db, { userId: user.id, action: 'create', entity: 'backup', entityId: null, after: { name: r.name, uploaded: true } });
      return r;
    },
  );

  /** Sicherung im laufenden Betrieb einspielen. Vorher wird automatisch eine Sicherheitskopie angelegt. */
  app.post('/api/admin/backups/:name/restore', async (req) => {
    const { user } = requireAdmin(req);
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const p = file(name);
    let safety: string;
    try {
      ({ safety } = await restoreLive(db, backupDir, p));
    } catch (e) {
      throw new HttpError(400, `Einspielen nicht möglich: ${(e as Error).message}`);
    }
    // nach dem Einspielen protokollieren, sonst wäre der Eintrag gleich wieder überschrieben
    const stillThere = db.prepare('SELECT 1 FROM users WHERE id = ?').get(user.id);
    audit(db, { userId: stillThere ? user.id : null, action: 'update', entity: 'backup', entityId: null, after: { restored: name, safety, by: user.username } });
    hub.invalidate();
    hub.broadcast('masterdata', () => ({ entity: 'restore', reloadEntries: true }));
    hub.broadcast('holidays', () => ({}));
    return { ok: true, safety };
  });
}
