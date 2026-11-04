import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, SESSION_COOKIE, requireUser, type AppContext } from '../app.js';
import { audit, getSetting } from '../db.js';
import { LinkError, linkInfo, usePasswordLink } from '../password-links.js';
import {
  createSession,
  deleteSession,
  hashPassword,
  loginBlocked,
  loginFailed,
  loginSucceeded,
  verifyPassword,
  type UserRow,
} from '../auth.js';

export async function authRoutes(app: FastifyInstance, { db, secureCookies }: AppContext) {
  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
    const key = `${body.username.toLowerCase()}|${req.ip}`;
    if (loginBlocked(key)) throw new HttpError(429, 'Zu viele Fehlversuche, bitte später erneut versuchen');

    const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(body.username) as
      | UserRow
      | undefined;
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      loginFailed(key);
      throw new HttpError(401, 'Benutzername oder Passwort falsch');
    }
    loginSucceeded(key);
    const token = createSession(db, user.id);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookies,
      path: '/',
      maxAge: 30 * 86400,
    });
    return { ok: true };
  });

  /** Öffentlich: Ansprechpartner für die Anmeldeseite („Passwort vergessen?“). */
  app.get('/api/public/login-info', async () => {
    const c = JSON.parse(getSetting(db, 'support_contact', '{}')) as Record<string, string>;
    const contact = ['name', 'phone', 'email', 'note'].some((k) => c[k]) ? c : null;
    return { contact };
  });

  // Einrichtungs-/Zurücksetz-Link. Token im Body statt in der URL, damit er nicht in Server-Logs landet.
  const linkError = (e: unknown) => {
    if (e instanceof LinkError) throw new HttpError(e.status, e.message);
    throw e;
  };
  app.post('/api/password-link/info', async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(100) }).parse(req.body);
    try {
      return linkInfo(db, token);
    } catch (e) {
      return linkError(e);
    }
  });
  app.post('/api/password-link/use', async (req, reply) => {
    const b = z
      .object({ token: z.string().min(10).max(100), secret: z.string().max(100).default(''), password: z.string().min(8, 'Mindestens 8 Zeichen').max(200) })
      .parse(req.body);
    const key = `link|${req.ip}`;
    // grobe Bremse gegen Durchprobieren vieler Links; je Link sperrt schon nach 5 Fehlversuchen
    if (loginBlocked(key, 20)) throw new HttpError(429, 'Zu viele Fehlversuche, bitte später erneut versuchen');
    let userId: number;
    try {
      userId = usePasswordLink(db, b.token, b.secret, b.password);
    } catch (e) {
      if (e instanceof LinkError && e.status === 403) loginFailed(key);
      return linkError(e);
    }
    loginSucceeded(key);
    audit(db, { userId, action: 'update', entity: 'user', entityId: userId, after: { passwordSetViaLink: true } });
    // gleich angemeldet weiter
    reply.setCookie(SESSION_COOKIE, createSession(db, userId), { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/', maxAge: 30 * 86400 });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) deleteSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** Persönliche Darstellung (gilt auf allen Geräten des Benutzers). */
  app.put('/api/me/preferences', async (req) => {
    const { user } = requireUser(req);
    const b = z.object({ fontScale: z.number().min(0.8).max(2) }).parse(req.body);
    db.prepare('UPDATE users SET font_scale = ? WHERE id = ?').run(Math.round(b.fontScale * 100) / 100, user.id);
    return { ok: true };
  });

  app.post('/api/auth/password', async (req) => {
    const { user } = requireUser(req);
    const body = z
      .object({ oldPassword: z.string(), newPassword: z.string().min(8, 'Mindestens 8 Zeichen') })
      .parse(req.body);
    if (!verifyPassword(body.oldPassword, user.password_hash)) throw new HttpError(400, 'Altes Passwort falsch');
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
      hashPassword(body.newPassword),
      user.id,
    );
    return { ok: true };
  });
}
