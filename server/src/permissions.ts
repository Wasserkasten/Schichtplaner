import type { DB } from './db.js';
import { getSetting } from './db.js';
import type { UserRow } from './auth.js';

export type Level = 'none' | 'view' | 'edit' | 'manage';
const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2, manage: 3 };

export function maxLevel(a: Level, b: Level): Level {
  return RANK[a] >= RANK[b] ? a : b;
}
export function atLeast(have: Level, need: Level): boolean {
  return RANK[have] >= RANK[need];
}

interface GrantRow {
  scope: 'team' | 'department' | 'all';
  scope_id: number | null;
  level: Level;
}

/**
 * Berechnet die effektive Berechtigung eines Benutzers pro Team.
 *
 * Regeln (die höchste Stufe gewinnt):
 *  1. Administratoren: 'manage' überall.
 *  2. Grundstufe für alle angemeldeten Benutzer (settings.default_level, Standard 'view').
 *  3. Eigenes Team (über verknüpften Mitarbeiter): settings.own_team_level (Standard 'edit').
 *  4. Explizite Freigaben auf Team, Abteilung oder 'all'.
 */
export class Permissions {
  readonly levels = new Map<number, Level>();
  readonly isAdmin: boolean;
  readonly ownEmployeeId: number | null;

  constructor(db: DB, user: UserRow) {
    this.isAdmin = !!user.is_admin;
    this.ownEmployeeId = user.employee_id;

    const teams = db.prepare('SELECT id, department_id FROM teams').all() as { id: number; department_id: number }[];
    const grants = db.prepare('SELECT scope, scope_id, level FROM grants WHERE user_id = ?').all(user.id) as GrantRow[];
    const defaultLevel = getSetting(db, 'default_level', 'view') as Level;
    const ownTeamLevel = getSetting(db, 'own_team_level', 'edit') as Level;

    let ownTeamId: number | null = null;
    if (user.employee_id) {
      const emp = db.prepare('SELECT team_id FROM employees WHERE id = ?').get(user.employee_id) as
        | { team_id: number }
        | undefined;
      ownTeamId = emp?.team_id ?? null;
    }

    for (const t of teams) {
      let lvl: Level = this.isAdmin ? 'manage' : defaultLevel;
      if (t.id === ownTeamId) lvl = maxLevel(lvl, ownTeamLevel);
      for (const g of grants) {
        if (
          g.scope === 'all' ||
          (g.scope === 'team' && g.scope_id === t.id) ||
          (g.scope === 'department' && g.scope_id === t.department_id)
        ) {
          lvl = maxLevel(lvl, g.level);
        }
      }
      this.levels.set(t.id, lvl);
    }
  }

  team(teamId: number): Level {
    return this.levels.get(teamId) ?? 'none';
  }

  can(teamId: number, need: Level): boolean {
    return atLeast(this.team(teamId), need);
  }

  visibleTeamIds(): number[] {
    return [...this.levels.entries()].filter(([, l]) => atLeast(l, 'view')).map(([id]) => id);
  }

  toJSON() {
    return { isAdmin: this.isAdmin, teams: Object.fromEntries(this.levels) };
  }
}
