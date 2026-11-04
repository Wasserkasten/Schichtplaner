import { useEffect, useState } from 'react';
import { get, post } from '../api';
import type { SupportContact } from '../components/PasswordLink';

/** Ansprechpartner bei Anmeldeproblemen (Einstellung der Administratoren). */
export function SupportContactBox() {
  const [c, setC] = useState<SupportContact | null | undefined>(undefined);
  useEffect(() => {
    get<{ contact: SupportContact | null }>('/api/public/login-info').then((d) => setC(d.contact), () => setC(null));
  }, []);
  if (c === undefined) return null;
  if (!c) return <p className="small muted">Bitte wende dich an deine Administratorin bzw. deinen Administrator.</p>;
  return (
    <div className="support small">
      <div className="strong">Hilfe bei der Anmeldung</div>
      {c.name && <div>{c.name}</div>}
      {c.phone && <div>Tel. <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a></div>}
      {c.email && <div><a href={`mailto:${c.email}`}>{c.email}</a></div>}
      {c.note && <div className="muted">{c.note}</div>}
    </div>
  );
}

export function LoginView({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await post('/api/auth/login', { username, password });
      onLoggedIn();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <div className="login">
      <form className="form card" onSubmit={submit}>
        <img src="/icon.svg" alt="" width={56} height={56} />
        <h1>Schichtplaner</h1>
        <label>Benutzername<input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label>Passwort<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit">Anmelden</button>
        <button type="button" className="link small" onClick={() => setHelp(!help)}>Passwort vergessen oder noch keinen Zugang?</button>
        {help && (
          <>
            <p className="small">Ein neues Passwort bekommst du über einen persönlichen Link, den dir die zuständige Stelle erstellt:</p>
            <SupportContactBox />
          </>
        )}
      </form>
    </div>
  );
}
