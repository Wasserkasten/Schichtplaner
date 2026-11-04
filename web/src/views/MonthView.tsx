import { useEffect, useMemo, useRef, useState } from 'react';
import type { NavState } from '../App';
import { post } from '../api';
import { store, useStore } from '../store';
import { MONTHS, WEEKDAYS, addDays, addMonths, daysInMonth, isWeekend, isoWeek, monthStart, parse, range, today, weekday } from '../dates';
import { canEditEmployee, departmentName, groupedEmployees, reportError, teamLabel, typeMap } from '../helpers';
import type { Entry } from '../types';
import { EntryChip } from '../components/EntryChip';
import { CellEditor } from '../components/CellEditor';

/** Pinsel: null = Auswahlmodus (Dialog), 'clear' = Radierer, Zahl = Eintragsart */
type Brush = null | 'clear' | number;

interface Sel { emp0: number; emp1: number; d0: number; d1: number }

export function MonthView({ nav, setNav }: { nav: NavState; setNav: (n: NavState) => void }) {
  const st = useStore();
  const boot = st.boot!;
  const types = typeMap(boot);
  const groups = groupedEmployees(boot, nav.teamIds);
  const flat = groups.flatMap((g) => g.employees);

  // Zeitraum: ganzer Monat oder N Tage ab Bezugsdatum
  const from = nav.days ? nav.date : monthStart(nav.date);
  const count = nav.days || daysInMonth(parse(from).getUTCFullYear(), parse(from).getUTCMonth());
  const days = useMemo(() => range(from, count), [from, count]);
  const to = days[days.length - 1];
  const t = today();

  useEffect(() => {
    store.loadRange(from, to).catch(reportError);
  }, [from, to]);

  const [brush, setBrush] = useState<Brush>(null);
  const [editing, setEditing] = useState<{ employeeId: number; date: string } | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const dragging = useRef(false);

  const step = (dir: number) =>
    setNav({ ...nav, date: nav.days ? addDays(nav.date, dir * nav.days) : addMonths(monthStart(nav.date), dir) });

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
      const res = await post<{ created: Entry[]; deleted: number[] }>('/api/entries/bulk', {
        action: brush === 'clear' ? 'clear' : 'set',
        typeId: brush === 'clear' ? undefined : brush,
        cells,
      });
      store.remove(res.deleted);
      store.upsert(res.created);
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
    setSel({ emp0: ei, emp1: ei, d0: di, d1: di });
  };
  const onEnter = (ei: number, di: number) => {
    if (dragging.current) setSel((s) => (s ? { ...s, emp1: ei, d1: di } : s));
  };

  // Tägliche Besetzung (Anzahl Dienste) je Team
  const coverage = (empIds: number[], date: string) =>
    empIds.filter((id) => st.cell(id, date).some((e) => e.typeId && types.get(e.typeId)?.category === 'shift')).length;

  const title = nav.days
    ? `${from.split('-').reverse().join('.')} – ${to.split('-').reverse().join('.')}`
    : `${MONTHS[parse(from).getUTCMonth()]} ${parse(from).getUTCFullYear()}`;
  let rowIndex = -1;

  return (
    <div className="month">
      <div className="toolbar">
        <button onClick={() => step(-1)} aria-label="zurück">◀</button>
        <button onClick={() => setNav({ ...nav, date: today() })}>Heute</button>
        <button onClick={() => step(1)} aria-label="vor">▶</button>
        <h1>{title}</h1>
        <select value={nav.days} onChange={(e) => setNav({ ...nav, days: Number(e.target.value), date: Number(e.target.value) ? (nav.days ? nav.date : t) : nav.date })}>
          <option value={0}>Monat</option>
          <option value={7}>7 Tage</option>
          <option value={14}>14 Tage</option>
          <option value={28}>4 Wochen</option>
          <option value={42}>6 Wochen</option>
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
        {brush !== null && <span className="muted small">Pinsel aktiv: Zellen anklicken oder ziehen. Esc/„Auswahl“ beendet.</span>}
      </div>

      <div className="grid-wrap">
        <table className={brush !== null ? 'plan painting' : 'plan'}>
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
                  <th key={d} className={dayClass(d, t, !!h)} title={h?.name}>
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
                    <td colSpan={days.length} />
                  </tr>
                )}
                <tr className="team-row">
                  <th className="sticky-col" title={teamLabel(boot, g.team.id)}>{g.team.name}</th>
                  {days.map((d) => (
                    <td key={d} className={dayClass(d, t, !!st.holidayOn(d))} title="Besetzung (Dienste)">
                      {coverage(g.employees.map((e) => e.id), d) || ''}
                    </td>
                  ))}
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
                      {days.map((d, di) => {
                        const entries = st.cell(emp.id, d);
                        return (
                          <td
                            key={d}
                            className={`${dayClass(d, t, !!st.holidayOn(d))} cell${editable ? ' editable' : ''}${inSel(ei, di) ? ' sel' : ''}`}
                            onPointerDown={(e) => editable && onDown(ei, di, e)}
                            onPointerEnter={() => onEnter(ei, di)}
                            onClick={() => brush === null && setEditing({ employeeId: emp.id, date: d })}
                          >
                            {entries.map((e) => (
                              <EntryChip key={e.id} e={e} types={types} />
                            ))}
                          </td>
                        );
                      })}
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

export function dayClass(d: string, t: string, holiday: boolean): string {
  return [isWeekend(d) ? 'we' : '', holiday ? 'hol' : '', d === t ? 'today' : ''].filter(Boolean).join(' ');
}

export function Legend() {
  const { boot } = useStore();
  return (
    <div className="legend">
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
