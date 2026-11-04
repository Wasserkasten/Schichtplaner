import type { Bootstrap, Department, Employee, Entry, EntryType, Team } from './types';
import { ApiError } from './api';
import { store } from './store';

export function fullName(e: Employee): string {
  return `${e.lastName}, ${e.firstName}`;
}

/** Teams sortiert nach Abteilung, dann Sortierung/Name des Teams. */
export function sortedTeams(boot: Bootstrap, filter: (t: Team) => boolean = () => true): Team[] {
  const deptOrder = new Map(boot.departments.map((d, i) => [d.id, i]));
  return boot.teams
    .filter(filter)
    .sort((a, b) => (deptOrder.get(a.departmentId)! - deptOrder.get(b.departmentId)!) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function departmentName(boot: Bootstrap, departmentId: number): string {
  return boot.departments.find((d) => d.id === departmentId)?.name ?? '?';
}

/**
 * Team immer mit Abteilung anzeigen – Teamnamen dürfen sich in verschiedenen
 * Abteilungen wiederholen (z. B. „Meisterei 1“ in mehreren Abteilungen).
 */
export function teamLabel(boot: Bootstrap, teamId: number): string {
  const t = boot.teams.find((x) => x.id === teamId);
  return t ? `${departmentName(boot, t.departmentId)} · ${t.name}` : '?';
}

/** Teams nach Abteilung gruppiert, z. B. für <optgroup>-Auswahllisten. */
export function teamsByDepartment(boot: Bootstrap, filter?: (t: Team) => boolean): { department: Department; teams: Team[] }[] {
  const teams = sortedTeams(boot, filter);
  return boot.departments
    .map((department) => ({ department, teams: teams.filter((t) => t.departmentId === department.id) }))
    .filter((g) => g.teams.length > 0);
}

const dmy = (d: string) => d.split('-').reverse().join('.');

/** Ist der Mitarbeiter an diesem Tag beschäftigt (Eintritt/Austritt)? */
export function employedOn(e: Employee, date: string): boolean {
  return (!e.entryDate || date >= e.entryDate) && (!e.exitDate || date <= e.exitDate);
}
/** Überschneidet sich die Beschäftigung mit dem Zeitraum? */
export function employedDuring(e: Employee, from: string, to: string): boolean {
  return (!e.entryDate || e.entryDate <= to) && (!e.exitDate || e.exitDate >= from);
}

/** Warum an diesem Tag nichts eingetragen werden kann – oder null. (Der Server prüft dasselbe.) */
export function blockedReason(boot: Bootstrap, e: Employee, date: string): string | null {
  const start = boot.settings.planStart;
  if (start && date < start) return `vor dem Planungsbeginn (${dmy(start)})`;
  if (e.entryDate && date < e.entryDate) return `vor dem Eintritt am ${dmy(e.entryDate)}`;
  if (e.exitDate && date > e.exitDate) return `nach dem Austritt am ${dmy(e.exitDate)}`;
  return null;
}

/**
 * Frühestes Datum, bis zu dem zurückgeblättert werden kann: eingestellter Planungsbeginn,
 * sonst der Beginn der vorhandenen Daten, höchstens aber der Anfang des aktuellen Monats.
 */
export function minPlanDate(boot: Bootstrap, today: string): string {
  if (boot.settings.planStart) return boot.settings.planStart;
  const monthStart = today.slice(0, 8) + '01';
  const data = boot.settings.dataStart;
  return data && data < monthStart ? data : monthStart;
}

/** Teams (gefiltert) mit ihren aktiven Mitarbeitern, sortiert nach Abteilung/Team; optional nur im Zeitraum Beschäftigte. */
export function groupedEmployees(boot: Bootstrap, teamIds: number[], range?: { from: string; to: string }): { team: Team; employees: Employee[] }[] {
  return sortedTeams(boot, (t) => teamIds.length === 0 || teamIds.includes(t.id))
    .map((team) => ({
      team,
      employees: boot.employees.filter((e) => e.teamId === team.id && e.active && (!range || employedDuring(e, range.from, range.to))),
    }))
    .filter((g) => g.employees.length > 0);
}

export function typeMap(boot: Bootstrap): Map<number, EntryType> {
  return new Map(boot.entryTypes.map((t) => [t.id, t]));
}

export function canEditEmployee(boot: Bootstrap, employeeId: number): boolean {
  const emp = boot.employees.find((e) => e.id === employeeId);
  if (!emp) return false;
  const lvl = boot.permissions.teams[emp.teamId];
  return lvl === 'edit' || lvl === 'manage';
}

export function entryLabel(e: Entry, types: Map<number, EntryType>): string {
  if (e.typeId) return types.get(e.typeId)?.code ?? '?';
  return e.text ?? '';
}

export function entryTitle(e: Entry, types: Map<number, EntryType>): string {
  const t = e.typeId ? types.get(e.typeId) : undefined;
  const time = e.startTime || t?.startTime ? ` (${e.startTime ?? t?.startTime}–${e.endTime ?? t?.endTime})` : '';
  return [t?.name, e.text].filter(Boolean).join(': ') + time;
}

export function reportError(e: unknown) {
  // 409 mit aktuellem Stand = Bearbeitungskonflikt; andere 409 (z. B. „Höchstens 3 Dienste“) mit eigener Meldung
  if (e instanceof ApiError && e.status === 409 && e.data) {
    store.toast('Konflikt: Jemand anderes hat diesen Eintrag gerade geändert. Die Ansicht wurde aktualisiert.', 'error');
    store.upsert([e.data as Entry]);
    return;
  }
  store.toast((e as Error).message || 'Fehler', 'error');
}
