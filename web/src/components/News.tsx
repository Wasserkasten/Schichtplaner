import { useEffect, useState } from 'react';
import { get, post } from '../api';
import { reportError } from '../helpers';
import { Markdown } from '../views/InfoView';
import { Modal } from './Modal';

export interface VersionNotes { version: string; date: string; forAll: string; important: string }
export interface News { version: string; banner: boolean; unseen: VersionNotes[]; important: VersionNotes[] }

const head = (n: VersionNotes) => `Version ${n.version}${n.date ? ` · ${n.date.split('-').reverse().join('.')}` : ''}`;

/** „Was ist neu?“ – verständliche Neuerungen („Für alle“) der angegebenen Versionen. */
export function NewsDialog({ notes, onClose, onFullChangelog }: { notes: VersionNotes[] | null; onClose: () => void; onFullChangelog?: () => void }) {
  const [list, setList] = useState<VersionNotes[] | null>(notes);
  useEffect(() => {
    // ohne Vorgabe: die letzten Neuigkeiten laden (Menüpunkt „Neuigkeiten“)
    if (!notes) get<{ recent: VersionNotes[] }>('/api/news?recent=1').then((r) => setList(r.recent), reportError);
  }, [notes]);
  return (
    <Modal title="Was ist neu?" onClose={onClose} wide>
      {!list ? (
        <p className="muted">Lade …</p>
      ) : list.length === 0 ? (
        <p className="muted">Keine Neuigkeiten.</p>
      ) : (
        list.map((n) => (
          <div key={n.version} className="news-version">
            <h3>{head(n)}</h3>
            {n.important && (
              <div className="news-important">
                <Markdown source={n.important} />
              </div>
            )}
            {n.forAll ? <Markdown source={n.forAll} /> : !n.important && <p className="muted small">Nur technische Änderungen.</p>}
          </div>
        ))
      )}
      <div className="actions">
        {onFullChangelog && <button onClick={onFullChangelog}>Vollständiger Changelog</button>}
        <button className="primary" onClick={onClose}>Schließen</button>
      </div>
    </Modal>
  );
}

/** Wichtige Hinweise: lässt sich nur mit „Verstanden“ schließen; die Bestätigung wird am Konto gespeichert. */
export function ImportantDialog({ notes, onDone }: { notes: VersionNotes[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function ack() {
    setBusy(true);
    try {
      await post('/api/news/ack');
      onDone();
    } catch (e) {
      reportError(e);
      setBusy(false);
    }
  }
  return (
    <Modal title="Wichtiger Hinweis" onClose={() => {}} closable={false} wide>
      {notes.map((n) => (
        <div key={n.version} className="news-version">
          <h3>{head(n)}</h3>
          <div className="news-important">
            <Markdown source={n.important} />
          </div>
        </div>
      ))}
      <div className="actions">
        <button className="primary" disabled={busy} onClick={() => void ack()}>Verstanden</button>
      </div>
    </Modal>
  );
}
