import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import type { DB } from './db.js';
import { userForSession, type UserRow } from './auth.js';
import { Permissions } from './permissions.js';
import { RealtimeHub } from './realtime.js';
import { authRoutes } from './routes/auth.js';
import { planRoutes } from './routes/plan.js';
import { entryRoutes } from './routes/entries.js';
import { adminRoutes } from './routes/admin.js';
import { viewRoutes } from './routes/views.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
    perms: Permissions | null;
  }
}

export interface AppContext {
  db: DB;
  hub: RealtimeHub;
  secureCookies: boolean;
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
  }
}

export function requireUser(req: FastifyRequest): { user: UserRow; perms: Permissions } {
  if (!req.user || !req.perms) throw new HttpError(401, 'Nicht angemeldet');
  return { user: req.user, perms: req.perms };
}

export function requireAdmin(req: FastifyRequest): { user: UserRow; perms: Permissions } {
  const r = requireUser(req);
  if (!r.perms.isAdmin) throw new HttpError(403, 'Nur für Administratoren');
  return r;
}

export const SESSION_COOKIE = 'sp_session';

export async function buildApp(opts: {
  db: DB;
  staticDir?: string;
  secureCookies?: boolean;
  trustProxy?: boolean;
  logger?: boolean;
}): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: opts.trustProxy ?? true, forceCloseConnections: true });
  const ctx: AppContext = { db: opts.db, hub: new RealtimeHub(opts.db), secureCookies: !!opts.secureCookies };

  await app.register(cookie);
  app.decorateRequest('user', null);
  app.decorateRequest('perms', null);

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const user = userForSession(ctx.db, req.cookies[SESSION_COOKIE]);
    req.user = user;
    req.perms = user ? new Permissions(ctx.db, user) : null;
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.message, data: err.data });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'Ungültige Eingabe', details: err.issues });
    }
    const e = err as { statusCode?: number; message?: string; code?: string };
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return reply.status(409).send({ error: 'Eintrag existiert bereits' });
    }
    if (e.code?.startsWith('SQLITE_CONSTRAINT')) {
      return reply.status(409).send({ error: 'Datensatz wird noch verwendet oder ist ungültig' });
    }
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.message });
    app.log.error(err);
    return reply.status(500).send({ error: 'Interner Fehler' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(async (api) => {
    await authRoutes(api, ctx);
    await planRoutes(api, ctx);
    await entryRoutes(api, ctx);
    await adminRoutes(api, ctx);
    await viewRoutes(api, ctx);
  });

  if (opts.staticDir && existsSync(opts.staticDir)) {
    await app.register(fastifyStatic, {
      root: opts.staticDir,
      setHeaders: (res, path) => {
        // gehashte Assets dürfen lange gecacht werden, index.html/Service Worker nie
        if (path.includes('/assets/')) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'no-cache');
      },
    });
    // Single-Page-App: unbekannte Pfade (ohne Dateiendung) auf index.html umleiten
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || /\.[a-z0-9]+(\?|$)/i.test(req.url)) {
        return reply.status(404).send({ error: 'Nicht gefunden' });
      }
      return reply.sendFile('index.html');
    });
  }

  return { app, ctx };
}
