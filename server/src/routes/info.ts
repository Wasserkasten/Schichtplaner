import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireUser, type AppContext } from '../app.js';
import { acknowledgements, allNotes, markAcknowledged, markSeen, newsFor } from '../news.js';
import { APP_VERSION, readChangelog } from '../version.js';

export async function infoRoutes(app: FastifyInstance, { db }: AppContext) {
  /** Version und Änderungshistorie (CHANGELOG.md) – nur für Administratoren. */
  app.get('/api/admin/changelog', async (req) => {
    requireAdmin(req);
    return { version: APP_VERSION, markdown: readChangelog(), acknowledgements: acknowledgements(db) };
  });

  /** Neuigkeiten für den angemeldeten Benutzer (Hinweisleiste / Popup). `?recent=1`: die letzten Neuigkeiten unabhängig vom Lesestand. */
  app.get('/api/news', async (req) => {
    const { user } = requireUser(req);
    const recent = (req.query as { recent?: string }).recent === '1';
    if (recent) return { version: APP_VERSION, recent: allNotes().filter((n) => n.forAll || n.important).reverse().slice(0, 5) };
    return newsFor(user);
  });

  /** Hinweisleiste geschlossen oder „Was ist neu?“ geöffnet. */
  app.post('/api/news/seen', async (req) => {
    const { user } = requireUser(req);
    markSeen(db, user.id);
    return { ok: true };
  });

  /** Wichtige Hinweise mit „Verstanden“ bestätigt. */
  app.post('/api/news/ack', async (req) => {
    const { user } = requireUser(req);
    markAcknowledged(db, user.id);
    return { ok: true };
  });
}
