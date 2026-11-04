import { useEffect, useState } from 'react';
import type { NavState } from '../App';
import { store, useStore } from '../store';
import { MONTHS, WEEKDAYS, daysInMonth, isWeekend, iso, today, weekday } from '../dates';
import { fullName, reportError, sortedTeams, teamLabel, typeMap } from '../helpers';
import { EntryChip } from '../components/EntryChip';
import { CellEditor } from '../components/CellEditor';
import { dayClass, holidayTitle } from './MonthView';

/** Jahreskalender pro Mitarbeiter: 12 Zeilen (Monate) × 31 Spalten (Tage) plus Auswertung. */
export function YearView({ nav, setNav }: { nav: NavState; setNav: (n: NavState) => void }) {
  const st = useStore();
  const boot = st.boot!;
  const types = typeMap(boot);
  const year = Number(nav.date.slice(0, 4));
  const empId = nav.employeeId ?? boot.me.employeeId ?? boot.employees[0]?.id;
  const emp = boot.employees.find((e) => e.id === empId);
  const [editing, setEditing] = useState<string | null>(null);
  const t = today();

  useEffect(() => {
    if (empId) store.loadRange(`${year}-01-01`, `${year}-12-31`, empId).catch(reportError);
    void store.loadHolidays(year);
  }, [year, empId]);

  if (!emp) return <p className="muted center">Kein Mitarbeiter ausgewählt.</p>;

  // Auswertung je Eintragsart
  const counts = new Map<number, number>();
  let vacationWorkdays = 0;
  for (let m = 0; m < 12; m++) {
    for (let d = 1; d <= daysInMonth(year, m); d++) {
      const date = iso(new Date(Date.UTC(year, m, d)));
      for (const e of st.cell(emp.id, date)) {
        if (!e.typeId) continue;
        counts.set(e.typeId, (counts.get(e.typeId) ?? 0) + 1);
        if (types.get(e.typeId)?.countsAsVacation && !isWeekend(date) && !st.holidayOn(date)) vacationWorkdays++;
      }
    }
  }

  const teams = sortedTeams(boot, (tm) => boot.employees.some((e) => e.teamId === tm.id && e.active));
  return (
    <div className="year">
      <div className="toolbar">
        <button onClick={() => setNav({ ...nav, date: `${year - 1}-01-01` })} aria-label="Vorjahr">◀</button>
        <button onClick={() => setNav({ ...nav, date: t })}>Aktuelles Jahr</button>
        <button onClick={() => setNav({ ...nav, date: `${year + 1}-01-01` })} aria-label="Folgejahr">▶</button>
        <h1>{year}</h1>
        <select value={emp.id} onChange={(e) => setNav({ ...nav, employeeId: Number(e.target.value) })}>
          {teams.map((tm) => (
            <optgroup key={tm.id} label={teamLabel(boot, tm.id)}>
              {boot.employees
                .filter((e) => e.teamId === tm.id && e.active)
                .map((e) => (
                  <option key={e.id} value={e.id}>{fullName(e)}</option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="grid-wrap">
        <table className="plan yeargrid">
          <thead>
            <tr>
              <th className="sticky-col">Monat</th>
              {Array.from({ length: 31 }, (_, i) => <th key={i}>{i + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((name, m) => (
              <tr key={m}>
                <th className="sticky-col">{name}</th>
                {Array.from({ length: 31 }, (_, i) => {
                  if (i + 1 > daysInMonth(year, m)) return <td key={i} className="void" />;
                  const date = iso(new Date(Date.UTC(year, m, i + 1)));
                  const h = st.holidayOn(date);
                  return (
                    <td key={i} className={`${dayClass(date, t, h)} cell editable`} title={`${WEEKDAYS[weekday(date)]}${h ? ' · ' + holidayTitle(h) : ''}`} onClick={() => setEditing(date)}>
                      {st.cell(emp.id, date).map((e) => <EntryChip key={e.id} e={e} types={types} />)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="summary">
        <div className="card">
          <h3>Urlaub {year}</h3>
          <p>
            <strong>{vacationWorkdays}</strong> von {emp.vacationDaysPerYear} Tagen verplant · Rest{' '}
            <strong>{emp.vacationDaysPerYear - vacationWorkdays}</strong>
          </p>
          <p className="muted small">gezählt werden Urlaubstage an Werktagen ohne Feiertage</p>
        </div>
        <div className="card">
          <h3>Übersicht</h3>
          <div className="legend">
            {boot.entryTypes
              .filter((ty) => counts.has(ty.id))
              .map((ty) => (
                <span key={ty.id}>
                  <EntryChip e={{ id: 0, employeeId: 0, date: '', typeId: ty.id, text: null, startTime: null, endTime: null, version: 0, updatedBy: null, updatedAt: '' }} types={types} /> {ty.name}: <strong>{counts.get(ty.id)}</strong>
                </span>
              ))}
            {counts.size === 0 && <span className="muted">keine Einträge</span>}
          </div>
        </div>
      </div>
      {editing && <CellEditor employeeId={emp.id} date={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
