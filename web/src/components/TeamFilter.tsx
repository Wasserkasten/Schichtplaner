import { useStore } from '../store';
import { teamLabel } from '../helpers';

export function TeamFilter({ value, onChange }: { value: number[]; onChange: (ids: number[]) => void }) {
  const { boot } = useStore();
  if (!boot) return null;
  const label =
    value.length === 0
      ? 'Alle Teams'
      : value.length === 1
        ? teamLabel(boot, value[0])
        : `${value.length} Teams`;
  const toggle = (ids: number[], on: boolean) => {
    const set = new Set(value);
    for (const id of ids) on ? set.add(id) : set.delete(id);
    onChange([...set]);
  };
  return (
    <details className="dropdown">
      <summary>{label}</summary>
      <div className="menu">
        <button onClick={() => onChange([])}>Alle Teams anzeigen</button>
        {boot.departments.map((d) => {
          const teams = boot.teams.filter((t) => t.departmentId === d.id);
          if (teams.length === 0) return null;
          const allOn = teams.every((t) => value.includes(t.id));
          return (
            <div key={d.id} className="menu-group">
              <label className="strong">
                <input type="checkbox" checked={allOn} onChange={(e) => toggle(teams.map((t) => t.id), e.target.checked)} /> {d.name}
              </label>
              {teams.map((t) => (
                <label key={t.id} className="indent">
                  <input type="checkbox" checked={value.includes(t.id)} onChange={(e) => toggle([t.id], e.target.checked)} /> {t.name}
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </details>
  );
}
