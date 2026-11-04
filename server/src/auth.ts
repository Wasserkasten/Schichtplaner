import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DB } from './db.js';

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  employee_id: number | null;
  is_admin: number;
  active: number;
  must_change_password: number;
  font_scale: number;
}

const SESSION_DAYS = 30;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

export function createSession(db: DB, userId: number): string {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return token;
}

export function userForSession(db: DB, token: string | undefined): UserRow | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`,
    )
    .get(token, new Date().toISOString()) as UserRow | undefined;
  return row ?? null;
}

export function deleteSession(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** Sehr einfache Bremse gegen Passwort-Raten (pro Benutzername + IP). */
const failed = new Map<string, { count: number; until: number }>();
export function loginBlocked(key: string): boolean {
  const f = failed.get(key);
  return !!f && f.count >= 5 && f.until > Date.now();
}
export function loginFailed(key: string): void {
  const f = failed.get(key) ?? { count: 0, until: 0 };
  f.count += 1;
  f.until = Date.now() + 5 * 60_000;
  failed.set(key, f);
}
export function loginSucceeded(key: string): void {
  failed.delete(key);
}
