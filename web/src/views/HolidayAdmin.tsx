import { useEffect, useState } from 'react';
import { del, get, post, put } from '../api';
import { store } from '../store';
import { WEEKDAYS, parse, today } from '../dates';
import { reportError } from '../helpers';
import type { Holiday } from '../types';
import { Modal } from '../components/Modal';

const KIND_LABEL: Record<Holiday['kind'], string> = { public: 'Feiertag', company: 'arbeitsfrei' };

interface SourceItem {
  date: string;
  name: string;
  kind: Holiday['kind'];
  group: 'official' | 'regional' | 'common';
  note?: string;
  status: 'missing' | 'present' | 'different';
  current: Holiday | null;
}
interface SourceResult { year: number; state: string; items: SourceItem[]; obsolete: Holiday[] }

function fmt(date: string): string {
  return `${WEEKDAYS[parse(date).getUTCDay()]}, ${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

/** Verwaltung → Feiertage: gesetzliche Feiertage und betrieblich arbeitsfreie Tage pflegen. */
export function HolidayAdmin({ stateName }: { stateName: (code: string) => string }) {
  const [year, setYear] = useState(Number(today().slice(0, 4)));
  const [list, setList] = useState<Holiday[] | null>(null);
  const [edit, setEdit] = useState<Partial<Holiday> | null>(null);
  const [importing, setImporting] = useState(false);
  const [state, setState] = useState('');

  const load = () => get<Holiday[]>(`/api/holidays?year=${year}`).then(setList, reportError);
  useEffect(() => {
    setList(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);
  useEffect(() => void get<{ holidayState: string }>('/api/admin/settings').then((s) => setState(s.holidayState), reportError), []);

  async function remove(h: Holiday) {
    if (!confirm(`„${h.name}“ am ${fmt(h.date)} löschen?`)) return;
    try {
      await del(`/api/admin/holidays/${h.id}`);
      store.toast('Gelöscht');
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
        <button className="primary" onClick={() => setEdit({ date: `${year}-12-24`, name: '', kind: 'company' })}>+ Tag hinzufügen</button>
        <button onClick={() => setImporting(true)}>Aus Quelle übernehmen …</button>
      </div>
      <p className="muted small">
        <strong>Feiertag</strong> = gesetzlicher Feiertag, <strong>arbeitsfrei</strong> = betrieblich freier Tag ohne gesetzlichen Status
        (z. B. Heiligabend, Silvester, Rosenmontag). Beide werden im Plan markiert und beim Urlaub nicht als Urlaubstag gezählt.
        Quelle: eingebaute Berechnung für {stateName(state) || '…'} (Bundesland unter <em>Einstellungen</em>).
      </p>
      {!list ? (
        <p className="muted">Lade …</p>
      ) : (
        <table className="simple">
          <thead>
            <tr><th>Datum</th><th>Bezeichnung</th><th>Art</th><th>Herkunft</th><th /></tr>
          </thead>
          <tbody>
            {list.map((h) => (
              <tr key={h.id}>
                <td>{fmt(h.date)}</td>
                <td>{h.name}</td>
                <td><span className={h.kind === 'company' ? 'badge free' : 'badge'}>{KIND_LABEL[h.kind]}</span></td>
                <td className="muted small">{h.fromSource ? 'Quelle' : 'eigener Eintrag'}</td>
                <td className="row">
                  <button onClick={() => setEdit(h)}>Bearbeiten</button>
                  <button className="danger" onClick={() => void remove(h)}>Löschen</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={5} className="muted">Keine Einträge für {year}.</td></tr>
            )}
          </tbody>
        </table>
      )}
      {edit && <HolidayForm value={edit} onClose={(changed) => { setEdit(null); if (changed) void load(); }} />}
      {importing && <ImportDialog year={year} stateName={stateName(state)} onClose={(changed) => { setImporting(false); if (changed) void load(); }} />}
    </div>
  );
}

function HolidayForm({ value, onClose }: { value: Partial<Holiday>; onClose: (changed: boolean) => void }) {
  const [v, setV] = useState(value);
  async function save() {
    const body = { date: v.date, name: v.name?.trim(), kind: v.kind };
    try {
      if (v.id) await put(`/api/admin/holidays/${v.id}`, body);
      else await post('/api/admin/holidays', body);
      store.toast('Gespeichert');
      onClose(true);
    } catch (e) {
      reportError(e);
    }
  }
  return (
    <Modal title={v.id ? 'Tag bearbeiten' : 'Tag hinzufügen'} onClose={() => onClose(false)}>
      <div className="form">
        <label>Datum<input type="date" value={v.date ?? ''} onChange={(e) => setV({ ...v, date: e.target.value })} /></label>
        <label>Bezeichnung<input value={v.name ?? ''} maxLength={80} placeholder="z. B. Heiligabend" onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <label>Art
          <select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as Holiday['kind'] })}>
            <option value="public">gesetzlicher Feiertag</option>
            <option value="company">arbeitsfreier Tag (betrieblich)</option>
          </select>
        </label>
        {v.fromSource && <p className="muted small">Nach dem Ändern gilt der Tag als eigener Eintrag und bleibt auch beim Wechsel des Bundeslandes erhalten.</p>}
      </div>
      <div className="actions">
        <button className="primary" disabled={!v.date || !v.name?.trim()} onClick={() => void save()}>Speichern</button>
      </div>
    </Modal>
  );
}

const GROUPS: { key: SourceItem['group']; title: string; hint: string }[] = [
  { key: 'official', title: 'Gesetzliche Feiertage', hint: 'gelten im ganzen Bundesland' },
  { key: 'regional', title: 'Regionale Feiertage', hint: 'gelten nur in Teilen des Bundeslandes – nur übernehmen, wenn sie für euch gelten' },
  { key: 'common', title: 'Häufig arbeitsfreie Tage', hint: 'keine Feiertage, werden als „arbeitsfrei“ übernommen' },
];

function ImportDialog({ year, stateName, onClose }: { year: number; stateName: string; onClose: (changed: boolean) => void }) {
  const [src, setSrc] = useState<SourceResult | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [remove, setRemove] = useState<Set<number>>(new Set());

  useEffect(() => {
    get<SourceResult>(`/api/admin/holidays/source?year=${year}`).then((r) => {
      setSrc(r);
      // vorausgewählt: fehlende gesetzliche Feiertage. Geänderte Tage bleiben unangetastet, Vorschläge sind freiwillig.
      setPicked(new Set(r.items.filter((i) => i.group === 'official' && i.status === 'missing').map((i) => i.date)));
    }, reportError);
  }, [year]);

  const toggle = (date: string, on: boolean) => {
    const s = new Set(picked);
    if (on) s.add(date);
    else s.delete(date);
    setPicked(s);
  };

  async function apply() {
    if (!src) return;
    const items = src.items.filter((i) => picked.has(i.date)).map((i) => ({ date: i.date, name: i.name, kind: i.kind }));
    try {
      const r = await post<{ imported: number; removed: number }>('/api/admin/holidays/import', { year, items, removeIds: [...remove] });
      store.toast(`${r.imported} übernommen${r.removed ? `, ${r.removed} entfernt` : ''}`);
      onClose(true);
    } catch (e) {
      reportError(e);
    }
  }

  const status = (i: SourceItem) =>
    i.status === 'present' ? <span className="muted small">bereits vorhanden</span>
    : i.status === 'different' ? <span className="small warn">vorhanden als „{i.current?.name}“ ({KIND_LABEL[i.current!.kind]}) – Übernehmen ersetzt</span>
    : <span className="small">fehlt</span>;

  return (
    <Modal title={`Aus Quelle übernehmen – ${year}`} onClose={() => onClose(false)} wide>
      {!src ? (
        <p className="muted">Lade …</p>
      ) : (
        <>
          <p className="muted small">Quelle: eingebaute Berechnung für {stateName}. Vorhandene Einträge am selben Datum werden beim Übernehmen ersetzt.</p>
          {GROUPS.map((g) => {
            const items = src.items.filter((i) => i.group === g.key);
            if (items.length === 0) return null;
            const selectable = items.filter((i) => i.status !== 'present');
            const allOn = selectable.length > 0 && selectable.every((i) => picked.has(i.date));
            return (
              <div key={g.key} className="import-group">
                <h3>
                  <label className="inline">
                    <input type="checkbox" disabled={selectable.length === 0} checked={allOn}
                      onChange={(e) => { const s = new Set(picked); for (const i of selectable) (e.target.checked ? s.add(i.date) : s.delete(i.date)); setPicked(s); }} />
                    {g.title}
                  </label>
                  <span className="muted small"> – {g.hint}</span>
                </h3>
                <table className="simple">
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.date + i.name} className={i.status === 'present' ? 'inactive-soft' : ''}>
                        <td style={{ width: 28 }}>
                          <input type="checkbox" aria-label={i.name} disabled={i.status === 'present'} checked={picked.has(i.date)} onChange={(e) => toggle(i.date, e.target.checked)} />
                        </td>
                        <td style={{ width: 150 }}>{fmt(i.date)}</td>
                        <td>{i.name}{i.note && <div className="muted small">{i.note}</div>}</td>
                        <td>{status(i)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          {src.obsolete.length > 0 && (
            <div className="import-group">
              <h3>Nicht mehr in der Quelle <span className="muted small"> – früher übernommen, gilt aber nicht für {stateName}</span></h3>
              <table className="simple">
                <tbody>
                  {src.obsolete.map((h) => (
                    <tr key={h.id}>
                      <td style={{ width: 28 }}>
                        <input type="checkbox" aria-label={`${h.name} entfernen`} checked={remove.has(h.id)}
                          onChange={(e) => { const s = new Set(remove); if (e.target.checked) s.add(h.id); else s.delete(h.id); setRemove(s); }} />
                      </td>
                      <td style={{ width: 150 }}>{fmt(h.date)}</td>
                      <td>{h.name}</td>
                      <td className="small">entfernen</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="actions">
            <button onClick={() => onClose(false)}>Abbrechen</button>
            <button className="primary" disabled={picked.size === 0 && remove.size === 0} onClick={() => void apply()}>
              {picked.size} übernehmen{remove.size ? `, ${remove.size} entfernen` : ''}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
