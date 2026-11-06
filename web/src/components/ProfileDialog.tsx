import { useStore, store } from '../store';
import { FONT_STEPS, nextStep, saveFontScale, saveTheme, type Theme } from '../fontScale';
import { reportError, teamLabel } from '../helpers';
import { Modal } from './Modal';

const LEVEL: Record<string, string> = { view: 'ansehen', edit: 'bearbeiten', manage: 'verwalten' };

/** Benutzermenü → Profil & Einstellungen: Konto-Infos, Darstellung, Schriftgröße, Passwort. */
export function ProfileDialog({ onClose, onPassword }: { onClose: () => void; onPassword: () => void }) {
  const st = useStore();
  const boot = st.boot!;
  const me = boot.me;
  const emp = boot.employees.find((e) => e.id === me.employeeId);
  const own = emp ? boot.permissions.teams[emp.teamId] : undefined;
  const extra = boot.teams.filter((t) => t.id !== emp?.teamId && (t.level === 'edit' || t.level === 'manage'));

  const save = async (fn: () => Promise<void>) => {
    try {
      await fn();
      await store.loadBootstrap();
    } catch (e) {
      reportError(e);
    }
  };
  const themes: [Theme, string][] = [['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']];

  return (
    <Modal title="Profil & Einstellungen" onClose={onClose}>
      <div className="profile">
        <section>
          <h3>Konto</h3>
          <dl>
            <dt>Name</dt><dd>{me.displayName}</dd>
            <dt>Benutzername</dt><dd><code>{me.username}</code></dd>
            <dt>Team</dt><dd>{emp ? teamLabel(boot, emp.teamId) : '– (kein Mitarbeiter verknüpft)'}</dd>
            <dt>Rechte</dt>
            <dd>
              {me.isAdmin ? 'Administrator' : own ? `eigenes Team ${LEVEL[own] ?? own}` : 'ansehen'}
              {!me.isAdmin && extra.length > 0 && <>; außerdem {extra.map((t) => `${teamLabel(boot, t.id)} (${LEVEL[t.level]})`).join(', ')}</>}
            </dd>
          </dl>
          <p className="small muted">Name, Team und Rechte ändert ein Administrator.</p>
          <button onClick={onPassword}>Passwort ändern</button>
        </section>

        <section>
          <h3>Darstellung</h3>
          <div className="seg" role="radiogroup" aria-label="Darstellung">
            {themes.map(([k, label]) => (
              <button key={k} role="radio" aria-checked={me.theme === k} className={me.theme === k ? 'active' : ''} onClick={() => void save(() => saveTheme(k))}>
                {label}
              </button>
            ))}
          </div>
          <p className="small muted">„Automatisch“ folgt der Einstellung des Geräts (z. B. abends dunkel).</p>
        </section>

        <section>
          <h3>Schriftgröße</h3>
          <div className="row">
            <button aria-label="Schrift kleiner" disabled={me.fontScale <= FONT_STEPS[0]} onClick={() => void save(() => saveFontScale(nextStep(me.fontScale, -1)))}>A−</button>
            <button className="val" aria-label="Schriftgröße zurücksetzen" title="auf 100 % zurücksetzen" onClick={() => void save(() => saveFontScale(1))}>
              {Math.round(me.fontScale * 100)} %
            </button>
            <button aria-label="Schrift größer" disabled={me.fontScale >= FONT_STEPS[FONT_STEPS.length - 1]} onClick={() => void save(() => saveFontScale(nextStep(me.fontScale, 1)))}>A+</button>
          </div>
          <p className="small muted">Gilt für dein Konto auf allen Geräten.</p>
        </section>
      </div>
      <div className="actions"><button className="primary" onClick={onClose}>Fertig</button></div>
    </Modal>
  );
}
