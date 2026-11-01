import type { DB } from './db.js';
import { Permissions, atLeast } from './permissions.js';

export interface EntryRow {
  id: number;
  employee_id: number;
  date: string;
  type_id: number | null;
  text: string | null;
  start_time: string | null;
  end_time: string | null;
  version: number;
  updated_by: number | null;
  updated_at: string;
}

export interface EntryDTO {
  id: number;
  employeeId: number;
  date: string;
  typeId: number | null;
  text: string | null;
  startTime: string | null;
  endTime: string | null;
  version: number;
  updatedBy: number | null;
  updatedAt: string;
  masked?: boolean;
}

/** Hilfsdaten, um Einträge pro Benutzer filtern/maskieren zu können. */
export class EntryContext {
  readonly teamOf = new Map<number, number>();
  readonly sensitiveTypes = new Set<number>();

  constructor(db: DB) {
    for (const e of db.prepare('SELECT id, team_id FROM employees').all() as { id: number; team_id: number }[]) {
      this.teamOf.set(e.id, e.team_id);
    }
    for (const t of db.prepare('SELECT id FROM entry_types WHERE sensitive = 1').all() as { id: number }[]) {
      this.sensitiveTypes.add(t.id);
    }
  }

  /**
   * Gibt den Eintrag so zurück, wie der Benutzer ihn sehen darf – oder null.
   * Sensible Abwesenheiten (z.B. Krank) sehen nur Bearbeiter des Teams und der
   * Mitarbeiter selbst im Klartext; alle anderen sehen nur "abwesend".
   */
  present(row: EntryRow, perms: Permissions): EntryDTO | null {
    const teamId = this.teamOf.get(row.employee_id);
    if (teamId === undefined) return null;
    const lvl = perms.team(teamId);
    if (!atLeast(lvl, 'view')) return null;
    const dto = toDTO(row);
    const isSelf = perms.ownEmployeeId === row.employee_id;
    if (row.type_id && this.sensitiveTypes.has(row.type_id) && !atLeast(lvl, 'edit') && !isSelf) {
      return { ...dto, typeId: null, text: 'abwesend', updatedBy: null, masked: true };
    }
    return dto;
  }
}

export function toDTO(r: EntryRow): EntryDTO {
  return {
    id: r.id,
    employeeId: r.employee_id,
    date: r.date,
    typeId: r.type_id,
    text: r.text,
    startTime: r.start_time,
    endTime: r.end_time,
    version: r.version,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}
