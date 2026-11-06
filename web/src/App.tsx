import { useEffect, useState } from 'react';
import { ApiError, get, post } from './api';
import { store, useStore } from './store';
import { today } from './dates';
import type { SavedView, ViewConfig } from './types';
import { MonthView } from './views/MonthView';
import { DayView } from './views/DayView';
import { YearView } from './views/YearView';
import { AdminView, type AdminTab } from './views/AdminView';
import { LoginView } from './views/LoginView';
import { SetPasswordView } from './views/SetPasswordView';
import { TeamFilter } from './components/TeamFilter';
import { ViewMenu } from './components/ViewMenu';
import { PasswordDialog } from './components/PasswordDialog';
import { Toasts } from './components/Toasts';
import { ChangeHistoryMenu, ChangePopups } from './components/ChangeNotices';
import { NoteTooltip } from './components/NoteTooltip';
import { ImportantDialog, NewsDialog, type News } from './components/News';
import { applyFontScale, applyTheme } from './fontScale';
import { ProfileDialog } from './components/ProfileDialog';
import { MyChangesDialog } from './components/MyChanges';
import { reportError } from './helpers';

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
  const [profileOpen, setProfileOpen] = useState(false);
  const [myChangesOpen, setMyChangesOpen] = useState(false);
  // Änderungen anderer am eigenen Plan seit dem letzten Besuch (Hinweis nach der Anmeldung)
  const [foreign, setForeign] = useState<{ count: number; users: string[] } | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(() => /^#\/passwort\/([\w-]{10,})/.exec(location.hash)?.[1] ?? null);
  const [adminTab, setAdminTab] = useState<AdminTab | undefined>(undefined);
  const [news, setNews] = useState<News | null>(null);
  const [newsOpen, setNewsOpen] = useState<'unseen' | 'recent' | null>(null);

  async function init() {
    try {
      const boot = await store.loadBootstrap();
      applyFontScale(boot.me.fontScale ?? 1);
      applyTheme(boot.me.theme ?? 'auto');
      const v = await get<SavedView[]>('/api/views');
      setViews(v);
      const def = v.find((x) => x.isDefault);
      if (def && !location.hash) applyView(def.config);
      else if (!nav.employeeId) setNav((n) => ({ ...n, employeeId: boot.me.employeeId ?? boot.employees[0]?.id ?? null }));
      store.connect();
      get<News>('/api/news').then(setNews, () => {});
      if (boot.me.employeeId && boot.me.notifyChanges) get<{ count: number; users: string[] }>('/api/me/changes/summary').then(setForeign, () => {});
      setState('ready');
      if (boot.me.mustChangePassword) setPwOpen(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState('login');
      else store.toast(String((e as Error).message), 'error');
    }
  }

  useEffect(() => {
    void init();
    const onHash = () => {
      // Link zum Passwort in einen offenen Tab eingefügt
      const t = /^#\/passwort\/([\w-]{10,})/.exec(location.hash)?.[1];
      if (t) return setLinkToken(t);
      setNav((n) => ({ ...n, ...fromHash() }));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Admin hat Verwaltung → Info geöffnet: Leiste ausblenden
  useEffect(() => {
    const onSeen = () => setNews((n) => (n ? { ...n, banner: false } : n));
    window.addEventListener('sp-version-seen', onSeen);
    return () => window.removeEventListener('sp-version-seen', onSeen);
  }, []);

  /** Leiste geschlossen bzw. Neuigkeiten geöffnet -> am Konto als gelesen merken. */
  function newsSeen() {
    setNews((n) => (n ? { ...n, banner: false } : n));
    post('/api/news/seen').catch(() => {});
  }

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

  // Einrichtungs-/Zurücksetz-Link (#/passwort/<token>) – unabhängig davon, ob jemand angemeldet ist
  if (linkToken) {
    return (
      <SetPasswordView
        token={linkToken}
        onDone={() => {
          history.replaceState(null, '', '/'); // Token nicht im Verlauf lassen
          setLinkToken(null);
          void init();
        }}
      />
    );
  }
  if (state === 'loading') return <div className="center muted">Lade …</div>;
  if (state === 'login' || !st.boot) return <LoginView onLoggedIn={() => void init()} />;

  const boot = st.boot;
  const canAdmin = boot.me.isAdmin || boot.teams.some((t) => t.level === 'manage');
  const tab = (k: Kind, label: string) => (
    <button className={nav.kind === k ? 'tab active' : 'tab'} onClick={() => { setAdminTab(undefined); setNav({ ...nav, kind: k }); }}>
      {label}
    </button>
  );

  return (
    <div className={nav.kind === 'admin' ? 'app admin-mode' : 'app'}>
      <header className="topbar">
        <div className="brand">Schichtplaner</div>
        {nav.kind === 'admin' ? (
          <nav className="tabs">
            <span className="admin-label">⚙ Verwaltung</span>
            <button className="back-to-plan" onClick={() => setNav({ ...nav, kind: 'month' })}>← Zurück zum Plan</button>
          </nav>
        ) : (
          <nav className="tabs">
            {tab('month', 'Kalender')}
            {tab('day', 'Tag')}
            {tab('year', 'Jahr')}
          </nav>
        )}
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
        <ChangeHistoryMenu />
        <span className={st.live ? 'live on' : 'live'} title={st.live ? 'Live-Aktualisierung aktiv' : 'Keine Live-Verbindung'}>
          ●
        </span>
        <details className="usermenu">
          <summary>
            {boot.me.displayName}
            {(foreign?.count ?? 0) + st.foreignChanges > 0 && <span className="count-badge" title="Änderungen anderer an deinem Plan">{(foreign?.count ?? 0) + st.foreignChanges}</span>}
          </summary>
          <div className="menu" onClick={(e) => (e.target as HTMLElement).closest('button') && (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}>
            <div className="menu-head">
              <div className="strong">{boot.me.displayName}</div>
              <div className="small muted">{boot.me.username}</div>
            </div>
            <button onClick={() => setProfileOpen(true)}>👤 Profil & Einstellungen</button>
            {boot.me.employeeId && (
              <button onClick={() => setMyChangesOpen(true)}>
                📝 Änderungen an meinem Plan
                {(foreign?.count ?? 0) + st.foreignChanges > 0 && <span className="count-badge">{(foreign?.count ?? 0) + st.foreignChanges}</span>}
              </button>
            )}
            <button onClick={() => setNewsOpen('recent')}>📣 Neuigkeiten</button>
            {canAdmin && (
              <>
                <div className="menu-sep" />
                <button onClick={() => { setAdminTab(undefined); setNav({ ...nav, kind: 'admin' }); }}>⚙ Verwaltung</button>
              </>
            )}
            <div className="menu-sep" />
            <button onClick={() => void logout()}>Abmelden</button>
          </div>
        </details>
      </header>
      {news?.banner && (
        <div className="update-banner" role="status">
          Der Schichtplaner wurde auf Version <strong>{news.version}</strong> aktualisiert.
          <button
            className="link"
            onClick={() => {
              if (news.unseen.length) setNewsOpen('unseen');
              else { setAdminTab('info'); setNav({ ...nav, kind: 'admin' }); } // nur technische Änderungen: Admin direkt zum Changelog
              newsSeen();
            }}
          >
            Was ist neu?
          </button>
          <button className="icon" aria-label="Hinweis schließen" onClick={newsSeen}>✕</button>
        </div>
      )}
      {foreign && foreign.count > 0 && (
        <div className="info-banner" role="status">
          {foreign.users.length ? foreign.users.join(', ') : 'Jemand'} {foreign.users.length > 1 ? 'haben' : 'hat'} seit deinem letzten Besuch{' '}
          <strong>{foreign.count === 1 ? 'eine Änderung' : `${foreign.count} Änderungen`}</strong> an deinem Plan vorgenommen.
          <button className="link" onClick={() => setMyChangesOpen(true)}>Anzeigen</button>
          <button className="icon" aria-label="Hinweis schließen" onClick={() => { setForeign(null); post('/api/me/changes/seen').catch(() => {}); store.resetForeignChanges(); }}>✕</button>
        </div>
      )}
      <main>
        {nav.kind === 'month' && <MonthView nav={nav} setNav={setNav} />}
        {nav.kind === 'day' && <DayView nav={nav} setNav={setNav} />}
        {nav.kind === 'year' && <YearView nav={nav} setNav={setNav} />}
        {nav.kind === 'admin' && <AdminView key={adminTab ?? 'default'} initialTab={adminTab} />}
      </main>
      {newsOpen && (
        <NewsDialog
          notes={newsOpen === 'unseen' ? news?.unseen ?? [] : null}
          onClose={() => setNewsOpen(null)}
          onFullChangelog={boot.me.isAdmin ? () => { setNewsOpen(null); setAdminTab('info'); setNav({ ...nav, kind: 'admin' }); } : undefined}
        />
      )}
      {!pwOpen && news && news.important.length > 0 && (
        <ImportantDialog notes={news.important} onDone={() => setNews({ ...news, important: [] })} />
      )}
      {myChangesOpen && (
        <MyChangesDialog
          onClose={() => setMyChangesOpen(false)}
          onSeen={() => { setForeign(null); store.resetForeignChanges(); }}
        />
      )}
      {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} onPassword={() => { setProfileOpen(false); setPwOpen(true); }} />}
      {pwOpen && <PasswordDialog forced={boot.me.mustChangePassword} onClose={() => { setPwOpen(false); void store.loadBootstrap(); }} />}
      <ChangePopups />
      <NoteTooltip />
      <Toasts />
    </div>
  );
}
