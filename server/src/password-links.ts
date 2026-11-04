/**
 * Einrichtungs- und Zurücksetz-Links für Passwörter.
 *
 * Der Administrator erzeugt einen Link und gibt ihn weiter (kopieren oder Zugangsschreiben mit QR-Code).
 * Wer ihn öffnet, bestätigt sich mit einem bekannten Merkmal des verknüpften Mitarbeiters (Personalnummer,
 * sonst Kürzel) und legt das Passwort selbst fest – der Administrator kennt es nie.
 * Links sind begrenzt gültig, nur einmal nutzbar und nach zu vielen Fehlversuchen gesperrt.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DB } from './db.js';
import { hashPassword } from './auth.js';

export const LINK_DAYS = 7;
export const MAX_ATTEMPTS = 5;
export type SecretKind = 'personnel_no' | 'short_name';
export type Purpose = 'setup' | 'reset';
export const SECRET_LABEL: Record<SecretKind, string> = { personnel_no: 'Personalnummer', short_name: 'Kürzel' };

interface TokenRow {
  id: number;
  user_id: number;
  purpose: Purpose;
  secret_kind: SecretKind | null;
  expires_at: string;
  used_at: string | null;
  attempts: number;
}

export class LinkError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** Leerzeichen und Groß-/Kleinschreibung spielen beim Prüfmerkmal keine Rolle. */
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** Unbenutzbares Passwort für Konten, die ihr Passwort über einen Link selbst festlegen. */
export function unusablePasswordHash(): string {
  return hashPassword(randomBytes(32).toString('base64url'));
}

function employeeOf(db: DB, userId: number) {
  return db
    .prepare('SELECT e.personnel_no, e.short_name FROM users u JOIN employees e ON e.id = u.employee_id WHERE u.id = ?')
    .get(userId) as { personnel_no: string | null; short_name: string | null } | undefined;
}

/** Personalnummer, falls vorhanden, sonst Kürzel, sonst kein Prüfmerkmal. */
export function secretKindFor(db: DB, userId: number): SecretKind | null {
  const e = employeeOf(db, userId);
  if (e?.personnel_no?.trim()) return 'personnel_no';
  if (e?.short_name?.trim()) return 'short_name';
  return null;
}

/** Erzeugt einen neuen Link; noch offene Links desselben Benutzers werden ungültig. */
export function createPasswordLink(db: DB, userId: number, purpose: Purpose, createdBy: number | null) {
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + LINK_DAYS * 86400_000).toISOString();
  const secretKind = secretKindFor(db, userId);
  db.transaction(() => {
    db.prepare('DELETE FROM password_tokens WHERE user_id = ? AND used_at IS NULL').run(userId);
    db.prepare('INSERT INTO password_tokens(user_id, token_hash, purpose, secret_kind, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      userId,
      sha(token),
      purpose,
      secretKind,
      createdBy,
      expiresAt,
    );
  })();
  return { token, expiresAt, secretKind, purpose };
}

function find(db: DB, token: string): TokenRow | undefined {
  return db.prepare('SELECT * FROM password_tokens WHERE token_hash = ?').get(sha(token)) as TokenRow | undefined;
}

function check(t: TokenRow | undefined): TokenRow {
  if (!t) throw new LinkError(404, 'Dieser Link ist ungültig. Vielleicht wurde inzwischen ein neuer erstellt.');
  if (t.used_at) throw new LinkError(410, 'Dieser Link wurde bereits benutzt.');
  if (t.attempts >= MAX_ATTEMPTS) throw new LinkError(423, 'Dieser Link ist nach zu vielen Fehlversuchen gesperrt.');
  if (t.expires_at < new Date().toISOString()) throw new LinkError(410, 'Dieser Link ist abgelaufen.');
  return t;
}

/** Was die Seite zum Link anzeigen darf (nur wer den Link hat, sieht das). */
export function linkInfo(db: DB, token: string) {
  const t = check(find(db, token));
  const u = db.prepare('SELECT username, display_name, active FROM users WHERE id = ?').get(t.user_id) as
    | { username: string; display_name: string; active: number }
    | undefined;
  if (!u || !u.active) throw new LinkError(410, 'Das zugehörige Konto ist deaktiviert.');
  return {
    username: u.username,
    displayName: u.display_name,
    purpose: t.purpose,
    secretLabel: t.secret_kind ? SECRET_LABEL[t.secret_kind] : null,
    expiresAt: t.expires_at,
  };
}

/** Prüfmerkmal kontrollieren und Passwort setzen. Gibt die Benutzer-ID zurück (für die Anmeldung). */
export function usePasswordLink(db: DB, token: string, secret: string, password: string): number {
  const result = db.transaction((): { userId: number } | { error: string } => {
    const t = check(find(db, token));
    if (t.secret_kind) {
      const e = employeeOf(db, t.user_id);
      const expected = norm(String((t.secret_kind === 'personnel_no' ? e?.personnel_no : e?.short_name) ?? ''));
      const given = norm(secret);
      const ok = expected.length > 0 && given.length > 0 && timingSafeEqual(Buffer.from(sha(expected)), Buffer.from(sha(given)));
      if (!ok) {
        db.prepare('UPDATE password_tokens SET attempts = attempts + 1 WHERE id = ?').run(t.id);
        const left = MAX_ATTEMPTS - t.attempts - 1;
        // Fehlversuch muss gespeichert bleiben -> Fehler erst nach dem Commit werfen
        return { error: left > 0 ? `${SECRET_LABEL[t.secret_kind]} stimmt nicht. Noch ${left} Versuch${left === 1 ? '' : 'e'}.` : 'Zu viele Fehlversuche – der Link ist jetzt gesperrt.' };
      }
    }
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(password), t.user_id);
    db.prepare("UPDATE password_tokens SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(t.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.user_id); // überall abmelden
    return { userId: t.user_id };
  })();
  // Fehlversuch ist gespeichert (Transaktion abgeschlossen) – jetzt erst den Fehler melden
  if ('error' in result) throw new LinkError(403, result.error);
  return result.userId;
}

/** Offene Links je Benutzer (für die Benutzerliste). */
export function openLinks(db: DB): Map<number, { purpose: Purpose; expiresAt: string }> {
  const rows = db
    .prepare("SELECT user_id, purpose, expires_at FROM password_tokens WHERE used_at IS NULL AND attempts < ? AND expires_at > ?")
    .all(MAX_ATTEMPTS, new Date().toISOString()) as { user_id: number; purpose: Purpose; expires_at: string }[];
  return new Map(rows.map((r) => [r.user_id, { purpose: r.purpose, expiresAt: r.expires_at }]));
}
