import type { DB } from './db.js';
import { getSetting } from './db.js';
import { holidays, type HolidayKind } from './holidays.js';

export interface HolidayRow {
  id: number;
  date: string;
  name: string;
  kind: HolidayKind;
  from_source: number;
}

export interface HolidayDTO {
  id: number;
  date: string;
  name: string;
  kind: HolidayKind;
  fromSource: boolean;
}

export const toHolidayDTO = (r: HolidayRow): HolidayDTO => ({ id: r.id, date: r.date, name: r.name, kind: r.kind, fromSource: !!r.from_source });

function insertOfficial(db: DB, year: number): void {
  const ins = db.prepare('INSERT OR IGNORE INTO holidays(date, name, kind, from_source) VALUES (?, ?, ?, 1)');
  for (const h of holidays(year, getSetting(db, 'holiday_state', 'NW'))) ins.run(h.date, h.name, 'public');
}

/** Richtet ein Jahr beim ersten Bedarf mit den gesetzlichen Feiertagen des Bundeslandes ein. */
export function ensureYear(db: DB, year: number): void {
  if (db.prepare('SELECT 1 FROM holiday_years WHERE year = ?').get(year)) return;
  db.transaction(() => {
    insertOfficial(db, year);
    db.prepare('INSERT OR IGNORE INTO holiday_years(year) VALUES (?)').run(year);
  })();
}

export function markYear(db: DB, year: number): void {
  db.prepare('INSERT OR IGNORE INTO holiday_years(year) VALUES (?)').run(year);
}

export function listHolidays(db: DB, year: number): HolidayRow[] {
  ensureYear(db, year);
  return db.prepare("SELECT * FROM holidays WHERE date LIKE ? ORDER BY date").all(`${year}-%`) as HolidayRow[];
}

/**
 * Nach einem Wechsel des Bundeslandes: In allen eingerichteten Jahren die unveränderten gesetzlichen
 * Feiertage aus der Quelle durch die des neuen Bundeslandes ersetzen. Eigene und geänderte Einträge bleiben.
 */
export function resyncOfficial(db: DB): void {
  const years = (db.prepare('SELECT year FROM holiday_years').all() as { year: number }[]).map((r) => r.year);
  db.transaction(() => {
    for (const y of years) {
      db.prepare("DELETE FROM holidays WHERE from_source = 1 AND kind = 'public' AND date LIKE ?").run(`${y}-%`);
      insertOfficial(db, y);
    }
  })();
}
