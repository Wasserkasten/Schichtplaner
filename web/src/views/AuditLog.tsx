import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../api';
import { store, useStore } from '../store';
import { describeEntries, entryLabel, when, type EntryLike } from '../describe';
import { reportError } from '../helpers';
import type { Bootstrap, Entry } from '../types';
import { CellEditor } from '../components/CellEditor';

export interface Row {
  id: number;
  ts: string;
  user_id: number | null;
  user_name: string | null;
  action: 'create' | 'update' | 'delete';
  entity: string;
  entity_id: number | null;
  employee_id: number | null;
  employee_last: string | null;
  employee_first: string | null;
  date: string | null;
  before_json: string | null;
  after_json: string | null;
  change_id: string | null;
  undo_of: string | null;
}
interface Page { rows: Row[]; undone: string[]; nextBeforeId: number | null }

export interface Group {
  key: string;
  rows: Row[];
  first: Row;
  text: string;
  isEntry: boolean;
  cell: { employeeId: number; date: string } | null;
}

const VERB: Record<string, string> = { create: 'angelegt', update: 'geändert', delete: 'gelöscht' };
const dmy = (d: string) => d.split('-').reverse().join('.');
const parse = <T,>(j: string | null): T | null => (j ? (JSON.parse(j) as T) : null);

/** Beschreibung für Änderungen außerhalb des Plans (Mitarbeiter, Benutzer, Feiertage …). */
function describeAdmin(r: Row): string {
  const b = parse<Record<string, unknown>>(r.before_json);
  const a = parse<Record<string, unknown>>(r.after_json);
  const pick = (...keys: string[]) => {
    for (const o of [a, b]) for (const k of keys) if (o && o[k] != null && o[k] !== '') return String(o[k]);
    return '';
  };
  const verb = VERB[r.action] ?? r.action;
  switch (r.entity) {
    case 'employee': {
      const last = pick('lastName', 'last_name');
      return `Mitarbeiter ${verb}: ${last ? `${last}, ${pick('firstName', 'first_name')}` : `#${r.entity_id}`}`;
    }
    case 'user':
      return `Benutzer ${verb}: ${pick('username') || `#${r.entity_id}`}${pick('displayName', 'display_name') ? ` (${pick('displayName', 'display_name')})` : ''}`;
    case 'team':
      return `Team ${verb}: ${pick('name')}`;
    case 'department':
      return `Abteilung ${verb}: ${pick('name')}`;
    case 'entry_type':
      return `Eintragsart ${verb}: ${pick('code')} – ${pick('name')}`;
    case 'holiday':
      return `Feiertag ${verb}: ${pick('name')}${pick('date') ? ` (${dmy(pick('date'))})` : ''}`;
    case 'holidays': {
      const imported = Number(a?.imported ?? 0);
      const removed = Number(a?.removed ?? 0);
      return `Feiertage ${r.entity_id} aus Quelle übernommen: ${imported}${removed ? `, ${removed} entfernt` : ''}`;
    }
    case 'settings':
      return 'Einstellungen geändert';
    case 'demo_data':
      return r.action === 'create' ? 'Beispieldaten eingefügt' : 'Beispieldaten entfernt';
    default:
      return `${r.entity} ${verb}`;
  }
}

function describeGroup(boot: Bootstrap, rows: Row[]): string {
  const first = rows[0];
  if (first.entity !== 'entry') return rows.length > 1 ? `${describeAdmin(first)} (+${rows.length - 1})` : describeAdmin(first);
  const names = new Map(rows.filter((r) => r.employee_id && r.employee_last).map((r) => [r.employee_id!, `${r.employee_last}, ${r.employee_first}`]));
  const created: EntryLike[] = [];
  const removed: EntryLike[] = [];
  const updated: { before: EntryLike; after: EntryLike }[] = [];
  for (const r of rows) {
    const b = parse<EntryLike>(r.before_json);
    const a = parse<EntryLike>(r.after_json);
    if (r.action === 'create' && a) created.push(a);
    else if (r.action === 'delete' && b) removed.push(b);
    else if (r.action === 'update' && a && b) updated.push({ before: b, after: a });
  }
  const text = describeEntries(boot, { created, removed, updated }, (id) => names.get(id));
  return first.undo_of ? `Rückgängig gemacht: ${text}` : text;
}

/** Protokollzeilen zu Änderungen zusammenfassen (gleiche change_id = eine Aktion). */
export function buildGroups(boot: Bootstrap, rows: Row[]): Group[] {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.change_id ?? `row-${r.id}`;
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return [...map.entries()].map(([key, rs]) => {
    const cells = new Set(rs.filter((r) => r.employee_id && r.date).map((r) => `${r.employee_id}|${r.date}`));
    const [emp, date] = cells.size === 1 ? [...cells][0].split('|') : [];
    return {
      key,
      rows: rs,
      first: rs[0],
      text: describeGroup(boot, rs),
      isEntry: rs[0].entity === 'entry',
      cell: emp ? { employeeId: Number(emp), date } : null,
    };
  });
}

