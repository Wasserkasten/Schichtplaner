/**
 * Sicherungen der Datenbank.
 *
 * Eine Sicherung ist eine vollständige, konsistente Kopie der SQLite-Datenbank (Benutzer, Plan, Protokoll,
 * Einstellungen), angelegt im laufenden Betrieb über die Online-Backup-Funktion von SQLite.
 *
 * Dateinamen (alle in einem Ordner):
 *   schichtplaner-YYYYMMDD-HHMMSS.db        automatisch (Zeitplan) – nur diese werden rotiert
 *   manuell-YYYYMMDD-HHMMSS.db              „Jetzt sichern“
 *   vor-wiederherstellung-YYYYMMDD-HHMMSS.db automatisch vor jedem Einspielen
 *   hochgeladen-YYYYMMDD-HHMMSS.db          über die Oberfläche hochgeladen
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import type { DB } from './db.js';
import { getSetting, setSetting } from './db.js';
import { APP_VERSION } from './version.js';

export type BackupKind = 'auto' | 'manual' | 'safety' | 'upload';
const PREFIX: Record<BackupKind, string> = { auto: 'schichtplaner', manual: 'manuell', safety: 'vor-wiederherstellung', upload: 'hochgeladen' };
const NAME_RE = /^(schichtplaner|manuell|vor-wiederherstellung|hochgeladen)-(\d{8})-(\d{6})\.db$/;

export interface Schedule {
  mode: 'off' | 'hourly' | 'daily' | 'weekly';
  time: string; // "HH:MM" (stündlich: nur die Minute zählt)
  weekday: number; // 0 = Sonntag … 6 = Samstag (wöchentlich)
  keep: number; // Anzahl aufbewahrter automatischer Sicherungen
  extraDir: string; // zusätzlicher Speicherort (z. B. eingebundenes NAS), leer = keiner
}

export interface LastBackup { at: string; ok: boolean; file?: string; error?: string; extraError?: string }

/** Lokale Zeit (TZ des Servers) für Dateinamen, z. B. 20261106-023000. */
function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function defaultSchedule(): Schedule {
  return { mode: 'daily', time: '02:30', weekday: 0, keep: Number(process.env.BACKUP_KEEP ?? 14) || 14, extraDir: '' };
}

export function getSchedule(db: DB): Schedule {
  try {
    return { ...defaultSchedule(), ...(JSON.parse(getSetting(db, 'backup_schedule', '{}')) as Partial<Schedule>) };
  } catch {
    return defaultSchedule();
  }
}

export function getLastBackup(db: DB): LastBackup | null {
  const raw = getSetting(db, 'backup_last', '');
  return raw ? (JSON.parse(raw) as LastBackup) : null;
}

/** Konsistente Sicherung im laufenden Betrieb (SQLite Online-Backup). */
export async function backupTo(db: DB, file: string): Promise<void> {
  mkdirSync(dirname(file), { recursive: true });
  await db.backup(file);
}

/** Freier Dateiname im Ordner (zwei Sicherungen in derselben Sekunde überschreiben sich nicht). */
function uniqueFile(dir: string, kind: BackupKind): string {
  mkdirSync(dir, { recursive: true });
  let file = join(dir, `${PREFIX[kind]}-${stamp()}.db`);
  for (let i = 1; existsSync(file); i++) file = join(dir, `${PREFIX[kind]}-${stamp(new Date(Date.now() + i * 1000))}.db`);
  return file;
}

