import { useEffect, useState } from 'react';
import { api, del, get, post, put } from '../api';
import { store, useStore } from '../store';
import { departmentName, fullName, reportError, sortedTeams, teamLabel, teamsByDepartment } from '../helpers';
import type { Employee, EntryType, Level } from '../types';
import { Modal } from '../components/Modal';
import { HolidayAdmin } from './HolidayAdmin';
import { AuditLog } from './AuditLog';
import { InfoView } from './InfoView';

export type AdminTab = 'employees' | 'structure' | 'users' | 'types' | 'holidays' | 'settings' | 'audit' | 'info';
type Tab = AdminTab;

export function AdminView({ initialTab = 'employees' }: { initialTab?: AdminTab }) {
  const { boot } = useStore();
  const isAdmin = boot!.me.isAdmin;
  const [tab, setTab] = useState<Tab>(initialTab);
  const tabs: [Tab, string, boolean][] = [
    ['employees', 'Mitarbeiter', true],
    ['structure', 'Abteilungen & Teams', isAdmin],
    ['users', 'Benutzer & Rechte', isAdmin],
    ['types', 'An-/Abwesenheitsarten', isAdmin],
    ['holidays', 'Feiertage', isAdmin],
    ['settings', 'Einstellungen', isAdmin],
    ['audit', 'Protokoll', isAdmin],
    ['info', 'Info', isAdmin],
  ];
  return (
    <div className="admin">
      <div className="subtabs">
        {tabs
          .filter(([, , show]) => show)
          .map(([k, label]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
      </div>
      {tab === 'employees' && <Employees />}
      {tab === 'structure' && <Structure />}
      {tab === 'users' && <Users />}
      {tab === 'types' && <Types />}
      {tab === 'holidays' && <HolidayAdmin stateName={(c) => STATES[c] ?? c} />}
      {tab === 'settings' && (
        <>
          <Settings />
          <DemoData />
        </>
      )}
      {tab === 'audit' && <AuditLog />}
      {tab === 'info' && <InfoView />}
    </div>
  );
}

async function run(fn: () => Promise<unknown>, ok = 'Gespeichert') {
  try {
    await fn();
    await store.loadBootstrap();
    store.toast(ok);
    return true;
  } catch (e) {
    reportError(e);
    return false;
  }
}

// ---------------- Mitarbeiter ----------------
function Employees() {
  const { boot } = useStore();
  const manageable = boot!.teams.filter((t) => t.level === 'manage');
  const [edit, setEdit] = useState<Partial<Employee> | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const teamOrder = new Map(sortedTeams(boot!).map((t, i) => [t.id, i]));
  return (
    <div>
      <div className="toolbar">
        <button className="primary" disabled={!manageable.length} onClick={() => setEdit({ teamId: manageable[0]?.id, active: true, vacationDaysPerYear: 30, sortOrder: 0 })}>
          + Mitarbeiter
        </button>
        <label><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> inaktive anzeigen</label>
      </div>
      <table className="simple">
        <thead><tr><th>Name</th><th>Kürzel</th><th>Abteilung</th><th>Team</th><th>Pers.-Nr.</th><th>Urlaub/Jahr</th><th /></tr></thead>
        <tbody>
          {boot!.employees
            .filter((e) => showInactive || e.active)
            .sort((a, b) => (teamOrder.get(a.teamId) ?? 0) - (teamOrder.get(b.teamId) ?? 0) || a.sortOrder - b.sortOrder || fullName(a).localeCompare(fullName(b), 'de'))
            .map((e) => {
              const team = boot!.teams.find((t) => t.id === e.teamId);
              return (
                <tr key={e.id} className={e.active ? '' : 'inactive'}>
                  <td>{fullName(e)}</td>
                  <td>{e.shortName}</td>
                  <td>{team ? departmentName(boot!, team.departmentId) : ''}</td>
                  <td>{team?.name}</td>
                  <td>{e.personnelNo}</td>
                  <td>{e.vacationDaysPerYear}</td>
                  <td>{team?.level === 'manage' && <button onClick={() => setEdit(e)}>Bearbeiten</button>}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
      {edit && <EmployeeForm value={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EmployeeForm({ value, onClose }: { value: Partial<Employee>; onClose: () => void }) {
  const { boot } = useStore();
  const [v, setV] = useState(value);
  const set = (k: keyof Employee, val: unknown) => setV({ ...v, [k]: val });
  async function save() {
    const body = { ...v, shortName: v.shortName || null, personnelNo: v.personnelNo || null };
    if (await run(() => (v.id ? put(`/api/admin/employees/${v.id}`, body) : post('/api/admin/employees', body)))) onClose();
  }
  async function remove() {
    if (!confirm('Mitarbeiter endgültig löschen? Alle Planeinträge gehen verloren. Besser: auf „inaktiv“ setzen.')) return;
    if (await run(() => del(`/api/admin/employees/${v.id}`), 'Gelöscht')) onClose();
  }
  return (
    <Modal title={v.id ? 'Mitarbeiter bearbeiten' : 'Neuer Mitarbeiter'} onClose={onClose}>
      <div className="form grid2">
        <label>Vorname<input value={v.firstName ?? ''} onChange={(e) => set('firstName', e.target.value)} /></label>
        <label>Nachname<input value={v.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} /></label>
        <label>Kürzel<input value={v.shortName ?? ''} maxLength={10} onChange={(e) => set('shortName', e.target.value)} /></label>
        <label>Personalnummer<input value={v.personnelNo ?? ''} onChange={(e) => set('personnelNo', e.target.value)} /></label>
        <label>Team
          <select value={v.teamId} onChange={(e) => set('teamId', Number(e.target.value))}>
            {teamsByDepartment(boot!, (t) => t.level === 'manage').map(({ department, teams }) => (
              <optgroup key={department.id} label={department.name}>
                {teams.map((t) => <option key={t.id} value={t.id}>{department.name} · {t.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label>Urlaubstage/Jahr<input type="number" min={0} value={v.vacationDaysPerYear ?? 30} onChange={(e) => set('vacationDaysPerYear', Number(e.target.value))} /></label>
        <label>Sortierung<input type="number" value={v.sortOrder ?? 0} onChange={(e) => set('sortOrder', Number(e.target.value))} /></label>
        <label className="inline"><input type="checkbox" checked={v.active ?? true} onChange={(e) => set('active', e.target.checked)} /> aktiv</label>
      </div>
      <div className="actions">
        {v.id && boot!.me.isAdmin && <button className="danger" onClick={() => void remove()}>Löschen</button>}
        <button className="primary" disabled={!v.firstName || !v.lastName} onClick={() => void save()}>Speichern</button>
      </div>
    </Modal>
  );
}

// ---------------- Abteilungen & Teams ----------------
function Structure() {
  const { boot } = useStore();
  const [deptName, setDeptName] = useState('');
  const [teamName, setTeamName] = useState<Record<number, string>>({});
  return (
    <div className="structure">
      {boot!.departments.map((d) => (
        <div key={d.id} className="card">
          <div className="row">
            <h3>{d.name}</h3>
            <button onClick={() => { const n = prompt('Neuer Name', d.name); if (n) void run(() => put(`/api/admin/departments/${d.id}`, { name: n, sortOrder: d.sortOrder })); }}>Umbenennen</button>
            <button className="danger" onClick={() => void run(() => del(`/api/admin/departments/${d.id}`), 'Gelöscht')}>Löschen</button>
          </div>
          <ul>
            {boot!.teams.filter((t) => t.departmentId === d.id).map((t) => (
              <li key={t.id} className="row">
                {t.name}
                <span className="muted small">({boot!.employees.filter((e) => e.teamId === t.id).length} MA)</span>
                <button onClick={() => { const n = prompt('Neuer Name', t.name); if (n) void run(() => put(`/api/admin/teams/${t.id}`, { departmentId: d.id, name: n, sortOrder: t.sortOrder })); }}>Umbenennen</button>
                <button className="danger" onClick={() => void run(() => del(`/api/admin/teams/${t.id}`), 'Gelöscht')}>Löschen</button>
              </li>
            ))}
          </ul>
          <div className="row">
            <input placeholder="Neues Team" value={teamName[d.id] ?? ''} onChange={(e) => setTeamName({ ...teamName, [d.id]: e.target.value })} />
            <button disabled={!teamName[d.id]} onClick={() => void run(() => post('/api/admin/teams', { departmentId: d.id, name: teamName[d.id] })).then(() => setTeamName({ ...teamName, [d.id]: '' }))}>+ Team</button>
          </div>
        </div>
      ))}
      <div className="row">
        <input placeholder="Neue Abteilung" value={deptName} onChange={(e) => setDeptName(e.target.value)} />
        <button disabled={!deptName} onClick={() => void run(() => post('/api/admin/departments', { name: deptName })).then(() => setDeptName(''))}>+ Abteilung</button>
      </div>
    </div>
  );
}

// ---------------- Benutzer & Rechte ----------------
interface Grant { scope: 'team' | 'department' | 'all'; scopeId: number | null; level: Exclude<Level, 'none'> }
interface AdminUser { id?: number; username: string; displayName: string; employeeId: number | null; isAdmin: boolean; active: boolean; password?: string; grants: Grant[] }

const LEVEL_LABEL: Record<string, string> = { view: 'ansehen', edit: 'bearbeiten', manage: 'verwalten' };

function Users() {
  const { boot } = useStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [edit, setEdit] = useState<AdminUser | null>(null);
  const load = () => get<AdminUser[]>('/api/admin/users').then(setUsers, reportError);
  useEffect(() => void load(), []);
  const scopeName = (g: Grant) =>
    g.scope === 'all' ? 'alle Teams' : g.scope === 'department' ? `Abt. ${boot!.departments.find((d) => d.id === g.scopeId)?.name}` : teamLabel(boot!, g.scopeId!);
  return (
    <div>
      <div className="toolbar">
        <button className="primary" onClick={() => setEdit({ username: '', displayName: '', employeeId: null, isAdmin: false, active: true, grants: [] })}>+ Benutzer</button>
        <span className="muted small">Jeder Benutzer darf automatisch das eigene Team (über den verknüpften Mitarbeiter) bearbeiten – siehe Einstellungen.</span>
      </div>
      <table className="simple">
        <thead><tr><th>Benutzer</th><th>Name</th><th>Mitarbeiter</th><th>Rechte</th><th /></tr></thead>
        <tbody>
          {users.map((u) => {
            const emp = boot!.employees.find((e) => e.id === u.employeeId);
            return (
              <tr key={u.id} className={u.active ? '' : 'inactive'}>
                <td>{u.username}</td>
                <td>{u.displayName}</td>
                <td>{emp ? fullName(emp) : '–'}</td>
                <td>
                  {u.isAdmin && <span className="badge">Administrator</span>}
                  {u.grants.map((g, i) => <span key={i} className="badge light">{scopeName(g)}: {LEVEL_LABEL[g.level]}</span>)}
                </td>
                <td><button onClick={() => setEdit(u)}>Bearbeiten</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {edit && <UserForm value={edit} onClose={() => { setEdit(null); void load(); }} />}
    </div>
  );
}

function UserForm({ value, onClose }: { value: AdminUser; onClose: () => void }) {
  const { boot } = useStore();
  const [v, setV] = useState<AdminUser>({ ...value, password: '' });
  const setGrant = (i: number, g: Partial<Grant>) => setV({ ...v, grants: v.grants.map((x, j) => (i === j ? { ...x, ...g } : x)) });
  async function save() {
    const body = { ...v, password: v.password || undefined };
    if (await run(() => (v.id ? put(`/api/admin/users/${v.id}`, body) : post('/api/admin/users', body)))) onClose();
  }
  return (
    <Modal title={v.id ? 'Benutzer bearbeiten' : 'Neuer Benutzer'} onClose={onClose} wide>
      <div className="form grid2">
        <label>Benutzername<input value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} /></label>
        <label>Anzeigename<input value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} /></label>
        <label>Verknüpfter Mitarbeiter
          <select value={v.employeeId ?? ''} onChange={(e) => setV({ ...v, employeeId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">– keiner –</option>
            {boot!.employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)} ({teamLabel(boot!, e.teamId)})</option>)}
          </select>
        </label>
        <label>{v.id ? 'Neues Passwort (leer = unverändert)' : 'Startpasswort'}
          <input type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
        </label>
        <label className="inline"><input type="checkbox" checked={v.isAdmin} onChange={(e) => setV({ ...v, isAdmin: e.target.checked })} /> Administrator</label>
        <label className="inline"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> aktiv</label>
      </div>
      <h3>Zusätzliche Berechtigungen</h3>
      <p className="muted small">„ansehen“ = Plan lesen · „bearbeiten“ = Einträge ändern · „verwalten“ = zusätzlich Mitarbeiter anlegen/ändern</p>
      {v.grants.map((g, i) => (
        <div key={i} className="row">
          <select value={g.scope} onChange={(e) => setGrant(i, { scope: e.target.value as Grant['scope'], scopeId: null })}>
            <option value="team">Team</option>
            <option value="department">Abteilung</option>
            <option value="all">Alle</option>
          </select>
          {g.scope !== 'all' && (
            <select value={g.scopeId ?? ''} onChange={(e) => setGrant(i, { scopeId: Number(e.target.value) })}>
              <option value="">– wählen –</option>
              {g.scope === 'team'
                ? teamsByDepartment(boot!).map(({ department, teams }) => (
                    <optgroup key={department.id} label={department.name}>
                      {teams.map((t) => <option key={t.id} value={t.id}>{department.name} · {t.name}</option>)}
                    </optgroup>
                  ))
                : boot!.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
          <select value={g.level} onChange={(e) => setGrant(i, { level: e.target.value as Grant['level'] })}>
            {Object.entries(LEVEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button className="icon" onClick={() => setV({ ...v, grants: v.grants.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button onClick={() => setV({ ...v, grants: [...v.grants, { scope: 'team', scopeId: null, level: 'edit' }] })}>+ Berechtigung</button>
      <div className="actions">
        <button className="primary" disabled={!v.username || !v.displayName || (!v.id && (v.password ?? '').length < 8)} onClick={() => void save()}>Speichern</button>
      </div>
    </Modal>
  );
}

// ---------------- Eintragsarten ----------------
function Types() {
  const { boot } = useStore();
  const [edit, setEdit] = useState<Partial<EntryType> | null>(null);
  const cat = { shift: 'Dienst', presence: 'Anwesenheit', absence: 'Abwesenheit' };
  return (
    <div>
      <div className="toolbar">
        <button className="primary" onClick={() => setEdit({ category: 'shift', color: '#dddddd', textColor: '#000000', active: true, sortOrder: 100 })}>+ Eintragsart</button>
      </div>
      <table className="simple">
        <thead><tr><th>Kürzel</th><th>Bezeichnung</th><th>Kategorie</th><th>Zeit</th><th>Merkmale</th><th /></tr></thead>
        <tbody>
          {boot!.entryTypes.map((t) => (
            <tr key={t.id} className={t.active ? '' : 'inactive'}>
              <td><span className="chip" style={{ background: t.color, color: t.textColor }}>{t.code}</span></td>
              <td>{t.name}</td>
              <td>{cat[t.category]}</td>
              <td>{t.startTime ? `${t.startTime}–${t.endTime}` : ''}</td>
              <td>{[t.countsAsVacation && 'Urlaub', t.sensitive && 'vertraulich', !t.active && 'inaktiv'].filter(Boolean).join(', ')}</td>
              <td><button onClick={() => setEdit(t)}>Bearbeiten</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && <TypeForm value={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function TypeForm({ value, onClose }: { value: Partial<EntryType>; onClose: () => void }) {
  const [v, setV] = useState(value);
  const set = (k: keyof EntryType, val: unknown) => setV({ ...v, [k]: val });
  async function save() {
    const body = { ...v, startTime: v.startTime || null, endTime: v.endTime || null };
    if (await run(() => (v.id ? put(`/api/admin/entry-types/${v.id}`, body) : post('/api/admin/entry-types', body)))) onClose();
  }
  return (
    <Modal title={v.id ? 'Eintragsart bearbeiten' : 'Neue Eintragsart'} onClose={onClose}>
      <div className="form grid2">
        <label>Kürzel<input value={v.code ?? ''} maxLength={6} onChange={(e) => set('code', e.target.value)} /></label>
        <label>Bezeichnung<input value={v.name ?? ''} onChange={(e) => set('name', e.target.value)} /></label>
        <label>Kategorie
          <select value={v.category} onChange={(e) => set('category', e.target.value)}>
            <option value="shift">Dienst</option><option value="presence">Anwesenheit (sonstige)</option><option value="absence">Abwesenheit</option>
          </select>
        </label>
        <label>Sortierung<input type="number" value={v.sortOrder ?? 0} onChange={(e) => set('sortOrder', Number(e.target.value))} /></label>
        <label>Hintergrund<input type="color" value={v.color} onChange={(e) => set('color', e.target.value)} /></label>
        <label>Schrift<input type="color" value={v.textColor} onChange={(e) => set('textColor', e.target.value)} /></label>
        <label>Beginn<input type="time" value={v.startTime ?? ''} onChange={(e) => set('startTime', e.target.value)} /></label>
        <label>Ende<input type="time" value={v.endTime ?? ''} onChange={(e) => set('endTime', e.target.value)} /></label>
        <label className="inline"><input type="checkbox" checked={!!v.countsAsVacation} onChange={(e) => set('countsAsVacation', e.target.checked)} /> zählt als Urlaub</label>
        <label className="inline"><input type="checkbox" checked={!!v.sensitive} onChange={(e) => set('sensitive', e.target.checked)} /> vertraulich (z. B. Krank)</label>
        <label className="inline"><input type="checkbox" checked={v.active ?? true} onChange={(e) => set('active', e.target.checked)} /> aktiv</label>
      </div>
      <p className="muted small">Vertrauliche Arten sehen nur Bearbeiter des Teams und der Mitarbeiter selbst im Klartext – alle anderen sehen „abwesend“.</p>
      <div className="actions"><button className="primary" disabled={!v.code || !v.name} onClick={() => void save()}>Speichern</button></div>
    </Modal>
  );
}

// ---------------- Einstellungen ----------------
const STATES: Record<string, string> = {
  BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg', HE: 'Hessen', MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz', SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen',
};
function Settings() {
  const [s, setS] = useState<{ holidayState: string; ownTeamLevel: string; defaultLevel: string } | null>(null);
  useEffect(() => void get<typeof s>('/api/admin/settings').then(setS, reportError), []);
  if (!s) return null;
  return (
    <div className="form card narrow">
      <label>Bundesland (Feiertage)
        <select value={s.holidayState} onChange={(e) => setS({ ...s, holidayState: e.target.value })}>
          {Object.entries(STATES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
        <span className="muted small">Quelle für die gesetzlichen Feiertage. Beim Wechsel werden sie in allen Jahren ausgetauscht; eigene und geänderte Einträge unter <em>Feiertage</em> bleiben erhalten.</span>
      </label>
      <label>Recht aller Benutzer auf alle Teams
        <select value={s.defaultLevel} onChange={(e) => setS({ ...s, defaultLevel: e.target.value })}>
          <option value="none">kein Zugriff</option><option value="view">ansehen</option><option value="edit">bearbeiten</option>
        </select>
      </label>
      <label>Recht auf das eigene Team
        <select value={s.ownTeamLevel} onChange={(e) => setS({ ...s, ownTeamLevel: e.target.value })}>
          <option value="none">keins</option><option value="view">ansehen</option><option value="edit">bearbeiten</option><option value="manage">verwalten</option>
        </select>
      </label>
      <button className="primary" onClick={() => void run(async () => { await put('/api/admin/settings', s); })}>Speichern</button>
    </div>
  );
}

// ---------------- Beispieldaten ----------------
interface DemoSummary {
  present: boolean;
  createdAt?: string;
  departments: number;
  teams: number;
  employees: number;
  entries: number;
  users: { username: string; displayName: string; role: string }[];
}
function DemoData() {
  const [s, setS] = useState<DemoSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => get<DemoSummary>('/api/admin/demo').then(setS, reportError);
  useEffect(() => void load(), []);
  async function act(method: 'POST' | 'DELETE') {
    const q =
      method === 'POST'
        ? 'Beispieldaten einfügen? Es werden 3 Abteilungen, 6 Teams, 20 Mitarbeiter, Planeinträge für drei Monate und 3 Beispielkonten angelegt. Vorhandene Daten bleiben unverändert.'
        : 'Beispieldaten entfernen? Alle Beispiel-Abteilungen, -Teams, -Mitarbeiter, ihre Planeinträge und die Beispielkonten werden gelöscht. Deine eigenen Daten bleiben erhalten.';
    if (!confirm(q)) return;
    setBusy(true);
    const ok = await run(() => api(method, '/api/admin/demo'), method === 'POST' ? 'Beispieldaten eingefügt' : 'Beispieldaten entfernt');
    setBusy(false);
    if (ok) void load();
  }
  if (!s) return null;
  return (
    <div className="card narrow demo">
      <h3>Beispieldaten</h3>
      {s.present ? (
        <>
          <p>
            Vorhanden seit {s.createdAt ? new Date(s.createdAt).toLocaleString('de-DE') : '–'}: {s.departments} Abteilungen, {s.teams} Teams,{' '}
            {s.employees} Mitarbeiter, {s.entries} Planeinträge.
          </p>
          <p className="small">Beispielkonten (Passwort jeweils <code>demo1234</code>):</p>
          <ul className="small">
            {s.users.map((u) => (
              <li key={u.username}>
                <code>{u.username}</code> – {u.role}
              </li>
            ))}
          </ul>
          <button className="danger" disabled={busy} onClick={() => void act('DELETE')}>Beispieldaten entfernen</button>
        </>
      ) : (
        <>
          <p className="small">
            Zum Ausprobieren: legt Abteilungen, Teams (auch gleichnamige wie „Meisterei 1“ in zwei Abteilungen), 20 Mitarbeiter mit
            Diensten, Urlaub, Krankheit und Notizen für den vorigen bis nächsten Monat sowie drei Beispielkonten mit unterschiedlichen
            Rechten an. Alles ist mit „Beispiel“ gekennzeichnet und lässt sich hier mit einem Klick wieder vollständig entfernen.
          </p>
          <button className="primary" disabled={busy} onClick={() => void act('POST')}>Beispieldaten einfügen</button>
        </>
      )}
    </div>
  );
}

