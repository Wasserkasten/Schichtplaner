import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NavState } from '../App';
import { post } from '../api';
import { store, useStore } from '../store';
import { MONTHS, WEEKDAYS, addDays, addMonths, daysInMonth, isWeekend, isoWeek, monthStart, parse, range, today, weekday } from '../dates';
import { canEditEmployee, departmentName, groupedEmployees, reportError, teamLabel, typeMap } from '../helpers';
import type { Entry, EntryType, Holiday } from '../types';
import { EntryChip } from '../components/EntryChip';
import { CellEditor } from '../components/CellEditor';

/** Pinsel: null = Auswahlmodus (Dialog), 'clear' = Radierer, Zahl = Eintragsart */
type Brush = null | 'clear' | number;

interface Sel { emp0: number; emp1: number; d0: number; d1: number; add: boolean }

/** Zeitraum-Auswahl: 0 = Kalendermonat, -1 = so viele Tage, wie in die Fensterbreite passen, sonst feste Anzahl Tage. */
export const FIT_WIDTH = -1;

/** Breiten in rem – müssen zu styles.css passen (--name-w bzw. --cell-w, Handy ab 700 px Breite). */
function dims(): { name: number; cell: number } {
  return window.innerWidth <= 700 ? { name: 8, cell: 2.15 } : { name: 12, cell: 2.45 };
}

function remPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
}

/** Montag der Woche, in der `d` liegt. */
function mondayOf(d: string): string {
  return addDays(d, -((weekday(d) + 6) % 7));
}