/** Eine Zeile der Details: einzelner Eintrag mit Vorher/Nachher. */
export function detail(boot: Bootstrap, r: Row): string {
  const b = parse<EntryLike>(r.before_json);
  const a = parse<EntryLike>(r.after_json);
  const who = r.employee_last ? `${r.employee_last}, ${r.employee_first}` : `#${r.employee_id}`;
  const day = r.date ? when([{ employeeId: 0, date: r.date, typeId: null, text: null }]) : '';
  const what = r.action === 'update' && a && b ? `${entryLabel(boot, b)} → ${entryLabel(boot, a)}` : r.action === 'create' && a ? `${entryLabel(boot, a)} eingetragen` : b ? `${entryLabel(boot, b)} gelöscht` : VERB[r.action];
  return `${day} · ${who}: ${what}`;
}

export function AuditLog() {
  const st = useStore();
  const boot = st.boot!;
  const [rows, setRows] = useState<Row[]>([]);
  const [undone, setUndone] = useState<Set<string>>(new Set());
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'plan' | 'admin'>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<{ employeeId: number; date: string } | null>(null);

  async function load(beforeId?: number) {
    setLoading(true);
    try {
      const page = await get<Page>(`/api/audit?limit=300${beforeId ? `&beforeId=${beforeId}` : ''}`);
      setRows((r) => (beforeId ? [...r, ...page.rows] : page.rows));
      setUndone((u) => new Set([...(beforeId ? u : []), ...page.undone]));
      setNext(page.nextBeforeId);
    } catch (e) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => void load(), []);

  const groups = useMemo<Group[]>(() => buildGroups(boot, rows), [rows, boot]);

  const q = search.trim().toLowerCase();
  const shown = groups.filter(
    (g) =>
      (filter === 'all' || (filter === 'plan') === g.isEntry) &&
      (!q || g.text.toLowerCase().includes(q) || (g.first.user_name ?? '').toLowerCase().includes(q)),
  );

  async function undo(g: Group) {
    if (!g.first.change_id) return;
    if (!confirm(`„${g.text}“ rückgängig machen?`)) return;
    try {
      const res = await post<{ changeId: string; upserted: Entry[]; deleted: number[] }>(`/api/changes/${g.first.change_id}/undo`);
      store.remove(res.deleted);
      store.upsert(res.upserted);
      store.toast('Rückgängig gemacht');
      void load();
    } catch (e) {
      reportError(e);
    }
  }

  const toggle = (k: string) => {
    const s = new Set(open);
    if (s.has(k)) s.delete(k);
    else s.add(k);
    setOpen(s);
  };

  return (
    <div className="audit">
      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter">
          <option value="all">Alle Änderungen</option>
          <option value="plan">nur Plan (Dienste, Abwesenheiten)</option>
          <option value="admin">nur Verwaltung</option>
        </select>
        <input type="search" placeholder="Suchen: Name, Kürzel, Benutzer …" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button onClick={() => void load()} disabled={loading}>Aktualisieren</button>
      </div>
      <table className="simple">
        <thead>
          <tr><th style={{ width: 140 }}>Zeitpunkt</th><th style={{ width: 160 }}>Benutzer</th><th>Änderung</th><th style={{ width: 200 }} /></tr>
        </thead>
        <tbody>
          {shown.map((g) => {
            const isUndone = !!g.first.change_id && undone.has(g.first.change_id);
            const canOpen = g.cell && boot.employees.some((e) => e.id === g.cell!.employeeId);
            return (
              <tr key={g.key} className={isUndone ? 'inactive-soft' : ''}>
                <td>{new Date(g.first.ts).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{g.first.user_name ?? '–'}</td>
                <td>
                  {g.text}
                  {isUndone && <span className="badge light"> zurückgenommen</span>}
                  {g.rows.length > 1 && g.isEntry && (
                    <button className="link small details-toggle" onClick={() => toggle(g.key)}>
                      {open.has(g.key) ? '▾' : '▸'} {g.rows.length} Einzeländerungen
                    </button>
                  )}
                  {open.has(g.key) && (
                    <ul className="small audit-details">
                      {g.rows.map((r) => (
                        <li key={r.id}>{detail(boot, r)}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="row">
                  {canOpen && <button onClick={() => setHistory(g.cell)} title="Verlauf dieser Zelle öffnen">Verlauf</button>}
                  {g.isEntry && g.first.change_id && !isUndone && (
                    <button onClick={() => void undo(g)} title="Diese Änderung zurücknehmen">↶ Rückgängig</button>
                  )}
                </td>
              </tr>
            );
          })}
          {shown.length === 0 && !loading && <tr><td colSpan={4} className="muted">Keine Einträge.</td></tr>}
        </tbody>
      </table>
      {next && <div className="actions"><button disabled={loading} onClick={() => void load(next)}>Ältere laden</button></div>}
      {history && <CellEditor {...history} initialTab="history" onClose={() => setHistory(null)} />}
    </div>
  );
}
