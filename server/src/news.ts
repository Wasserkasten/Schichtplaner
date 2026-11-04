/**
 * Neuigkeiten für Benutzer aus CHANGELOG.md.
 *
 * Je Version (## [x.y.z] – Datum) zwei optionale Abschnitte:
 *   ### Für alle  -> Hinweisleiste für alle Benutzer („Was ist neu?“)
 *   ### Wichtig   -> Popup beim Start, muss mit „Verstanden“ bestätigt werden (sparsam verwenden!)
 * Alle anderen Abschnitte (Neu, Geändert, Behoben …) sehen nur Administratoren unter Verwaltung → Info.
 */
import type { DB } from './db.js';
import type { UserRow } from './auth.js';
import { APP_VERSION, readChangelog } from './version.js';

export interface VersionNotes {
  version: string;
  date: string;
  forAll: string; // Markdown
  important: string; // Markdown
}

/** Vergleicht Versionsnummern wie 0.3.0 und 0.10.1 (negativ: a < b). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

export function parseChangelog(md: string): VersionNotes[] {
  const out: VersionNotes[] = [];
  let cur: VersionNotes | null = null;
  let section = '';
  for (const line of md.split('\n')) {
    const v = /^##\s+\[?(\d+\.\d+\.\d+)\]?\s*(?:[–-]\s*(.*))?$/.exec(line.trim());
    if (v) {
      cur = { version: v[1], date: (v[2] ?? '').trim(), forAll: '', important: '' };
      out.push(cur);
      section = '';
      continue;
    }
    const h = /^###\s+(.*)$/.exec(line.trim());
    if (h) {
      section = h[1].trim().toLowerCase();
      continue;
    }
    if (!cur) continue;
    if (section === 'für alle') cur.forAll += line + '\n';
    else if (section === 'wichtig') cur.important += line + '\n';
  }
  for (const n of out) {
    n.forAll = n.forAll.trim();
    n.important = n.important.trim();
  }
  return out;
}

let cache: VersionNotes[] | null = null;
/** Nur Versionen bis zur laufenden (ein Changelog-Eintrag für eine künftige Version bleibt unsichtbar). */
export function allNotes(): VersionNotes[] {
  cache ??= parseChangelog(readChangelog()).filter((n) => compareVersions(n.version, APP_VERSION) <= 0);
  return cache;
}

const newerThan = (v: string | null) => (n: VersionNotes) => !v || compareVersions(n.version, v) > 0;

/** Was der Benutzer beim Start sehen soll. */
export function newsFor(user: UserRow, notes: VersionNotes[] = allNotes(), current = APP_VERSION) {
  const unseen = notes.filter(newerThan(user.seen_version)).filter((n) => n.forAll);
  const unacked = notes.filter(newerThan(user.ack_version)).filter((n) => n.important);
  const newVersion = !user.seen_version || compareVersions(current, user.seen_version) > 0;
  return {
    version: current,
    // Leiste: für alle, wenn es Neuigkeiten „für alle“ gibt; Administratoren bei jeder neuen Version
    banner: unseen.length > 0 || (!!user.is_admin && newVersion),
    unseen,
    important: unacked,
  };
}

export function markSeen(db: DB, userId: number): void {
  db.prepare('UPDATE users SET seen_version = ? WHERE id = ?').run(APP_VERSION, userId);
}

export function markAcknowledged(db: DB, userId: number): void {
  db.prepare('UPDATE users SET ack_version = ?, seen_version = COALESCE(seen_version, ?) WHERE id = ?').run(APP_VERSION, APP_VERSION, userId);
}

/** Für Administratoren: Wer hat die wichtigen Hinweise der laufenden Version schon bestätigt? */
export function acknowledgements(db: DB, notes: VersionNotes[] = allNotes()) {
  const latestImportant = [...notes].reverse().find((n) => n.important) ?? null;
  if (!latestImportant) return null;
  const users = db.prepare('SELECT display_name, ack_version FROM users WHERE active = 1 ORDER BY display_name').all() as {
    display_name: string;
    ack_version: string | null;
  }[];
  const done = (u: { ack_version: string | null }) => !!u.ack_version && compareVersions(u.ack_version, latestImportant.version) >= 0;
  return {
    version: latestImportant.version,
    total: users.length,
    acknowledged: users.filter(done).length,
    missing: users.filter((u) => !done(u)).map((u) => u.display_name),
  };
}
