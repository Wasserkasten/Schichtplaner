import { useEffect, useRef, useState } from 'react';
import { MONTHS } from '../dates';

const SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** Schließt das Aufklappmenü bei Klick daneben oder Esc. */
function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const click = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', click);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', click);
      window.removeEventListener('keydown', key);
    };
  }, [ref, onClose]);
}

/**
 * Überschrift, die beim Anklicken eine Monats-/Jahresauswahl öffnet.
 * `value` = beliebiges Datum im gezeigten Monat; `min` = frühestes erlaubtes Datum.
 */
export function MonthPickerTitle({ label, value, min, onPick }: { label: string; value: string; min: string; onPick: (firstOfMonth: string) => void }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, () => setOpen(false));
  const minYear = Number(min.slice(0, 4));
  const minMonth = min.slice(0, 7);
  const current = value.slice(0, 7);
  const thisMonth = new Date().toISOString().slice(0, 7);
  return (
    <div className="picker" ref={ref}>
      <button className="picker-title" onClick={() => { setYear(Number(value.slice(0, 4))); setOpen(!open); }} aria-haspopup="dialog" aria-expanded={open} title="Monat und Jahr direkt wählen">
        <h1>{label}</h1>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="picker-pop" role="dialog" aria-label="Monat wählen">
          <div className="picker-year">
            <button onClick={() => setYear(year - 1)} disabled={year - 1 < minYear} aria-label="Vorjahr">◀</button>
            <strong>{year}</strong>
            <button onClick={() => setYear(year + 1)} aria-label="Folgejahr">▶</button>
          </div>
          <div className="picker-months">
            {SHORT.map((m, i) => {
              const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
              return (
                <button
                  key={m}
                  className={[ym === current ? 'active' : '', ym === thisMonth ? 'now' : ''].join(' ')}
                  disabled={ym < minMonth}
                  title={`${MONTHS[i]} ${year}`}
                  onClick={() => { onPick(`${ym}-01`); setOpen(false); }}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Überschrift „2026“, die eine Jahresauswahl öffnet. */
export function YearPickerTitle({ year, minYear, onPick }: { year: number; minYear: number; onPick: (year: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, () => setOpen(false));
  const now = new Date().getFullYear();
  const from = Math.min(minYear, year);
  const years = Array.from({ length: Math.max(now, year) + 3 - from + 1 }, (_, i) => from + i);
  return (
    <div className="picker" ref={ref}>
      <button className="picker-title" onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} title="Jahr direkt wählen">
        <h1>{year}</h1>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="picker-pop" role="dialog" aria-label="Jahr wählen">
          <div className="picker-months">
            {years.map((y) => (
              <button key={y} className={[y === year ? 'active' : '', y === now ? 'now' : ''].join(' ')} disabled={y < minYear} onClick={() => { onPick(y); setOpen(false); }}>
                {y}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
