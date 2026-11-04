import { useEffect, useState } from 'react';
import { del, get, patch, post } from '../api';
import { store, useStore } from '../store';
import { addDays, fmtLong, isWeekend } from '../dates';
import { canEditEmployee, fullName, reportError, typeMap } from '../helpers';
import type { Entry } from '../types';
import { Modal } from './Modal';
import { EntryChip } from './EntryChip';

interface AuditRow {
  id: number;
  ts: string;
  action: string;
  user_name: string | null;
  before_json: string | null;
  after_json: string | null;
}

/** Bearbeitungsdialog für eine Zelle (Mitarbeiter + Tag). */
export function CellEditor({ employeeId, date, onClose }: { employeeId: number; date: string; onClose: () => void }) {
  const st = useStore();
  const boot = st.boot!;
  const types = typeMap(boot);
  const emp = boot.employees.find((e) => e.id === employeeId)!;
  const entries = st.cell(employeeId, date);
  const editable = canEditEmployee(boot, employeeId);
  const [tab, setTab] = useState<'edit' | 'history'>('edit');

  return (
    <Modal title={`${fullName(emp)} – ${fmtLong(date)}`} onClose={onClose}>
      <div className="subtabs">
        <button className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>Einträge</button>
        {editable && <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Verlauf</button>}
      </div>
      {tab === 'edit' ? (
        <>
          {entries.length === 0 && <p className="muted">Kein Eintrag.</p>}
          {entries.map((e) => (editable && !e.masked ? <EntryEditRow key={e.id} e={e} /> : <div key={e.id} className="entry-row"><EntryChip e={e} types={types} long /></div>))}
          {editable && <NewEntry employeeId={employeeId} date={date} />}
          {!editable && <p className="muted small">Du hast für dieses Team nur Leserechte.</p>}
        </>
      ) : (
        <History employeeId={employeeId} date={date} />
      )}
    </Modal>
  );
}

