import { useEffect } from 'react';
import { store, useStore, type ChangeNotice } from '../store';

const time = (d: Date) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

function UndoButton({ n }: { n: ChangeNotice }) {
  return (
    <button className="undo" disabled={n.state === 'busy'} onClick={() => void store.toggleUndo(n.id)}>
      {n.state === 'undone' ? '↷ Wiederholen' : '↶ Rückgängig'}
    </button>
  );
}

/** Meldungen unten links: was gerade geändert wurde – jeweils mit „Rückgängig“. Mehrere gleichzeitig möglich. */
export function ChangePopups() {
  const st = useStore();
  const now = Date.now();
  const visible = st.notices.filter((n) => n.popupUntil > now).slice(0, 4);

  // Strg+Z = letzte Änderung zurücknehmen, Strg+Y / Strg+Umschalt+Z = wiederholen (nicht in Eingabefeldern)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      const redo = key === 'y' || (key === 'z' && e.shiftKey);
      if (key !== 'z' && key !== 'y') return;
      const n = store.notices.find((x) => x.state === (redo ? 'undone' : 'done'));
      if (!n) return;
      e.preventDefault();
      void store.toggleUndo(n.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (visible.length === 0) return null;
  return (
    <div className="notices" aria-live="polite">
      {visible.map((n) => (
        <div key={n.id} className={n.state === 'undone' ? 'notice undone' : 'notice'}>
          <span className="text">{n.state === 'undone' ? <s>{n.text}</s> : n.text}</span>
          <UndoButton n={n} />
          <button className="icon" aria-label="Meldung schließen" onClick={() => store.dismissNotice(n.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

/** Kopfzeile: alle eigenen Änderungen dieser Sitzung, auch nachdem die Meldung verschwunden ist. */
export function ChangeHistoryMenu() {
  const st = useStore();
  const open = st.notices.filter((n) => n.state !== 'undone').length;
  return (
    <details className="dropdown history">
      <summary title="Meine letzten Änderungen (Strg+Z = letzte zurücknehmen)">
        ↶{open > 0 && <span className="count-badge">{open}</span>}
      </summary>
      <div className="menu history-menu">
        <div className="small strong">Meine letzten Änderungen</div>
        {st.notices.length === 0 && <div className="muted small">Noch keine Änderungen in dieser Sitzung.</div>}
        {st.notices.map((n) => (
          <div key={n.id} className={n.state === 'undone' ? 'history-row undone' : 'history-row'}>
            <span className="muted small">{time(n.at)}</span>
            <span className="text small">{n.state === 'undone' ? <s>{n.text}</s> : n.text}</span>
            <UndoButton n={n} />
          </div>
        ))}
        <div className="muted small">Ältere Änderungen: Verlauf einer Zelle bzw. Verwaltung → Protokoll.</div>
      </div>
    </details>
  );
}
