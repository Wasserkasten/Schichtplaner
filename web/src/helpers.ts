import type { Bootstrap, Employee, Entry, EntryType, Team } from './types';
import { ApiError } from './api';
import { store } from './store';

export function fullName(e: Employee): string {
  return `${e.lastName}, ${e.firstName}`;
}

/** Teams (gefiltert) mit ihren aktiven Mitarbeitern, sortiert nach Abteilung/Team. */
export function groupedEmployees(boot: Bootstrap, teamIds: number[]): { team: Team; employees: Employee[] }[] {
  const deptOrder = new Map(boot.departments.map((d, i) => [d.id, i]));
  return boot.teams
    .filter((t) => teamIds.length === 0 || teamIds.includes(t.id))
    .sort((a, b) => (deptOrder.get(a.departmentId)! - deptOrder.get(b.departmentId)!) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
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
