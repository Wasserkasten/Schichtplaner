import { useEffect, useState } from 'react';
import { ApiError, get, post } from './api';
import { store, useStore } from './store';
import { today } from './dates';
import type { SavedView, ViewConfig } from './types';
import { MonthView } from './views/MonthView';
import { DayView } from './views/DayView';
import { YearView } from './views/YearView';
import { AdminView } from './views/AdminView';
import { LoginView } from './views/LoginView';
import { TeamFilter } from './components/TeamFilter';
import { ViewMenu } from './components/ViewMenu';
import { PasswordDialog } from './components/PasswordDialog';
import { Toasts } from './components/Toasts';

export type Kind = ViewConfig['kind'] | 'admin';

export interface NavState {
  kind: Kind;
  date: string; // Bezugsdatum (Monat/Tag/Jahr)
  teamIds: number[]; // leer = alle sichtbaren Teams
  employeeId: number | null; // für Jahreskalender
  days: number; // 0 = ganzer Monat
}

function fromHash(): Partial<NavState> {
  const [kind, date, emp] = location.hash.replace(/^#\/?/, '').split('/');
  const map: Record<string, Kind> = { monat: 'month', tag: 'day', jahr: 'year', verwaltung: 'admin' };
  const s: Partial<NavState> = {};
  if (map[kind]) s.kind = map[kind];
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) s.date = date;
  if (emp && /^\d+$/.test(emp)) s.employeeId = Number(emp);
  return s;
}
function toHash(s: NavState): string {
  const k = { month: 'monat', day: 'tag', year: 'jahr', admin: 'verwaltung' }[s.kind];
  return `#/${k}/${s.date}${s.kind === 'year' && s.employeeId ? `/${s.employeeId}` : ''}`;
}

export function App() {
  const st = useStore();
  const [state, setState] = useState<'loading' | 'login' | 'ready'>('loading');
  const [nav, setNav] = useState<NavState>({ kind: 'month', date: today(), teamIds: [], employeeId: null, days: 0, ...fromHash() });
  const [views, setViews] = useState<SavedView[]>([]);
  const [pwOpen, setPwOpen] = useState(false);

  async function init() {
    try {
      const boot = await store.loadBootstrap();
      const v = await get<SavedView[]>('/api/views');
      setViews(v);
      const def = v.find((x) => x.isDefault);
      if (def && !location.hash) applyView(def.config);
      else if (!nav.employeeId) setNav((n) => ({ ...n, employeeId: boot.me.employeeId ?? boot.employees[0]?.id ?? null }));
      store.connect();
      setState('ready');
      if (boot.me.mustChangePassword) setPwOpen(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState('login');
      else store.toast(String((e as Error).message), 'error');
    }
  }

  useEffect(() => {
    void init();
    const onHash = () => setNav((n) => ({ ...n, ...fromHash() }));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state === 'ready' && location.hash !== toHash(nav)) history.replaceState(null, '', toHash(nav));
  }, [nav, state]);

  function applyView(c: ViewConfig) {
    setNav((n) => ({
      ...n,
      kind: c.kind,
      teamIds: c.teamIds ?? [],
      employeeId: c.employeeId ?? n.employeeId ?? store.boot?.me.employeeId ?? null,
      days: c.days ?? 0,
    }));
  }

  async function logout() {
    await post('/api/auth/logout');
    store.reset();
    setState('login');
  }

  if (state === 'loading') return <div className="center muted">Lade …</div>;
  if (state === 'login' || !st.boot) return <LoginView onLoggedIn={() => void init()} />;

  const boot = st.boot;
  const canAdmin = boot.me.isAdmin || boot.teams.some((t) => t.level === 'manage');
  const tab = (k: Kind, label: string) => (
    <button className={nav.kind === k ? 'tab active' : 'tab'} onClick={() => setNav({ ...nav, kind: k })}>
      {label}
    </button>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Schichtplaner</div>
        <nav className="tabs">
          {tab('month', 'Kalender')}
          {tab('day', 'Tag')}
          {tab('year', 'Jahr')}
          {canAdmin && tab('admin', 'Verwaltung')}
        </nav>
        {nav.kind !== 'admin' && nav.kind !== 'year' && (
          <TeamFilter value={nav.teamIds} onChange={(teamIds) => setNav({ ...nav, teamIds })} />
        )}
        {nav.kind !== 'admin' && (
          <ViewMenu
            views={views}
            current={{ kind: nav.kind as ViewConfig['kind'], teamIds: nav.teamIds, employeeId: nav.employeeId, days: nav.days || undefined }}
            onApply={applyView}
            onChange={setViews}
          />
        )}
        <div className="spacer" />
        <span className={st.live ? 'live on' : 'live'} title={st.live ? 'Live-Aktualisierung aktiv' : 'Keine Live-Verbindung'}>
          ●
        </span>
        <details className="usermenu">
          <summary>{boot.me.displayName}</summary>
          <div className="menu">
            <button onClick={() => setPwOpen(true)}>Passwort ändern</button>
            <button onClick={() => void logout()}>Abmelden</button>
          </div>
        </details>
      </header>
      <main>
        {nav.kind === 'month' && <MonthView nav={nav} setNav={setNav} />}
        {nav.kind === 'day' && <DayView nav={nav} setNav={setNav} />}
        {nav.kind === 'year' && <YearView nav={nav} setNav={setNav} />}
        {nav.kind === 'admin' && <AdminView />}
      </main>
      {pwOpen && <PasswordDialog forced={boot.me.mustChangePassword} onClose={() => { setPwOpen(false); void store.loadBootstrap(); }} />}
      <Toasts />
    </div>
  );
}
