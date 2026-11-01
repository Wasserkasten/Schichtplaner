import { useState } from 'react';
import { post } from '../api';
import { store } from '../store';
import { reportError } from '../helpers';
import { Modal } from './Modal';

export function PasswordDialog({ forced, onClose }: { forced: boolean; onClose: () => void }) {
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [repeat, setRepeat] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== repeat) return store.toast('Passwörter stimmen nicht überein', 'error');
    try {
      await post('/api/auth/password', { oldPassword, newPassword });
      store.toast('Passwort geändert');
      onClose();
    } catch (err) {
      reportError(err);
    }
  }
  return (
    <Modal title="Passwort ändern" onClose={onClose}>
      {forced && <p className="hint">Bitte vergib ein eigenes Passwort, bevor du weiterarbeitest.</p>}
      <form className="form" onSubmit={submit}>
        <label>Aktuelles Passwort<input type="password" autoComplete="current-password" value={oldPassword} onChange={(e) => setOld(e.target.value)} /></label>
        <label>Neues Passwort (mind. 8 Zeichen)<input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} /></label>
        <label>Wiederholen<input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} /></label>
        <button className="primary" type="submit">Speichern</button>
      </form>
    </Modal>
  );
}