/** Wie viele Tage passen in die Breite des Kalenders? Aktualisiert sich bei Größenänderung und Schriftgröße. */
function useFittingDays(ref: React.RefObject<HTMLDivElement | null>, active: boolean, fontScale: number): number {
  const [n, setN] = useState(31);
  useLayoutEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    const measure = () => {
      const rem = remPx();
      const d = dims();
      setN(Math.max(3, Math.min(62, Math.floor((el.clientWidth - d.name * rem - 2) / (d.cell * rem)))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active, fontScale]); // Schriftgröße ändert die Zellbreite (rem) -> neu messen
  return n;
}

export function MonthView({ nav, setNav }: { nav: NavState; setNav: (n: NavState) => void }) {
  const st = useStore();
  const boot = st.boot!;
  const types = typeMap(boot);
  const groups = groupedEmployees(boot, nav.teamIds);
  const flat = groups.flatMap((g) => g.employees);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fit = nav.days === FIT_WIDTH;
  const fitting = useFittingDays(wrapRef, fit, boot.me.fontScale);

  // Zeitraum: Kalendermonat, N Tage ab Bezugsdatum oder "so viele wie passen"
  const from = nav.days ? nav.date : monthStart(nav.date);
  const count = fit ? fitting : nav.days || daysInMonth(parse(from).getUTCFullYear(), parse(from).getUTCMonth());
  const days = useMemo(() => range(from, count), [from, count]);
  const to = days[days.length - 1];
  const t = today();

  useEffect(() => {
    store.loadRange(from, to).catch(reportError);
  }, [from, to]);

  const [brush, setBrush] = useState<Brush>(null);
  const [addMode, setAddMode] = useState(false);
  const [editing, setEditing] = useState<{ employeeId: number; date: string } | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const dragging = useRef(false);

  const step = (dir: number) =>
    setNav({ ...nav, date: nav.days ? addDays(nav.date, dir * count) : addMonths(monthStart(nav.date), dir) });

  function changeRange(v: number) {
    // Monat: Bezugsdatum bleibt; feste Tage / Fensterbreite: ab Montag der aktuellen bzw. gezeigten Woche
    const date = v === 0 ? nav.date : nav.days ? nav.date : mondayOf(nav.date.slice(0, 7) === t.slice(0, 7) ? t : nav.date);
    setNav({ ...nav, days: v, date });
  }

  function inSel(ei: number, di: number) {
    if (!sel) return false;
    return ei >= Math.min(sel.emp0, sel.emp1) && ei <= Math.max(sel.emp0, sel.emp1) && di >= Math.min(sel.d0, sel.d1) && di <= Math.max(sel.d0, sel.d1);
  }

  async function applyBrush(s: Sel) {
    const cells: { employeeId: number; date: string }[] = [];
    for (let ei = Math.min(s.emp0, s.emp1); ei <= Math.max(s.emp0, s.emp1); ei++) {
      const emp = flat[ei];
      if (!canEditEmployee(boot, emp.id)) continue;
      for (let di = Math.min(s.d0, s.d1); di <= Math.max(s.d0, s.d1); di++) cells.push({ employeeId: emp.id, date: days[di] });
    }
    if (cells.length === 0) return;
    try {
      const res = await post<{ created: Entry[]; deleted: number[]; skipped: number; changeId: string }>('/api/entries/bulk', {
        action: brush === 'clear' ? 'clear' : s.add ? 'add' : 'set',
        typeId: brush === 'clear' ? undefined : brush,
        cells,
      });
      store.applyChange(res.changeId, { created: res.created, deletedIds: res.deleted });
      if (res.skipped) store.toast(`${res.skipped} ${res.skipped === 1 ? 'Tag' : 'Tage'} übersprungen: dort schon eingetragen oder bereits 3 Dienste.`);
    } catch (e) {
      reportError(e);
    }
  }

  useEffect(() => {
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setSel((s) => {
        if (s) void applyBrush(s);
        return null;
      });
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  });

  const onDown = (ei: number, di: number, e: React.PointerEvent) => {
    if (brush === null) return;
    e.preventDefault();
    dragging.current = true;
    // Strg/⌘ gedrückt: diesen Strich zusätzlich eintragen statt zu ersetzen
    setSel({ emp0: ei, emp1: ei, d0: di, d1: di, add: brush !== 'clear' && (addMode || e.ctrlKey || e.metaKey) });
  };
  const onEnter = (ei: number, di: number) => {
    if (dragging.current) setSel((s) => (s ? { ...s, emp1: ei, d1: di } : s));
  };

  const title = nav.days
    ? `${from.split('-').reverse().join('.')} – ${to.split('-').reverse().join('.')}`
    : `${MONTHS[parse(from).getUTCMonth()]} ${parse(from).getUTCFullYear()}`;
  let rowIndex = -1;
  const span = days.length;

  return (
    <div className="month">
      <div className="toolbar">
        <button onClick={() => step(-1)} aria-label="zurück">◀</button>
        <button onClick={() => setNav({ ...nav, date: nav.days ? mondayOf(t) : t })}>Heute</button>
        <button onClick={() => step(1)} aria-label="vor">▶</button>
        <h1>{title}</h1>
        <select value={nav.days} onChange={(e) => changeRange(Number(e.target.value))} aria-label="Zeitraum">
          <option value={0}>Monat</option>
          <option value={7}>7 Tage</option>
          <option value={14}>14 Tage</option>
          <option value={28}>4 Wochen</option>
          <option value={42}>6 Wochen</option>
          <option value={FIT_WIDTH}>Fensterbreite{fit ? ` (${count} Tage)` : ''}</option>
        </select>
      </div>

      <div className="palette" role="toolbar" aria-label="Pinsel">
        <button className={brush === null ? 'pal active' : 'pal'} onClick={() => setBrush(null)} title="Zelle anklicken öffnet den Bearbeitungsdialog">
          ✎ Auswahl
        </button>
        {boot.entryTypes
          .filter((ty) => ty.active)
          .map((ty) => (
            <button
              key={ty.id}
              className={brush === ty.id ? 'pal active' : 'pal'}
              style={{ background: ty.color, color: ty.textColor }}
              title={`${ty.name} – Zellen anklicken oder mit gedrückter Maus markieren`}
              onClick={() => setBrush(brush === ty.id ? null : ty.id)}
            >
              {ty.code}
            </button>
          ))}
        <button className={brush === 'clear' ? 'pal active' : 'pal'} onClick={() => setBrush(brush === 'clear' ? null : 'clear')} title="Einträge entfernen">
          ⌫ Leeren
        </button>
        <label className="pal-mode" title="Aus: der Pinsel ersetzt vorhandene Dienste. An: er trägt zusätzlich ein (bis zu 3 pro Tag). Alternativ beim Klicken Strg gedrückt halten.">
          <input type="checkbox" checked={addMode} onChange={(e) => setAddMode(e.target.checked)} /> zusätzlich eintragen
        </label>
        {brush !== null && (
          <span className="muted small">
            Pinsel aktiv: Zellen anklicken oder ziehen{brush !== 'clear' && !addMode ? ' – Strg halten = zusätzlich' : ''}. Esc/„Auswahl“ beendet.
          </span>
        )}
      </div>

      <div className="grid-wrap" ref={wrapRef}>
        <table className={brush !== null ? 'plan fixed painting' : 'plan fixed'} style={{ minWidth: `${dims().name + span * dims().cell}rem` }}>
          <colgroup>
            <col className="namecol" />
            {days.map((d) => <col key={d} />)}
          </colgroup>
          <thead>
            <tr className="kw">
              <th className="sticky-col" />
              {days.map((d, i) =>
                weekday(d) === 1 || i === 0 ? (
                  <th key={d} colSpan={Math.min(days.length - i, i === 0 ? ((8 - weekday(d)) % 7) || 7 : 7)}>KW {isoWeek(d)}</th>
                ) : null,
              )}
            </tr>
            <tr>
              <th className="sticky-col">Mitarbeiter</th>
              {days.map((d) => {
                const h = st.holidayOn(d);
                return (
                  <th key={d} className={dayClass(d, t, h)} title={holidayTitle(h)}>
                    <button className="daylink" onClick={() => setNav({ ...nav, kind: 'day', date: d })}>
                      <span className="wd">{WEEKDAYS[weekday(d)]}</span>
                      <span className="dn">{d.slice(8)}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groups.map((g, gi) => (
              <TeamRows key={g.team.id}>
                {(gi === 0 || groups[gi - 1].team.departmentId !== g.team.departmentId) && (
                  <tr className="dept-row">
                    <th className="sticky-col">{departmentName(boot, g.team.departmentId)}</th>
                    <td colSpan={span} />
                  </tr>
                )}
                <tr className="team-row">
                  <th className="sticky-col" title={teamLabel(boot, g.team.id)}>{g.team.name}</th>
                  <td colSpan={span} />
                </tr>
                {g.employees.map((emp) => {
                  rowIndex++;
                  const ei = rowIndex;
                  const editable = canEditEmployee(boot, emp.id);
                  const self = emp.id === boot.me.employeeId;
                  return (
                    <tr key={emp.id} className={self ? 'self' : undefined}>
                      <th className="sticky-col name">
                        <button className="link" onClick={() => setNav({ ...nav, kind: 'year', employeeId: emp.id })} title="Jahreskalender">
                          {emp.lastName}, {emp.firstName}
                        </button>
                      </th>
                      {days.map((d, di) => (
                        <td
                          key={d}
                          className={`${dayClass(d, t, st.holidayOn(d))} cell${editable ? ' editable' : ''}${inSel(ei, di) ? ' sel' : ''}`}
                          onPointerDown={(e) => editable && onDown(ei, di, e)}
                          onPointerEnter={() => onEnter(ei, di)}
                          onClick={() => brush === null && setEditing({ employeeId: emp.id, date: d })}
                        >
                          <CellContent entries={st.cell(emp.id, d)} types={types} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </TeamRows>
            ))}
          </tbody>
        </table>
        {groups.length === 0 && <p className="muted center">Keine Mitarbeiter in der Auswahl.</p>}
      </div>

      <Legend />
      <EscToSelect onEsc={() => setBrush(null)} />
      {editing && <CellEditor {...editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/**
 * Inhalt einer Zelle: bis zu drei Dienste/An-/Abwesenheiten nebeneinander (bei wenig Platz untereinander, verkleinert).
 * Notizen erscheinen neben Diensten nur als Markierung in der Ecke (Text beim Darüberfahren), allein als Text.
 */
export function CellContent({ entries, types }: { entries: Entry[]; types: Map<number, EntryType> }) {
  const typed = entries.filter((e) => e.typeId || e.masked);
  const notes = entries.filter((e) => !e.typeId && !e.masked);
  if (typed.length === 0) {
    return (
      <>
        {notes.map((e) => (
          <EntryChip key={e.id} e={e} types={types} />
        ))}
      </>
    );
  }
  return (
    <>
      <div className={typed.length > 1 ? 'chips multi' : 'chips'}>
        {typed.map((e) => (
          <EntryChip key={e.id} e={e} types={types} />
        ))}
      </div>
      {notes.length > 0 && <span className="note-mark" title={notes.map((n) => n.text).join('\n')} />}
    </>
  );
}

function TeamRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function EscToSelect({ onEsc }: { onEsc: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onEsc();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onEsc]);
  return null;
}

export function dayClass(d: string, t: string, holiday?: Holiday): string {
  return [isWeekend(d) ? 'we' : '', holiday ? (holiday.kind === 'company' ? 'hol free' : 'hol') : '', d === t ? 'today' : '']
    .filter(Boolean)
    .join(' ');
}

export function holidayTitle(h?: Holiday): string | undefined {
  return h ? `${h.name} (${h.kind === 'company' ? 'arbeitsfrei' : 'Feiertag'})` : undefined;
}

export function Legend() {
  const { boot } = useStore();
  return (
    <div className="legend">
      <span><span className="swatch hol" /> Feiertag</span>
      <span><span className="swatch hol free" /> arbeitsfreier Tag</span>
      <span><span className="swatch note-swatch" /> Notiz</span>
      {boot!.entryTypes
        .filter((t) => t.active)
        .map((t) => (
          <span key={t.id}>
            <span className="chip" style={{ background: t.color, color: t.textColor }}>{t.code}</span> {t.name}
            {t.startTime ? ` ${t.startTime}–${t.endTime}` : ''}
          </span>
        ))}
    </div>
  );
}
