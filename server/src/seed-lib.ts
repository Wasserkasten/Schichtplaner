import { randomBytes } from 'node:crypto';
import type { DB } from './db.js';
import { hashPassword } from './auth.js';

export const DEFAULT_ENTRY_TYPES = [
  // code, name, category, color, textColor, start, end, vacation, sensitive
  ['F', 'Frühdienst', 'shift', '#fff3b0', '#5c4a00', '06:00', '14:00', 0, 0],
  ['S', 'Spätdienst', 'shift', '#ffd6a5', '#6b3a00', '14:00', '22:00', 0, 0],
  ['N', 'Nachtdienst', 'shift', '#3d4a8f', '#ffffff', '22:00', '06:00', 0, 0],
  ['T', 'Tagdienst', 'shift', '#caffbf', '#1d4d14', '08:00', '16:30', 0, 0],
  ['B', 'Bereitschaft', 'shift', '#bdb2ff', '#2a1d6b', null, null, 0, 0],
  ['HO', 'Homeoffice', 'presence', '#a0c4ff', '#0b2e66', null, null, 0, 0],
  ['DR', 'Dienstreise', 'presence', '#9bf6ff', '#00494f', null, null, 0, 0],
  ['FB', 'Fortbildung', 'presence', '#d0f4de', '#1e5233', null, null, 0, 0],
  ['U', 'Urlaub', 'absence', '#5fa8d3', '#ffffff', null, null, 1, 0],
  ['FA', 'Freizeitausgleich', 'absence', '#e9ecef', '#343a40', null, null, 0, 0],
  ['SU', 'Sonderurlaub', 'absence', '#90be6d', '#ffffff', null, null, 0, 0],
  ['K', 'Krank', 'absence', '#f94144', '#ffffff', null, null, 0, 1],
  ['KK', 'Kind krank', 'absence', '#f3722c', '#ffffff', null, null, 0, 1],
] as const;

export function ensureEntryTypes(db: DB): void {
  const n = (db.prepare('SELECT COUNT(*) n FROM entry_types').get() as { n: number }).n;
  if (n > 0) return;
  const ins = db.prepare(
    `INSERT INTO entry_types(code, name, category, color, text_color, start_time, end_time, counts_as_vacation, sensitive, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  DEFAULT_ENTRY_TYPES.forEach((t, i) => ins.run(...t, i * 10));
}

/** Legt beim ersten Start einen Administrator an, falls noch kein Benutzer existiert. */
export function ensureInitialAdmin(db: DB, log = console.log): void {
  ensureEntryTypes(db);
  const n = (db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n;
  if (n > 0) return;
  const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');
  db.prepare(
    `INSERT INTO users(username, display_name, password_hash, is_admin, must_change_password) VALUES ('admin', 'Administrator', ?, 1, 1)`,
  ).run(hashPassword(password));
  log(`\n=== Erster Start: Benutzer "admin" angelegt, Passwort: ${process.env.ADMIN_PASSWORD ? '(aus ADMIN_PASSWORD)' : password} ===\n`);
}
