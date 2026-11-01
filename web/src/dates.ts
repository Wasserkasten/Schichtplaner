export const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Alle Datumswerte werden als ISO-String "YYYY-MM-DD" in UTC behandelt (keine Zeitzonenprobleme). */
export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function parse(s: string): Date {
  return new Date(s + 'T00:00:00Z');
}
export function today(): string {
  const n = new Date();
  return iso(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
}
export function addDays(s: string, n: number): string {
  return iso(new Date(parse(s).getTime() + n * 86400_000));
}
export function addMonths(s: string, n: number): string {
  const d = parse(s);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
}
export function monthStart(s: string): string {
  return s.slice(0, 8) + '01';
}
export function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}
export function range(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}
export function weekday(s: string): number {
  return parse(s).getUTCDay();
}
export function isWeekend(s: string): boolean {
  const w = weekday(s);
  return w === 0 || w === 6;
}
export function fmtLong(s: string): string {
  const d = parse(s);
  return `${['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][d.getUTCDay()]}, ${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function fmtShort(s: string): string {
  return `${s.slice(8, 10)}.${s.slice(5, 7)}.`;
}
/** ISO-Kalenderwoche */
export function isoWeek(s: string): number {
  const d = parse(s);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}
