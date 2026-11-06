import { useEffect, useState } from 'react';

/**
 * Kommentare beim Darüberfahren anzeigen – sofort und gut lesbar (statt des verzögerten Browser-Tooltips).
 * Eine Zelle mit Text trägt `data-tip` (siehe CellContent); ein einziger Listener für die ganze Seite.
 */
export function NoteTooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  useEffect(() => {
    let current: Element | null = null;
    const over = (e: MouseEvent) => {
      const cell = (e.target as Element).closest?.('[data-tip]');
      if (cell === current) return;
      current = cell;
      if (!cell) return setTip(null);
      const r = cell.getBoundingClientRect();
      const below = r.top < 140; // oben am Rand: unterhalb anzeigen
      setTip({ text: cell.getAttribute('data-tip') ?? '', x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below });
    };
    const hide = () => {
      current = null;
      setTip(null);
    };
    document.addEventListener('mouseover', over);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('pointerdown', hide);
    return () => {
      document.removeEventListener('mouseover', over);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('pointerdown', hide);
    };
  }, []);
  if (!tip) return null;
  const x = Math.min(Math.max(tip.x, 140), window.innerWidth - 140);
  return (
    <div className={tip.below ? 'note-tip below' : 'note-tip'} style={{ left: x, top: tip.y }} role="tooltip">
      {tip.text.split('\n').map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}
