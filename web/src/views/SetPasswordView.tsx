import { useEffect, useState } from 'react';
import { ApiError, post } from '../api';
import { SupportContactBox } from './LoginView';
import { article } from '../components/PasswordLink';

interface Info { username: string; displayName: string; purpose: 'setup' | 'reset'; secretLabel: string | null; expiresAt: string }

/** Seite hinter dem Einrichtungs-/Zurücksetz-Link: Prüfmerkmal eingeben, eigenes Passwort festlegen. */
export function SetPasswordView({ token, onDone }: { token: string; onDone: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [problem, setProblem] = useState('');
  const [secret, setSecret] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    post<Info>('/api/password-link/info', { token }).then(setInfo, (e: Error) => setProblem(e.message));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (pw.length < 8) return setError('Das Passwort muss mindestens 8 Zeichen haben.');
    if (pw !== pw2) return setError('Die beiden Passwörter stimmen nicht überein.');
    setBusy(true);
    try {
      await post('/api/password-link/use', { token, secret, password: pw });
      onDone(); // Server hat bereits angemeldet
    } catch (err) {
      const msg = (err as Error).message;
      if (err instanceof ApiError && err.status !== 403) setProblem(msg); // Link gesperrt/abgelaufen
      else setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="form card setpw">
        <img src="/icon.svg" alt="" width={56} height={56} />
        <h1>{info?.purpose === 'reset' ? 'Neues Passwort festlegen' : 'Willkommen im Schichtplaner'}</h1>
        {problem ? (
          <>
            <div className="error">{problem}</div>
            <p className="small">Bitte lass dir einen neuen Link geben.</p>
            <SupportContactBox />
            <a className="button" href="/">Zur Anmeldung</a>
          </>
        ) : !info ? (
          <p className="muted">Lade …</p>
        ) : (
          <form className="form" onSubmit={submit}>
            <p>
              Hallo <strong>{info.displayName}</strong>, dein Benutzername ist <code>{info.username}</code>. Lege jetzt dein eigenes Passwort fest.
            </p>
            {info.secretLabel && (
              <label>
                Zur Bestätigung: {article(info.secretLabel, true)} {info.secretLabel}
                <input autoFocus value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
              </label>
            )}
            <input type="text" name="username" autoComplete="username" value={info.username} readOnly hidden />
            <label>
              Neues Passwort (mind. 8 Zeichen)
              <input type="password" autoComplete="new-password" autoFocus={!info.secretLabel} value={pw} onChange={(e) => setPw(e.target.value)} />
            </label>
            <label>
              Passwort wiederholen
              <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </label>
            {error && <div className="error">{error}</div>}
            <button className="primary" type="submit" disabled={busy || (!!info.secretLabel && !secret.trim())}>Passwort speichern und anmelden</button>
            <p className="small muted">Link gültig bis {new Date(info.expiresAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}.</p>
          </form>
        )}
      </div>
    </div>
  );
}