function TypeSelect({ value, onChange, disabledIds = [] }: { value: number | null; onChange: (v: number | null) => void; disabledIds?: number[] }) {
  const { boot } = useStore();
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">– nur Freitext –</option>
      {(['shift', 'presence', 'absence'] as const).map((cat) => (
        <optgroup key={cat} label={{ shift: 'Dienste', presence: 'Anwesenheit', absence: 'Abwesenheit' }[cat]}>
          {boot!.entryTypes
            .filter((t) => t.category === cat && (t.active || t.id === value))
            .map((t) => (
              <option key={t.id} value={t.id} disabled={disabledIds.includes(t.id) && t.id !== value}>
                {t.code} – {t.name}{disabledIds.includes(t.id) && t.id !== value ? ' (schon eingetragen)' : ''}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

function EntryEditRow({ e }: { e: Entry }) {
  const { boot } = useStore();
  const types = typeMap(boot!);
  const [typeId, setTypeId] = useState(e.typeId);
  const [text, setText] = useState(e.text ?? '');
  const [startTime, setStart] = useState(e.startTime ?? '');
  const [endTime, setEnd] = useState(e.endTime ?? '');
  const dirty = typeId !== e.typeId || text !== (e.text ?? '') || startTime !== (e.startTime ?? '') || endTime !== (e.endTime ?? '');

  // Wenn jemand anderes den Eintrag ändert, Formular aktualisieren
  useEffect(() => {
    setTypeId(e.typeId);
    setText(e.text ?? '');
    setStart(e.startTime ?? '');
    setEnd(e.endTime ?? '');
  }, [e.version, e.typeId, e.text, e.startTime, e.endTime]);

  async function save() {
    try {
      const updated = await patch<Entry>(`/api/entries/${e.id}`, {
        version: e.version,
        typeId,
        text: text || null,
        startTime: startTime || null,
        endTime: endTime || null,
      });
      store.upsert([updated]);
    } catch (err) {
      reportError(err);
    }
  }
  async function remove() {
    try {
      await del(`/api/entries/${e.id}?version=${e.version}`);
      store.remove([e.id]);
    } catch (err) {
      reportError(err);
    }
  }
  const by = boot!.users.find((u) => u.id === e.updatedBy)?.displayName;
  return (
    <div className="entry-edit">
      <div className="entry-head">
        <EntryChip e={e} types={types} long />
        <span className="muted small">{by ? `zuletzt: ${by}` : ''}</span>
      </div>
      <div className="grid2">
        <label>Art<TypeSelect value={typeId} onChange={setTypeId} /></label>
        <label>Freitext / Notiz<input value={text} maxLength={200} onChange={(ev) => setText(ev.target.value)} /></label>
        <label>Von<input type="time" value={startTime} onChange={(ev) => setStart(ev.target.value)} /></label>
        <label>Bis<input type="time" value={endTime} onChange={(ev) => setEnd(ev.target.value)} /></label>
      </div>
      <div className="actions">
        <button className="danger" onClick={() => void remove()}>Löschen</button>
        <button className="primary" disabled={!dirty || (!typeId && !text.trim())} onClick={() => void save()}>Speichern</button>
      </div>
    </div>
  );
}

/** Höchstzahl Dienste/An-/Abwesenheiten je Tag – wie auf dem Server (MAX_TYPED_PER_CELL). */
const MAX_TYPED = 3;

function NewEntry({ employeeId, date }: { employeeId: number; date: string }) {
  const st = useStore();
  const [typeId, setTypeId] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [until, setUntil] = useState(date);
  const [workdaysOnly, setWorkdaysOnly] = useState(true);
  // null = automatisch: an einem einzelnen Tag zusätzlich eintragen, über einen Zeitraum (z. B. Urlaub) ersetzen
  const [replaceChoice, setReplace] = useState<boolean | null>(null);
  const range = until !== date;
  const replace = replaceChoice ?? range;
  const typed = st.cell(employeeId, date).filter((e) => e.typeId);
  const full = !range && !replace && !!typeId && typed.length >= MAX_TYPED;

  async function add() {
    const dates: string[] = [];
    for (let d = date; d <= until && dates.length < 366; d = addDays(d, 1)) {
      if (until !== date && workdaysOnly && (isWeekend(d) || store.holidayOn(d))) continue;
      dates.push(d);
    }
    try {
      const res = await post<{ created: Entry[]; deleted: number[]; skipped: number }>('/api/entries/bulk', {
        action: typeId && replace ? 'set' : 'add',
        cells: dates.map((d) => ({ employeeId, date: d })),
        typeId,
        text: text.trim() || null,
      });
      store.remove(res.deleted);
      store.upsert(res.created);
      if (res.skipped) store.toast(`${res.skipped} ${res.skipped === 1 ? 'Tag' : 'Tage'} übersprungen: dort schon eingetragen oder bereits ${MAX_TYPED} Dienste.`);
      setText('');
      setTypeId(null);
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <div className="entry-new">
      <h3>
        Neuer Eintrag
        {typed.length > 0 && <span className="muted small"> · an diesem Tag {typed.length} von {MAX_TYPED} Diensten eingetragen</span>}
      </h3>
      <div className="grid2">
        <label>Art<TypeSelect value={typeId} onChange={setTypeId} disabledIds={range || replace ? [] : typed.map((e) => e.typeId!)} /></label>
        <label>Freitext / Notiz<input value={text} maxLength={200} placeholder="z. B. Arzttermin 10 Uhr" onChange={(e) => setText(e.target.value)} /></label>
        <label>Bis einschließlich<input type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value || date)} /></label>
        <div className="checks">
          {until !== date && (
            <label><input type="checkbox" checked={workdaysOnly} onChange={(e) => setWorkdaysOnly(e.target.checked)} /> nur Werktage</label>
          )}
          {typeId && (
            <label title="Aus: zusätzlich eintragen (bis zu 3 Dienste pro Tag). An: vorhandene Dienste werden ersetzt, Notizen bleiben.">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> vorhandene Dienste ersetzen
            </label>
          )}
        </div>
      </div>
      {full && <p className="small warn">An diesem Tag sind schon {MAX_TYPED} Dienste eingetragen. Einen entfernen oder „vorhandene Dienste ersetzen“ wählen.</p>}
      <div className="actions">
        <button className="primary" disabled={(!typeId && !text.trim()) || full} onClick={() => void add()}>Hinzufügen</button>
      </div>
    </div>
  );
}

function History({ employeeId, date }: { employeeId: number; date: string }) {
  const { boot } = useStore();
  const types = typeMap(boot!);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  useEffect(() => {
    get<AuditRow[]>(`/api/audit?employeeId=${employeeId}&date=${date}`).then(setRows, reportError);
  }, [employeeId, date]);
  if (!rows) return <p className="muted">Lade …</p>;
  if (rows.length === 0) return <p className="muted">Keine Änderungen protokolliert.</p>;
  const describe = (json: string | null) => {
    if (!json) return '–';
    const e = JSON.parse(json) as Entry;
    const t = e.typeId ? types.get(e.typeId) : undefined;
    return [t ? `${t.code} (${t.name})` : null, e.text].filter(Boolean).join(' – ');
  };
  const verb: Record<string, string> = { create: 'angelegt', update: 'geändert', delete: 'gelöscht' };
  return (
    <table className="simple">
      <thead><tr><th>Zeitpunkt</th><th>Wer</th><th>Aktion</th><th>Vorher</th><th>Nachher</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{new Date(r.ts).toLocaleString('de-DE')}</td>
            <td>{r.user_name ?? '–'}</td>
            <td>{verb[r.action] ?? r.action}</td>
            <td>{describe(r.before_json)}</td>
            <td>{describe(r.after_json)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
