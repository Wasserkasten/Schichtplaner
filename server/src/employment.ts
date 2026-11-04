/**
 * Wann darf für einen Mitarbeiter eingetragen werden?
 *  - nicht vor dem Eintritts- und nicht nach dem Austrittsdatum (falls hinterlegt)
 *  - nicht vor dem Planungsbeginn (Einstellung, falls gesetzt)
 */
import type { DB } from './db.js';
import { getSetting } from './db.js';

const dmy = (d: string) => d.split('-').reverse().join('.');

export function planStart(db: DB): string | null {
  return getSetting(db, 'plan_start', '') || null;
}

/** Frühestes Datum, zu dem es Daten gibt (Einträge oder Eintrittsdaten) – für die Grenze beim Zurückblättern. */
export function dataStart(db: DB): string | null {
  const r = db
    .prepare('SELECT MIN(d) AS d FROM (SELECT MIN(date) AS d FROM entries UNION ALL SELECT MIN(entry_date) FROM employees)')
    .get() as { d: string | null };
  return r.d;
}

export function createEmploymentCheck(db: DB) {
  const stmt = db.prepare('SELECT first_name, last_name, entry_date, exit_date FROM employees WHERE id = ?');
  const start = planStart(db);
  /** null = erlaubt, sonst Begründung, z. B. „vor dem Eintritt am 01.03.2026“ */
  return (employeeId: number, date: string): string | null => {
    const e = stmt.get(employeeId) as { first_name: string; last_name: string; entry_date: string | null; exit_date: string | null } | undefined;
    if (!e) return 'Mitarbeiter nicht gefunden';
    if (start && date < start) return `vor dem Planungsbeginn am ${dmy(start)}`;
    if (e.entry_date && date < e.entry_date) return `${e.first_name} ${e.last_name} tritt erst am ${dmy(e.entry_date)} ein`;
    if (e.exit_date && date > e.exit_date) return `${e.first_name} ${e.last_name} ist am ${dmy(e.exit_date)} ausgetreten`;
    return null;
  };
}
