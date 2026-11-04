export type Level = 'none' | 'view' | 'edit' | 'manage';

export interface Me {
  id: number;
  username: string;
  displayName: string;
  employeeId: number | null;
  isAdmin: boolean;
  mustChangePassword: boolean;
  /** persönliche Schriftgröße, 1 = 100 % */
  fontScale: number;
}
export interface Department { id: number; name: string; sortOrder: number }
export interface Team { id: number; departmentId: number; name: string; sortOrder: number; level: Level }
export interface Employee {
  id: number;
  teamId: number;
  firstName: string;
  lastName: string;
  shortName: string | null;
  personnelNo: string | null;
  sortOrder: number;
  active: boolean;
  vacationDaysPerYear: number;
}
export interface EntryType {
  id: number;
  code: string;
  name: string;
  category: 'shift' | 'presence' | 'absence';
  color: string;
  textColor: string;
  startTime: string | null;
  endTime: string | null;
  countsAsVacation: boolean;
  sensitive: boolean;
  sortOrder: number;
  active: boolean;
}
export interface Entry {
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
/** public = gesetzlicher Feiertag, company = betrieblich arbeitsfreier Tag (z. B. Heiligabend) */
export interface Holiday { id: number; date: string; name: string; kind: 'public' | 'company'; fromSource: boolean }
export interface Bootstrap {
  me: Me;
  permissions: { isAdmin: boolean; teams: Record<string, Level> };
  departments: Department[];
  teams: Team[];
  employees: Employee[];
  entryTypes: EntryType[];
  users: { id: number; displayName: string }[];
  settings: { holidayState: string };
  /** installierte Version (package.json) */
  version: string;
}
export interface ViewConfig {
  kind: 'month' | 'day' | 'year';
  teamIds: number[];
  employeeId?: number | null;
  days?: number;
  showWeekends?: boolean;
}
export interface SavedView { id: number; name: string; config: ViewConfig; isDefault: boolean; shared: boolean; own: boolean }

export const CATEGORY_LABEL: Record<EntryType['category'], string> = {
  shift: 'Dienste',
  presence: 'Anwesend (sonstige)',
  absence: 'Abwesend',
};
