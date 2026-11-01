import { useState } from 'react';
import { del, post } from '../api';
import { useStore } from '../store';
import { reportError } from '../helpers';
import type { SavedView, ViewConfig } from '../types';

export function ViewMenu({
  views,
  current,
  onApply,
  onChange,
}: {
  views: SavedView[];
  current: ViewConfig;
  onApply: (c: ViewConfig) => void;
  onChange: (v: SavedView[]) => void;
}) {
  const { boot } = useStore();
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [shared, setShared] = useState(false);

  async function save() {
    try {
      const v = await post<SavedView>('/api/views', { name, config: current, isDefault, shared });
      onChange([...views.map((x) => (isDefault ? { ...x, isDefault: false } : x)), v]);
      setName('');
    } catch (e) {
      reportError(e);
    }
  }
  async function remove(id: number) {
    try {
      await del(`/api/views/${id}`);
      onChange(views.filter((v) => v.id !== id));
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <details className="dropdown">
      <summary>Ansichten</summary>
      <div className="menu views-menu">
        {views.length === 0 && <div className="muted small">Noch keine gespeicherten Ansichten.</div>}
        {views.map((v) => (
          <div key={v.id} className="row">
            <button className="link" onClick={() => onApply(v.config)}>
              {v.isDefault ? '★ ' : ''}
              {v.name}
              {v.shared ? ' (geteilt)' : ''}
            </button>
            {v.own && (
              <button className="icon" title="Löschen" onClick={() => void remove(v.id)}>
                🗑
              </button>
            )}
          </div>
        ))}
        <hr />
        <div className="small strong">Aktuelle Ansicht speichern</div>
        <input placeholder="Name, z. B. „Meine Teams“" value={name} onChange={(e) => setName(e.target.value)} />
        <label>
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> als Standardansicht
        </label>
        {boot?.me.isAdmin && (
          <label>
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> für alle freigeben
          </label>
        )}
        <button className="primary" disabled={!name.trim()} onClick={() => void save()}>
          Speichern
        </button>
      </div>
    </details>
  );
}
