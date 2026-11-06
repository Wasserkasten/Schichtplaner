/**
 * Schulferien: Quelle ist die freie OpenHolidays-API (openholidaysapi.org, Daten der Kultusministerien).
 * Abgefragt wird nur auf ausdrücklichen Wunsch eines Administrators; gespeichert wird in school_holidays.
 */
import type { DB } from './db.js';
import { getSetting } from './db.js';

export interface Period { start: string; end: string; name: string }
export interface SchoolHolidayRow { id: number; start_date: string; end_date: string; name: string; state: string | null; from_source: number }

export const toDTO = (r: SchoolHolidayRow) => ({ id: r.id, start: r.start_date, end: r.end_date, name: r.name, state: r.state, fromSource: !!r.from_source });

export const SOURCE_URL = 'https://openholidaysapi.org/SchoolHolidays';

/** Bundesland für die Ferien (eigene Einstellung, sonst das der Feiertage). */
export function schoolHolidayState(db: DB): string {
  return getSetting(db, 'school_holiday_state', '') || getSetting(db, 'holiday_state', 'NW');
}

export class SourceError extends Error {}

/** Ferien eines Jahres (alle Zeiträume, die das Jahr berühren) aus der Quelle laden. */
export async function fetchSchoolHolidays(state: string, year: number, fetchImpl: typeof fetch = fetch): Promise<Period[]> {
  const url = `${SOURCE_URL}?countryIsoCode=DE&subdivisionCode=DE-${state}&languageIsoCode=DE&validFrom=${year}-01-01&validTo=${year}-12-31`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new SourceError(`Die Ferien-Quelle (openholidaysapi.org) ist nicht erreichbar: ${(e as Error).message}`);
  }
  if (!res.ok) throw new SourceError(`Die Ferien-Quelle antwortet mit Fehler ${res.status}.`);
  const data = (await res.json()) as { startDate: string; endDate: string; name: { language: string; text: string }[] }[];
  return data
    .map((d) => ({ start: d.startDate, end: d.endDate, name: (d.name.find((n) => n.language === 'DE') ?? d.name[0])?.text ?? 'Ferien' }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** Gespeicherte Ferien, die den Zeitraum berühren. */
export function listSchoolHolidays(db: DB, from: string, to: string): SchoolHolidayRow[] {
  return db.prepare('SELECT * FROM school_holidays WHERE start_date <= ? AND end_date >= ? ORDER BY start_date').all(to, from) as SchoolHolidayRow[];
}
