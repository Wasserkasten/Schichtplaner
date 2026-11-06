import { useEffect, useState } from 'react';
import { ApiError, api, del, get, post, put } from '../api';
import { store, useStore } from '../store';
import { today } from '../dates';
import { departmentName, fullName, reportError, sortedTeams, teamLabel, teamsByDepartment } from '../helpers';
import type { Employee, EntryType, Level } from '../types';
import { Modal } from '../components/Modal';
import { HolidayAdmin } from './HolidayAdmin';
import { SchoolHolidayAdmin } from './SchoolHolidayAdmin';
import { PasswordLinkDialog, randomPassword, usernameSuggestion, type LinkInfo, type SupportContact } from '../components/PasswordLink';
import { AuditLog } from './AuditLog';
import { InfoView } from './InfoView';

export type AdminTab = 'employees' | 'structure' | 'users' | 'types' | 'holidays' | 'school' | 'settings' | 'audit' | 'info';
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
    ['school', 'Ferien', isAdmin],
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
      {tab === 'school' && <SchoolHolidayAdmin states={STATES} />}
      {tab === 'settings' && (
        <>
          <Settings />
          <SupportContactSettings />
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
interface AccountRow { id: number; username: string; displayName: string; employeeId: number | null; pendingLink: { purpose: string; expiresAt: string } | null }
interface LinkResult { displayName: string; username: string; link: LinkInfo }

function Employees() {
  const { boot } = useStore();
  const isAdmin = boot!.me.isAdmin;
  const manageable = boot!.teams.filter((t) => t.level === 'manage');
  const [edit, setEdit] = useState<Partial<Employee> | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [newAccount, setNewAccount] = useState<Employee | null>(null);
  const [linkResult, setLinkResult] = useState<LinkResult | null>(null);
  const loadAccounts = () => isAdmin && get<AccountRow[]>('/api/admin/users').then(setAccounts, reportError);
  useEffect(() => void loadAccounts(), []);
  const accountOf = new Map(accounts.filter((a) => a.employeeId).map((a) => [a.employeeId!, a]));
  const teamOrder = new Map(sortedTeams(boot!).map((t, i) => [t.id, i]));
  const withoutAccount = boot!.employees.filter((e) => e.active && !accountOf.has(e.id)).length;
  return (
    <div>
      <div className="toolbar">
        <button className="primary" disabled={!manageable.length} onClick={() => setEdit({ teamId: manageable[0]?.id, active: true, vacationDaysPerYear: 30, sortOrder: 0 })}>
          + Mitarbeiter
        </button>
        <label><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> inaktive anzeigen</label>
        {isAdmin && withoutAccount > 0 && <span className="muted small">{withoutAccount} aktive Mitarbeiter ohne Benutzerkonto</span>}
      </div>
      <table className="simple">
        <thead><tr><th>Name</th><th>Kürzel</th><th>Abteilung</th><th>Team</th><th>Pers.-Nr.</th><th>Beschäftigt</th><th>Urlaub/Jahr</th>{isAdmin && <th>Konto</th>}<th /></tr></thead>
        <tbody>
          {boot!.employees
            .filter((e) => showInactive || e.active)
            .sort((a, b) => (teamOrder.get(a.teamId) ?? 0) - (teamOrder.get(b.teamId) ?? 0) || a.sortOrder - b.sortOrder || fullName(a).localeCompare(fullName(b), 'de'))
            .map((e) => {
              const team = boot!.teams.find((t) => t.id === e.teamId);
              const acc = accountOf.get(e.id);
              return (
                <tr key={e.id} className={e.active ? '' : 'inactive'}>
                  <td>{fullName(e)}</td>
                  <td>{e.shortName}</td>
                  <td>{team ? departmentName(boot!, team.departmentId) : ''}</td>
                  <td>{team?.name}</td>
                  <td>{e.personnelNo}</td>
                  <td className="employment small">{employment(e)}</td>
                  <td>{e.vacationDaysPerYear}</td>
                  {isAdmin && (
                    <td>
                      {acc ? (
                        <>
                          <code>{acc.username}</code>
                          {acc.pendingLink && <span className="badge light" title={`Link gültig bis ${new Date(acc.pendingLink.expiresAt).toLocaleString('de-DE')}`}>{acc.pendingLink.purpose === 'setup' ? 'Einrichtung offen' : 'Zurücksetzen offen'}</span>}
                        </>
                      ) : (
                        e.active && <button onClick={() => setNewAccount(e)}>+ Konto</button>
                      )}
                    </td>
                  )}
                  <td>{team?.level === 'manage' && <button onClick={() => setEdit(e)}>Bearbeiten</button>}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
      {edit && (
        <EmployeeForm
          value={edit}
          onClose={(res) => {
            setEdit(null);
            if (res) setLinkResult(res);
            void loadAccounts();
          }}
        />
      )}
      {newAccount && (
        <AccountForEmployee
          emp={newAccount}
          taken={new Set(accounts.map((a) => a.username.toLowerCase()))}
          onClose={(res) => {
            setNewAccount(null);
            if (res) setLinkResult(res);
            void loadAccounts();
          }}
        />
      )}
      {linkResult && <PasswordLinkDialog {...linkResult} onClose={() => setLinkResult(null)} />}
    </div>
  );
}

/** „seit 01.03.2024“, „bis 31.12.2026“, „ausgeschieden 30.06.2026“ … */
function employment(e: Employee): string {
  const d = (x: string) => x.split('-').reverse().join('.');
  const now = today();
  if (e.exitDate && e.exitDate < now) return `ausgeschieden ${d(e.exitDate)}`;
  if (e.entryDate && e.entryDate > now) return `ab ${d(e.entryDate)}`;
  if (e.entryDate && e.exitDate) return `${d(e.entryDate)} – ${d(e.exitDate)}`;
  if (e.exitDate) return `bis ${d(e.exitDate)}`;
  if (e.entryDate) return `seit ${d(e.entryDate)}`;
  return '';
}

/** Benutzername aus Vor- und Nachname vorschlagen; bei Bedarf mit Zahl, falls schon vergeben. */
function freeUsername(first: string, last: string, taken: Set<string>): string {
  const base = usernameSuggestion(first, last);
  if (!base || !taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}

/** Kurzdialog „Konto anlegen“ für einen vorhandenen Mitarbeiter. */
function AccountForEmployee({ emp, taken, onClose }: { emp: Employee; taken: Set<string>; onClose: (r?: LinkResult) => void }) {
  const [username, setUsername] = useState(() => freeUsername(emp.firstName, emp.lastName, taken));
  const displayName = `${emp.firstName} ${emp.lastName}`;
  async function save() {
    try {
      const r = await post<{ id: number; link: LinkInfo }>('/api/admin/users', { username, displayName, employeeId: emp.id, grants: [] });
      await store.loadBootstrap();
      onClose({ displayName, username, link: r.link });
    } catch (e) {
      reportError(e);
    }
  }
  return (
    <Modal title={`Konto für ${fullName(emp)}`} onClose={() => onClose()}>
      <div className="form">
        <label>Benutzername<input value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <p className="small muted">Das Konto bekommt die üblichen Rechte (eigenes Team bearbeiten). Das Passwort legt {emp.firstName} über einen Link selbst fest.</p>
      </div>
      <div className="actions"><button className="primary" disabled={username.trim().length < 2} onClick={() => void save()}>Konto anlegen</button></div>
    </Modal>
  );
}

interface OutsideInfo { outside: number; first: string; last: string }

function EmployeeForm({ value, onClose }: { value: Partial<Employee>; onClose: (r?: LinkResult) => void }) {
  const { boot } = useStore();
  const isAdmin = boot!.me.isAdmin;
  const [v, setV] = useState(value);
  const [withAccount, setWithAccount] = useState(!value.id && isAdmin);
  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [outsidePrompt, setOutsidePrompt] = useState<OutsideInfo | null>(null);
  const set = (k: keyof Employee, val: unknown) => setV({ ...v, [k]: val });
  // Benutzername folgt dem Namen, bis er von Hand geändert wurde
  useEffect(() => {
    if (!usernameTouched) setUsername(usernameSuggestion(v.firstName ?? '', v.lastName ?? ''));
  }, [v.firstName, v.lastName, usernameTouched]);

  async function save(outsideEntries?: 'delete' | 'keep') {
    const body = { ...v, shortName: v.shortName || null, personnelNo: v.personnelNo || null, entryDate: v.entryDate || null, exitDate: v.exitDate || null };
    if (v.id) {
      try {
        const r = await put<{ deletedOutsideEntries?: number }>(`/api/admin/employees/${v.id}`, { ...body, outsideEntries });
        await store.loadBootstrap();
        store.toast(r.deletedOutsideEntries ? `Gespeichert, ${r.deletedOutsideEntries} Einträge gelöscht` : 'Gespeichert');
        onClose();
      } catch (e) {
        // Einträge außerhalb der neuen Beschäftigungszeit: nachfragen
        if (e instanceof ApiError && e.status === 422 && (e.data as { outside?: number })?.outside) setOutsidePrompt(e.data as OutsideInfo);
        else reportError(e);
      }
      return;
    }
    try {
      const r = await post<{ id: number; account?: { username: string; link: LinkInfo | null } }>('/api/admin/employees', {
        ...body,
        account: withAccount ? { username: username.trim() } : undefined,
      });
      await store.loadBootstrap();
      store.toast(r.account ? 'Mitarbeiter und Konto angelegt' : 'Mitarbeiter angelegt');
      onClose(r.account?.link ? { displayName: `${v.firstName} ${v.lastName}`, username: r.account.username, link: r.account.link } : undefined);
    } catch (e) {
      reportError(e);
    }
  }
  async function remove() {
    if (!confirm('Mitarbeiter endgültig löschen? Alle Planeinträge gehen verloren. Besser: auf „inaktiv“ setzen.')) return;
    if (await run(() => del(`/api/admin/employees/${v.id}`), 'Gelöscht')) onClose();
  }
  return (
    <Modal title={v.id ? 'Mitarbeiter bearbeiten' : 'Neuer Mitarbeiter'} onClose={() => onClose()}>
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
        <label>Eintritt<input type="date" value={v.entryDate ?? ''} onChange={(e) => set('entryDate', e.target.value || null)} /></label>
        <label>Austritt<input type="date" value={v.exitDate ?? ''} min={v.entryDate ?? undefined} onChange={(e) => set('exitDate', e.target.value || null)} /></label>
        <label>Sortierung<input type="number" value={v.sortOrder ?? 0} onChange={(e) => set('sortOrder', Number(e.target.value))} /></label>
        <label className="inline"><input type="checkbox" checked={v.active ?? true} onChange={(e) => set('active', e.target.checked)} /> aktiv</label>
      </div>
      <p className="small muted">Vor dem Eintritt und nach dem Austritt ist im Plan nichts eintragbar; dort erscheint der Mitarbeiter nicht. Leer = unbegrenzt.</p>
      {outsidePrompt && (
        <div className="hint">
          <p>
            Nach den neuen Daten liegen <strong>{outsidePrompt.outside} Einträge</strong> außerhalb der Beschäftigung
            ({outsidePrompt.first.split('-').reverse().join('.')}{outsidePrompt.last !== outsidePrompt.first ? ` – ${outsidePrompt.last.split('-').reverse().join('.')}` : ''}).
          </p>
          <div className="row">
            <button className="danger" onClick={() => void save('delete')}>Diese Einträge löschen</button>
            <button onClick={() => void save('keep')}>Behalten (nicht mehr änderbar)</button>
            <button onClick={() => setOutsidePrompt(null)}>Abbrechen</button>
          </div>
        </div>
      )}
      {!v.id && isAdmin && (
        <div className="form sub-form">
          <label className="inline"><input type="checkbox" checked={withAccount} onChange={(e) => setWithAccount(e.target.checked)} /> Benutzerkonto gleich mit anlegen</label>
          {withAccount && (
            <>
              <label>Benutzername<input value={username} onChange={(e) => { setUsername(e.target.value); setUsernameTouched(true); }} /></label>
              <p className="small muted">
                Danach bekommst du einen Link (mit QR-Code zum Ausdrucken), über den das Passwort selbst festgelegt wird.
                {v.personnelNo ? ' Zur Bestätigung wird die Personalnummer abgefragt.' : v.shortName ? ' Zur Bestätigung wird das Kürzel abgefragt.' : ' Tipp: Personalnummer oder Kürzel eintragen – sie wird beim Öffnen des Links zur Bestätigung abgefragt.'}
              </p>
            </>
          )}
        </div>
      )}
      <div className="actions">
        {v.id && boot!.me.isAdmin && <button className="danger" onClick={() => void remove()}>Löschen</button>}
        <button className="primary" disabled={!v.firstName || !v.lastName || (withAccount && username.trim().length < 2) || !!outsidePrompt} onClick={() => void save()}>Speichern</button>
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
interface AdminUser { id?: number; username: string; displayName: string; employeeId: number | null; isAdmin: boolean; active: boolean; password?: string; grants: Grant[]; pendingLink?: { purpose: string; expiresAt: string } | null }

const LEVEL_LABEL: Record<string, string> = { view: 'ansehen', edit: 'bearbeiten', manage: 'verwalten' };

function Users() {
  const { boot } = useStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [edit, setEdit] = useState<AdminUser | null>(null);
  const [linkResult, setLinkResult] = useState<LinkResult | null>(null);
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
                <td>
                  {u.username}
                  {u.pendingLink && (
                    <span className="badge light" title={`Link gültig bis ${new Date(u.pendingLink.expiresAt).toLocaleString('de-DE')}`}>
                      {u.pendingLink.purpose === 'setup' ? 'Einrichtung offen' : 'Zurücksetzen offen'}
                    </span>
                  )}
                </td>
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
      {edit && (
        <UserForm
          value={edit}
          users={users}
          onClose={(res) => {
            setEdit(null);
            if (res) setLinkResult(res);
            void load();
          }}
        />
      )}
      {linkResult && <PasswordLinkDialog {...linkResult} onClose={() => setLinkResult(null)} />}
    </div>
  );
}

interface NewEmployee { firstName: string; lastName: string; teamId: number; shortName: string; personnelNo: string }

/** Passwortfeld mit „Zufällig erzeugen“ (Klartext, damit es abgeschrieben bzw. kopiert werden kann). */
function PasswordInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="pw-row">
      <input type={visible ? 'text' : 'password'} autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} placeholder="mind. 8 Zeichen" />
      <button type="button" title="Zufälliges Passwort erzeugen" onClick={() => { onChange(randomPassword()); setVisible(true); }}>🎲 Zufällig</button>
      {value && <button type="button" onClick={() => void navigator.clipboard?.writeText(value).then(() => store.toast('Kopiert'))}>Kopieren</button>}
    </div>
  );
}

function UserForm({ value, users, onClose }: { value: AdminUser; users: AdminUser[]; onClose: (r?: LinkResult) => void }) {
  const { boot } = useStore();
  const [v, setV] = useState<AdminUser>({ ...value, password: '' });
  const [empMode, setEmpMode] = useState<'existing' | 'new'>('existing');
  const firstTeam = sortedTeams(boot!)[0]?.id ?? 0;
  const [ne, setNe] = useState<NewEmployee>({ firstName: '', lastName: '', teamId: firstTeam, shortName: '', personnelNo: '' });
  const [pwMode, setPwMode] = useState<'link' | 'manual' | 'keep'>(value.id ? 'keep' : 'link');
  const [touched, setTouched] = useState({ username: !!value.id, displayName: !!value.id });
  const setGrant = (i: number, g: Partial<Grant>) => setV({ ...v, grants: v.grants.map((x, j) => (i === j ? { ...x, ...g } : x)) });
  const linkedTo = new Map(users.filter((u) => u.employeeId && u.id !== v.id).map((u) => [u.employeeId!, u.username]));
  const taken = new Set(users.filter((u) => u.id !== v.id).map((u) => u.username.toLowerCase()));

  // Benutzer- und Anzeigename aus dem (neuen oder gewählten) Mitarbeiter vorschlagen, solange nicht von Hand geändert
  function suggestFrom(first: string, last: string, next: Partial<AdminUser> = {}) {
    setV((cur) => ({
      ...cur,
      ...next,
      username: touched.username ? cur.username : freeUsername(first, last, taken),
      displayName: touched.displayName ? cur.displayName : [first, last].filter(Boolean).join(' '),
    }));
  }
  const setNew = (p: Partial<NewEmployee>) => {
    const n = { ...ne, ...p };
    setNe(n);
    suggestFrom(n.firstName, n.lastName);
  };

  async function save() {
    const password = pwMode === 'manual' ? v.password : undefined;
    const body = {
      ...v,
      password,
      employeeId: empMode === 'new' ? null : v.employeeId,
      newEmployee: empMode === 'new' ? { ...ne, shortName: ne.shortName || null, personnelNo: ne.personnelNo || null } : undefined,
    };
    try {
      if (v.id) {
        await put(`/api/admin/users/${v.id}`, body);
        await store.loadBootstrap();
        store.toast('Gespeichert');
        onClose();
      } else {
        const r = await post<{ id: number; link: LinkInfo | null }>('/api/admin/users', body);
        await store.loadBootstrap();
        store.toast('Benutzer angelegt');
        onClose(r.link ? { displayName: v.displayName, username: v.username, link: r.link } : undefined);
      }
    } catch (e) {
      reportError(e);
    }
  }

  async function resetLink() {
    try {
      const r = await post<{ username: string; displayName: string; link: LinkInfo }>(`/api/admin/users/${v.id}/password-link`, { purpose: 'reset' });
      onClose({ displayName: r.displayName, username: r.username, link: r.link });
    } catch (e) {
      reportError(e);
    }
  }

  const pwOk = pwMode !== 'manual' || (v.password ?? '').length >= 8;
  const empOk = empMode === 'existing' || (ne.firstName.trim() && ne.lastName.trim() && ne.teamId);
  return (
    <Modal title={v.id ? 'Benutzer bearbeiten' : 'Neuer Benutzer'} onClose={() => onClose()} wide>
      <h3 style={{ marginTop: 0 }}>Mitarbeiter</h3>
      {!v.id && (
        <div className="radio-list">
          <label><input type="radio" checked={empMode === 'existing'} onChange={() => setEmpMode('existing')} /> vorhandenen Mitarbeiter verknüpfen (oder keinen)</label>
          <label><input type="radio" checked={empMode === 'new'} onChange={() => setEmpMode('new')} /> neuen Mitarbeiter gleich mit anlegen</label>
        </div>
      )}
      {empMode === 'existing' ? (
        <div className="form">
          <label>Verknüpfter Mitarbeiter
            <select
              value={v.employeeId ?? ''}
              onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : null;
                const emp = boot!.employees.find((x) => x.id === id);
                if (emp && !v.id) suggestFrom(emp.firstName, emp.lastName, { employeeId: id });
                else setV({ ...v, employeeId: id });
              }}
            >
              <option value="">– keiner (z. B. Personalabteilung) –</option>
              {sortedTeams(boot!).map((t) => (
                <optgroup key={t.id} label={teamLabel(boot!, t.id)}>
                  {boot!.employees.filter((e) => e.teamId === t.id && e.active).map((e) => (
                    <option key={e.id} value={e.id} disabled={linkedTo.has(e.id)}>
                      {fullName(e)}{linkedTo.has(e.id) ? ` – hat schon Konto „${linkedTo.get(e.id)}“` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div className="form grid2 sub-form">
          <label>Vorname<input value={ne.firstName} onChange={(e) => setNew({ firstName: e.target.value })} /></label>
          <label>Nachname<input value={ne.lastName} onChange={(e) => setNew({ lastName: e.target.value })} /></label>
          <label>Team
            <select value={ne.teamId} onChange={(e) => setNew({ teamId: Number(e.target.value) })}>
              {teamsByDepartment(boot!).map(({ department, teams }) => (
                <optgroup key={department.id} label={department.name}>
                  {teams.map((t) => <option key={t.id} value={t.id}>{department.name} · {t.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label>Kürzel<input value={ne.shortName} maxLength={10} onChange={(e) => setNew({ shortName: e.target.value })} /></label>
          <label>Personalnummer<input value={ne.personnelNo} onChange={(e) => setNew({ personnelNo: e.target.value })} /></label>
        </div>
      )}

      <h3>Konto</h3>
      <div className="form grid2">
        <label>Benutzername<input value={v.username} onChange={(e) => { setTouched({ ...touched, username: true }); setV({ ...v, username: e.target.value }); }} /></label>
        <label>Anzeigename<input value={v.displayName} onChange={(e) => { setTouched({ ...touched, displayName: true }); setV({ ...v, displayName: e.target.value }); }} /></label>
        <label className="inline"><input type="checkbox" checked={v.isAdmin} onChange={(e) => setV({ ...v, isAdmin: e.target.checked })} /> Administrator</label>
        <label className="inline"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> aktiv</label>
      </div>

      <h3>Passwort</h3>
      <div className="radio-list">
        {v.id && <label><input type="radio" checked={pwMode === 'keep'} onChange={() => setPwMode('keep')} /> unverändert lassen</label>}
        {!v.id && (
          <label>
            <input type="radio" checked={pwMode === 'link'} onChange={() => setPwMode('link')} />
            <span><strong>Einrichtungslink</strong> (empfohlen) – der Benutzer legt sein Passwort selbst fest; du bekommst einen Link mit QR-Code zum Weitergeben</span>
          </label>
        )}
        <label><input type="radio" checked={pwMode === 'manual'} onChange={() => setPwMode('manual')} /> {v.id ? 'neues Passwort festlegen' : 'Startpasswort selbst festlegen'} (muss bei der ersten Anmeldung geändert werden)</label>
      </div>
      {pwMode === 'manual' && <PasswordInput value={v.password ?? ''} onChange={(p) => setV({ ...v, password: p })} />}
      {v.id && (
        <p className="small">
          <button onClick={() => void resetLink()}>🔗 Link zum Zurücksetzen erstellen</button>{' '}
          <span className="muted">– der Benutzer legt damit selbst ein neues Passwort fest; ein früherer Link wird ungültig.</span>
        </p>
      )}

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
        <button className="primary" disabled={!v.username || !v.displayName || !pwOk || !empOk} onClick={() => void save()}>
          {!v.id && pwMode === 'link' ? 'Anlegen und Link erzeugen' : 'Speichern'}
        </button>
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
/** Ansprechpartner bei Anmeldeproblemen: erscheint auf der Anmeldeseite, bei abgelaufenen Links und im Zugangsschreiben. */
function SupportContactSettings() {
  const [c, setC] = useState<SupportContact | null>(null);
  useEffect(() => void get<SupportContact>('/api/admin/support-contact').then(setC, reportError), []);
  if (!c) return null;
  const set = (k: keyof SupportContact, v: string) => setC({ ...c, [k]: v });
  return (
    <div className="form card narrow support-settings">
      <h3 style={{ margin: 0 }}>Hilfe bei Anmeldeproblemen</h3>
      <p className="small muted" style={{ margin: 0 }}>
        An wen sich Kollegen wenden, wenn sie ihr Passwort vergessen haben oder ein Link abgelaufen ist. Erscheint auf der Anmeldeseite
        (<strong>öffentlich sichtbar</strong>), auf abgelaufenen Links und im Zugangsschreiben. Alle Felder sind optional.
      </p>
      <label>Name bzw. Stelle<input value={c.name} placeholder="z. B. Leitstelle – Frau Schmidt" onChange={(e) => set('name', e.target.value)} /></label>
      <label>Telefon<input value={c.phone} placeholder="z. B. Durchwahl 123" onChange={(e) => set('phone', e.target.value)} /></label>
      <label>E-Mail<input type="email" value={c.email} onChange={(e) => set('email', e.target.value)} /></label>
      <label>Hinweis<input value={c.note} placeholder="z. B. Mo–Fr 7–15 Uhr oder persönlich im Büro 2.14" onChange={(e) => set('note', e.target.value)} /></label>
      <button className="primary" onClick={() => void run(() => put('/api/admin/support-contact', c))}>Speichern</button>
    </div>
  );
}

function Settings() {
  const [s, setS] = useState<{ holidayState: string; ownTeamLevel: string; defaultLevel: string; planStart: string | null } | null>(null);
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
      <label>Planungsbeginn
        <span className="pw-row">
          <input type="date" value={s.planStart ?? ''} onChange={(e) => setS({ ...s, planStart: e.target.value || null })} />
          {s.planStart && <button type="button" onClick={() => setS({ ...s, planStart: null })}>leeren</button>}
        </span>
        <span className="muted small">Davor kann weder zurückgeblättert noch eingetragen werden. Leer = automatisch: zurück bis zu den ersten vorhandenen Daten (bei leerem Plan bis zum aktuellen Monat).</span>
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