/** Legt eine Sicherung der gewünschten Art an; automatische werden rotiert, alle optional zusätzlich kopiert. */
export async function createBackup(db: DB, dir: string, kind: BackupKind): Promise<string> {
  const file = uniqueFile(dir, kind);
  const last: LastBackup = { at: new Date().toISOString(), ok: true, file: basename(file) };
  try {
    await backupTo(db, file);
    if (kind === 'auto') rotate(dir, getSchedule(db).keep);
    const extra = getSchedule(db).extraDir.trim();
    if (extra && kind !== 'upload') {
      try {
        mkdirSync(extra, { recursive: true });
        copyFileSync(file, join(extra, basename(file)));
        if (kind === 'auto') rotate(extra, getSchedule(db).keep);
      } catch (e) {
        last.extraError = `Kopie in „${extra}“ fehlgeschlagen: ${(e as Error).message}`;
      }
    }
    return file;
  } catch (e) {
    last.ok = false;
    last.error = (e as Error).message;
    throw e;
  } finally {
    if (kind === 'auto' || kind === 'manual') setSetting(db, 'backup_last', JSON.stringify(last));
    if (kind === 'auto') setSetting(db, 'backup_last_auto', last.at); // auch bei Fehlschlag: nicht jede Minute neu versuchen
  }
}

/** Nur die automatischen Sicherungen rotieren; manuelle usw. bleiben, bis sie jemand löscht. */
function rotate(dir: string, keep: number): void {
  const old = readdirSync(dir)
    .filter((f) => /^schichtplaner-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse()
    .slice(Math.max(1, keep));
  for (const f of old) rmSync(join(dir, f));
}

/** Für die alte Kommandozeile/Tests: automatische Sicherung mit fester Aufbewahrung. */
export async function rotatingBackup(db: DB, dir: string, keep: number): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `schichtplaner-${stamp()}.db`);
  await backupTo(db, file);
  rotate(dir, keep);
  return file;
}

export interface BackupFile { name: string; kind: BackupKind; size: number; createdAt: string }

