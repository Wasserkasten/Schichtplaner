import { useState } from 'react';
import { post } from '../api';

export function LoginView({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
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
      </form>
    </div>
  );
}
