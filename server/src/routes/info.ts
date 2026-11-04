import type { FastifyInstance } from 'fastify';
import { requireAdmin, type AppContext } from '../app.js';
import { APP_VERSION, readChangelog } from '../version.js';

export async function infoRoutes(app: FastifyInstance, _ctx: AppContext) {
  /** Version und Änderungshistorie (CHANGELOG.md) – nur für Administratoren. */
  app.get('/api/admin/changelog', async (req) => {
    requireAdmin(req);
    return { version: APP_VERSION, markdown: readChangelog() };
  });
}
