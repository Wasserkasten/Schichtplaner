import { useEffect, type ReactNode } from 'react';

/** `closable={false}`: Dialog lässt sich weder per Esc noch per Klick daneben schließen (z. B. Pflicht-Passwortwechsel). */
export function Modal({ title, onClose, children, wide, closable = true }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; closable?: boolean }) {
  useEffect(() => {
    if (!closable) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, closable]);
  return (
    <div className="overlay" onMouseDown={(e) => closable && e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          {closable && (
            <button className="icon" onClick={onClose} aria-label="Schließen">
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
