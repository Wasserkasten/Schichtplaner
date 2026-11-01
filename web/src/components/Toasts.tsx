import { useStore } from '../store';

export function Toasts() {
  const st = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {st.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
