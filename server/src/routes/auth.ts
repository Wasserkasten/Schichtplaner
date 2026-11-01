import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, SESSION_COOKIE, requireUser, type AppContext } from '../app.js';
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

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) deleteSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
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
