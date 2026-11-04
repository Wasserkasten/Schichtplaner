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

/** Teams (gefiltert) mit ihren aktiven Mitarbeitern, sortiert nach Abteilung/Team. */
export function groupedEmployees(boot: Bootstrap, teamIds: number[]): { team: Team; employees: Employee[] }[] {
  return sortedTeams(boot, (t) => teamIds.length === 0 || teamIds.includes(t.id))
    .map((team) => ({ team, employees: boot.employees.filter((e) => e.teamId === team.id && e.active) }))
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
  if (e instanceof ApiError && e.status === 409) {
    store.toast('Konflikt: Jemand anderes hat diesen Eintrag gerade geändert. Die Ansicht wurde aktualisiert.', 'error');
    if (e.data) store.upsert([e.data as Entry]);
    return;
  }
  store.toast((e as Error).message || 'Fehler', 'error');
}