export function listBackups(dir: string): BackupFile[] {
  if (!existsSync(dir)) return [];
  const kinds: Record<string, BackupKind> = { schichtplaner: 'auto', manuell: 'manual', 'vor-wiederherstellung': 'safety', hochgeladen: 'upload' };
  return readdirSync(dir)
    .map((name) => ({ name, m: NAME_RE.exec(name) }))
    .filter((x) => x.m)
    .map(({ name, m }) => {
      const st = statSync(join(dir, name));
      const [d, t] = [m![2], m![3]];
      const created = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
      return { name, kind: kinds[m![1]], size: st.size, createdAt: created.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Pfad einer Sicherung – nur Dateien mit gültigem Namen im Sicherungsordner (kein Ausbrechen per „../“). */
export function backupPath(dir: string, name: string): string | null {
  if (!NAME_RE.test(name)) return null;
  const p = join(dir, name);
  return existsSync(p) ? p : null;
}

/** Ist das eine Schichtplaner-Datenbank? Gibt eine Fehlermeldung zurück oder null. */
export function checkBackupFile(file: string): string | null {
  const head = readFileSync(file).subarray(0, 16).toString('latin1');
  if (head !== 'SQLite format 3\u0000') return 'Die Datei ist keine SQLite-Datenbank.';
  let bk: Database.Database | null = null;
  try {
    bk = new Database(file, { readonly: true, fileMustExist: true });
    const ok = (bk.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check;
    if (ok !== 'ok') return `Die Datenbank ist beschädigt (${ok}).`;
    for (const t of ['users', 'employees', 'entries']) {
      if (!bk.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)) return 'Die Datei ist keine Schichtplaner-Sicherung.';
    }
    return null;
  } catch (e) {
    return `Die Datei kann nicht gelesen werden: ${(e as Error).message}`;
  } finally {
    bk?.close();
  }
}

/** Hochgeladene Datei prüfen und im Sicherungsordner ablegen. */
export function storeUpload(dir: string, data: Buffer): { name: string } | { error: string } {
  const file = uniqueFile(dir, 'upload');
  const name = basename(file);
  writeFileSync(file, data);
  const err = checkBackupFile(file);
  if (err) {
    rmSync(file, { force: true });
    return { error: err };
  }
  return { name };
}

/** Nicht mit zurückspielen: Anmeldungen, offene Passwort-Links und Server-Einstellungen bleiben, wie sie sind. */
const KEEP_TABLES = new Set(['sessions', 'password_tokens']);
const KEEP_SETTINGS = ['backup_schedule', 'backup_last', 'backup_last_auto', 'app_version'];

/**
 * Sicherung im laufenden Betrieb einspielen: vorher Sicherheitskopie, dann in einer Transaktion alle Tabellen
 * durch den Inhalt der Sicherung ersetzen. Ältere Sicherungen (weniger Spalten/Tabellen) werden passend übernommen.
 */
export async function restoreLive(db: DB, dir: string, file: string): Promise<{ safety: string }> {
  const err = checkBackupFile(file);
  if (err) throw new Error(err);
  const safety = await createBackup(db, dir, 'safety');
  const keptSettings = KEEP_SETTINGS.map((k) => [k, getSetting(db, k, '')] as const);

  db.pragma('foreign_keys = OFF'); // Reihenfolge der Tabellen egal; am Ende wieder an
  db.prepare('ATTACH DATABASE ? AS bk').run(file);
  try {
    const tables = (db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
      .map((t) => t.name)
      .filter((t) => !KEEP_TABLES.has(t));
    const inBackup = new Set((db.prepare("SELECT name FROM bk.sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
    const cols = (schema: string, t: string) => (db.prepare(`PRAGMA ${schema}.table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);
    // Einstellungen zuerst: der Trigger beim Einfügen von Benutzern liest app_version
    tables.sort((a, b) => Number(b === 'settings') - Number(a === 'settings'));
    db.transaction(() => {
      for (const t of tables) {
        db.prepare(`DELETE FROM main."${t}"`).run();
        if (!inBackup.has(t)) continue; // Tabelle gab es in der alten Version noch nicht -> bleibt leer
        const backupCols = new Set(cols('bk', t));
        const common = cols('main', t).filter((c) => backupCols.has(c)).map((c) => `"${c}"`).join(', ');
        db.prepare(`INSERT INTO main."${t}" (${common}) SELECT ${common} FROM bk."${t}"`).run();
        if (t === 'settings') {
          for (const [k, v] of keptSettings) if (v) setSetting(db, k, v);
          setSetting(db, 'app_version', APP_VERSION);
        }
      }
    })();
  } finally {
    db.prepare('DETACH DATABASE bk').run();
    db.pragma('foreign_keys = ON');
  }
  return { safety: basename(safety) };
}

/** Zeitpunkt des letzten fälligen Termins vor/gleich `now` (oder null bei „aus“). */
export function lastSlot(s: Schedule, now = new Date()): Date | null {
  if (s.mode === 'off') return null;
  const [h, m] = s.time.split(':').map(Number);
  const d = new Date(now);
  d.setSeconds(0, 0);
  if (s.mode === 'hourly') {
    d.setMinutes(m);
    if (d > now) d.setHours(d.getHours() - 1);
    return d;
  }
  d.setHours(h, m);
  if (s.mode === 'daily') {
    if (d > now) d.setDate(d.getDate() - 1);
    return d;
  }
  // wöchentlich
  d.setDate(d.getDate() - ((d.getDay() - s.weekday + 7) % 7));
  if (d > now) d.setDate(d.getDate() - 7);
  return d;
}

/** Nächster Termin (für die Anzeige). */
export function nextSlot(s: Schedule, now = new Date()): Date | null {
  const last = lastSlot(s, now);
  if (!last) return null;
  const d = new Date(last);
  if (s.mode === 'hourly') d.setHours(d.getHours() + 1);
  else if (s.mode === 'daily') d.setDate(d.getDate() + 1);
  else d.setDate(d.getDate() + 7);
  return d;
}

/** Prüft jede Minute, ob eine Sicherung fällig ist (auch nachgeholt, wenn der Server zum Termin aus war). */
export function startBackupScheduler(db: DB, dir: string, log: (msg: string) => void): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    const s = getSchedule(db);
    const slot = lastSlot(s);
    if (!slot) return;
    const lastAuto = getSetting(db, 'backup_last_auto', '');
    if (lastAuto && new Date(lastAuto) >= slot) return;
    running = true;
    try {
      const f = await createBackup(db, dir, 'auto');
      log(`Backup erstellt: ${f}`);
    } catch (e) {
      log(`Backup fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 30_000).unref();
  setInterval(() => void tick(), 60_000).unref();
}
