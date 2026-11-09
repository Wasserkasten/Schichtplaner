import { useEffect, useState } from 'react';
import { del, get, post, put } from '../api';
import { store } from '../store';
import { WEEKDAYS, parse, today } from '../dates';
import { reportError } from '../helpers';
import type { SchoolHoliday } from '../types';
import { Modal } from '../components/Modal';

interface SourceItem { start: string; end: string; name: string; status: 'missing' | 'present' | 'different'; current: SchoolHoliday | null }

const fmt = (d: string) => `${WEEKDAYS[parse(d).getUTCDay()]} ${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const days = (p: { start: string; end: string }) => Math.round((parse(p.end).getTime() - parse(p.start).getTime()) / 86400_000) + 1;

/** Verwaltung → Ferien: Schulferien je Bundesland aus der Quelle laden oder von Hand pflegen. */
export function SchoolHolidayAdmin({ states }: { states: Record<string, string> }) {
  const [year, setYear] = useState(Number(today().slice(0, 4)));
  const [state, setState] = useState('');
  const [list, setList] = useState<SchoolHoliday[] | null>(null);
  const [edit, setEdit] = useState<Partial<SchoolHoliday> | null>(null);
  const [importing, setImporting] = useState(false);

  const load = () =>
    get<{ state: string; periods: SchoolHoliday[] }>(`/api/school-holidays?year=${year}`).then((r) => {
      setList(r.periods);
      setState(r.state);
    }, reportError);
  useEffect(() => {
    setList(null);
    void load();
  }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  async function changeState(s: string) {
    try {
      await put('/api/admin/school-holidays/state', { state: s });
      setState(s);
      store.toast(`Ferien-Bundesland: ${states[s]}. Ferien jetzt über „Aus Quelle laden“ übernehmen.`);
    } catch (e) {
      reportError(e);
    }
  }

  async function remove(p: SchoolHoliday) {
    if (!confirm(`„${p.name}“ (${fmt(p.start)} – ${fmt(p.end)}) löschen?`)) return;
    try {
      await del(`/api/admin/school-holidays/${p.id}`);
      void load();
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <div className="holidays">
      <div className="toolbar">
        <button onClick={() => setYear(year - 1)} aria-label="Vorjahr">◀</button>
        <h1>{year}</h1>
        <button onClick={() => setYear(year + 1)} aria-label="Folgejahr">▶</button>
        <label className="inline small">
          Bundesland
          <select value={state} onChange={(e) => void changeState(e.target.value)}>
            {Object.entries(states).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </label>
        <button className="primary" onClick={() => setImporting(true)}>Aus Quelle laden …</button>
        <button onClick={() => setEdit({ start: `${year}-01-01`, end: `${year}-01-01`, name: '' })}>+ Zeitraum</button>
      </div>
      <p className="muted small">
        Schulferien erscheinen im Kalender als <span className="sf-inline">türkiser Balken</span> über den Tagen und in der Tagesübersicht.
        Sie sind nur ein Hinweis (z. B. für die Urlaubsplanung) und sperren nichts. Quelle: openholidaysapi.org – abgefragt nur, wenn du „Aus Quelle laden“ wählst.
      </p>
      {!list ? (
        <p className="muted">Lade …</p>
      ) : (
        <table className="simple">
          <thead><tr><th>Zeitraum</th><th>Tage</th><th>Bezeichnung</th><th>Herkunft</th><th /></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{fmt(p.start)}{p.end !== p.start && <> – {fmt(p.end)}</>}</td>
                <td>{days(p)}</td>
                <td>{p.name}</td>
                <td className="muted small">{p.fromSource ? `Quelle (${p.state})` : 'eigener Eintrag'}</td>
                <td className="row">
                  <button onClick={() => setEdit(p)}>Bearbeiten</button>
                  <button className="danger" onClick={() => void remove(p)}>Löschen</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={5} className="muted">Für {year} sind noch keine Ferien hinterlegt – über „Aus Quelle laden“ übernehmen.</td></tr>
            )}
          </tbody>
        </table>
      )}
      {edit && <PeriodForm value={edit} onClose={(ok) => { setEdit(null); if (ok) void load(); }} />}
      {importing && <ImportDialog year={year} state={state} stateName={states[state] ?? state} onClose={(ok) => { setImporting(false); if (ok) void load(); }} />}
    </div>
  );
}

function PeriodForm({ value, onClose }: { value: Partial<SchoolHoliday>; onClose: (ok: boolean) => void }) {
  const [v, setV] = useState(value);
  async function save() {
    try {
      const body = { start: v.start, end: v.end, name: v.name?.trim() };
      if (v.id) await put(`/api/admin/school-holidays/${v.id}`, body);
      else await post('/api/admin/school-holidays', body);
      onClose(true);
    } catch (e) {
      reportError(e);
    }
  }
  return (
    <Modal title={v.id ? 'Ferien bearbeiten' : 'Ferien hinzufügen'} onClose={() => onClose(false)}>
      <div className="form grid2">
        <label>Von<input type="date" value={v.start ?? ''} onChange={(e) => setV({ ...v, start: e.target.value, end: v.end && v.end >= e.target.value ? v.end : e.target.value })} /></label>
        <label>Bis einschließlich<input type="date" value={v.end ?? ''} min={v.start} onChange={(e) => setV({ ...v, end: e.target.value })} /></label>
        <label>Bezeichnung<input value={v.name ?? ''} placeholder="z. B. Herbstferien" onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
      </div>
      <div className="actions"><button className="primary" disabled={!v.start || !v.end || !v.name?.trim()} onClick={() => void save()}>Speichern</button></div>
    </Modal>
  );
}

function ImportDialog({ year, state, stateName, onClose }: { year: number; state: string; stateName: string; onClose: (ok: boolean) => void }) {
  const [items, setItems] = useState<SourceItem[] | null>(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  useEffect(() => {
    get<{ items: SourceItem[] }>(`/api/admin/school-holidays/source?year=${year}&state=${state}`).then(
      (r) => {
        setItems(r.items);
        setPicked(new Set(r.items.map((it, i) => (it.status !== 'present' ? i : -1)).filter((i) => i >= 0)));
      },
      (e: Error) => setError(e.message),
    );
  }, [year, state]);
  async function apply() {
    try {
      const r = await post<{ imported: number }>('/api/admin/school-holidays/import', { state, items: items!.filter((_, i) => picked.has(i)).map(({ start, end, name }) => ({ start, end, name })) });
      store.toast(`${r.imported} Zeiträume übernommen`);
      onClose(true);
    } catch (e) {
      reportError(e);
    }
  }
  return (
    <Modal title={`Schulferien ${year} – ${stateName}`} onClose={() => onClose(false)} wide>
      {error ? (
        <p className="error">{error}</p>
      ) : !items ? (
        <p className="muted">Lade von openholidaysapi.org …</p>
      ) : (
        <>
          <table className="simple">
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className={it.status === 'present' ? 'inactive-soft' : ''}>
                  <td style={{ width: 28 }}>
                    <input type="checkbox" aria-label={it.name} disabled={it.status === 'present'} checked={picked.has(i)}
                      onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(i); else n.delete(i); setPicked(n); }} />
                  </td>
                  <td>{fmt(it.start)}{it.end !== it.start && <> – {fmt(it.end)}</>}</td>
                  <td>{it.name}</td>
                  <td className="small">
                    {it.status === 'present' ? <span className="muted">bereits vorhanden</span>
                      : it.status === 'different' ? <span className="warn">ersetzt „{it.current?.name}“ ({fmt(it.current!.start)} – {fmt(it.current!.end)})</span>
                      : 'fehlt'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actions">
            <button onClick={() => onClose(false)}>Abbrechen</button>
            <button className="primary" disabled={picked.size === 0} onClick={() => void apply()}>{picked.size} übernehmen</button>
          </div>
        </>
      )}
    </Modal>
  );
}
