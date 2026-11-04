import type { Bootstrap } from './types';
import { WEEKDAYS, addDays, parse } from './dates';

/** Minimal, was für eine Beschreibung nötig ist (passt auf Einträge aus dem Store und aus dem Protokoll). */
export interface EntryLike {
  employeeId: number;
  date: string;
  typeId: number | null;
  text: string | null;
  startTime?: string | null;
  endTime?: string | null;
  masked?: boolean;
}

export interface ChangeParts {
  created?: EntryLike[];
  removed?: EntryLike[];
  updated?: { before: EntryLike; after: EntryLike }[];
}

/** Namen für Mitarbeiter, die nicht (mehr) im Plan sichtbar sind, z. B. aus dem Protokoll. */
export type NameLookup = (employeeId: number) => string | undefined;

const short = (t: string | null, n = 24) => (!t ? '' : t.length > n ? t.slice(0, n - 1) + '…' : t);

export function entryLabel(boot: Bootstrap, e: EntryLike): string {
  if (e.typeId) return boot.entryTypes.find((t) => t.id === e.typeId)?.code ?? '?';
  if (e.masked) return 'abwesend';
  return `Notiz „${short(e.text)}“`;
}

function labels(boot: Bootstrap, list: EntryLike[]): string {
  const l = [...new Set(list.map((e) => entryLabel(boot, e)))];
  return l.length > 3 ? `${l.slice(0, 3).join(', ')} …` : l.join(', ');
}

function who(boot: Bootstrap, list: EntryLike[], lookup?: NameLookup): string {
  const ids = [...new Set(list.map((e) => e.employeeId))];
  if (ids.length !== 1) return `${ids.length} Mitarbeiter`;
  const emp = boot.employees.find((e) => e.id === ids[0]);
  return emp ? `${emp.lastName}, ${emp.firstName}` : lookup?.(ids[0]) ?? `Mitarbeiter #${ids[0]}`;
}

const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;

/** „Mi 11.11.“, „11.–13.11.“, „28.11.–02.12.“ oder „5 Tage“ */
export function when(list: EntryLike[]): string {
  const dates = [...new Set(list.map((e) => e.date))].sort();
  if (dates.length === 0) return '';
  if (dates.length === 1) return `${WEEKDAYS[parse(dates[0]).getUTCDay()]} ${dm(dates[0])}`;
  const contiguous = dates.every((d, i) => i === 0 || addDays(dates[i - 1], 1) === d);
  if (!contiguous) return `${dates.length} Tage`;
  const [a, b] = [dates[0], dates[dates.length - 1]];
  return a.slice(0, 7) === b.slice(0, 7) ? `${a.slice(8, 10)}.–${dm(b)}` : `${dm(a)}–${dm(b)}`;
}

/** Kurzbeschreibung einer Änderung, z. B. „U eingetragen · Becker, Anna · 11.–13.11.“ */
export function describeEntries(boot: Bootstrap, c: ChangeParts, lookup?: NameLookup): string {
  const created = c.created ?? [];
  const removed = c.removed ?? [];
  const updated = c.updated ?? [];
  const all = [...created, ...removed, ...updated.map((u) => u.after)];
  const tail = ` · ${who(boot, all, lookup)} · ${when(all)}`;
  if (updated.length === 1 && !created.length && !removed.length) {
    const { before, after } = updated[0];
    const [lb, la] = [entryLabel(boot, before), entryLabel(boot, after)];
    if (lb !== la) return `${lb} → ${la}${tail}`;
    if (before.startTime !== after.startTime || before.endTime !== after.endTime) return `${la}: Uhrzeit geändert${tail}`;
    return `${la} geändert${tail}`;
  }
  if (updated.length) return `${updated.length + created.length + removed.length} Einträge geändert${tail}`;
  if (created.length && removed.length) return `${labels(boot, created)} eingetragen (statt ${labels(boot, removed)})${tail}`;
  if (created.length) return `${labels(boot, created)} eingetragen${tail}`;
  if (removed.length) return `${labels(boot, removed)} gelöscht${tail}`;
  return 'keine Änderung';
}
