import { useEffect, useState } from 'react';
import type { NavState } from '../App';
import { store, useStore } from '../store';
import { addDays, fmtLong, today } from '../dates';
import { canEditEmployee, groupedEmployees, reportError, teamLabel, typeMap } from '../helpers';
import type { Employee, Entry, EntryType } from '../types';
import { EntryChip } from '../components/EntryChip';
import { CellEditor } from '../components/CellEditor';

/** Tagesübersicht: Wer hat welchen Dienst? Wer ist nicht da? */
export function DayView({ nav, setNav }: { nav: NavState; setNav: (n: NavState) => void }) {
  const st = useStore();
  const boot = st.boot!;
  const types = typeMap(boot);
  const date = nav.date;
  const [editing, setEditing] = useState<number | null>(null);

  useEffect(() => {
    store.loadRange(date, date).catch(reportError);
  }, [date]);

  const groups = groupedEmployees(boot, nav.teamIds);
  const teamName = new Map(boot.teams.map((t) => [t.id, teamLabel(boot, t.id)]));
  const holiday = st.holidayOn(date);

  // Pro Eintragsart sammeln
  const byType = new Map<number, { emp: Employee; e: Entry }[]>();
  const masked: { emp: Employee; e: Entry }[] = [];
  const notes: { emp: Employee; e: Entry }[] = [];
  const without: Employee[] = [];
  for (const g of groups) {
    for (const emp of g.employees) {
      const entries = st.cell(emp.id, date);
      if (entries.length === 0) without.push(emp);
      for (const e of entries) {
        if (e.typeId) byType.set(e.typeId, [...(byType.get(e.typeId) ?? []), { emp, e }]);
        else if (e.masked) masked.push({ emp, e });
        else notes.push({ emp, e });
      }
    }
  }

  const section = (cat: EntryType['category'], title: string) => {
    const list = boot.entryTypes.filter((t) => t.category === cat && byType.has(t.id));
    const extra = cat === 'absence' ? masked : [];
    const total = list.reduce((n, t) => n + byType.get(t.id)!.length, 0) + extra.length;
    return (
      <section className="day-section">
        <h2>
          {title} <span className="count">{total}</span>
        </h2>
        {total === 0 && <p className="muted small">–</p>}
        {list.map((t) => (
          <div key={t.id} className="day-group">
            <div className="day-type">
              <span className="chip" style={{ background: t.color, color: t.textColor }}>{t.code}</span> {t.name}
              {t.startTime && <span className="muted small"> {t.startTime}–{t.endTime}</span>}
            </div>
            <ul>
              {byType.get(t.id)!.map(({ emp, e }) => (
                <Person key={e.id} emp={emp} team={teamName.get(emp.teamId)} e={e} onOpen={() => setEditing(emp.id)} />
              ))}
            </ul>
          </div>
        ))}
        {extra.length > 0 && (
          <div className="day-group">
            <div className="day-type"><span className="chip masked">–</span> abwesend (ohne Details)</div>
            <ul>
              {extra.map(({ emp, e }) => (
                <Person key={e.id} emp={emp} team={teamName.get(emp.teamId)} onOpen={() => setEditing(emp.id)} />
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="day">
      <div className="toolbar">
        <button onClick={() => setNav({ ...nav, date: addDays(date, -1) })} aria-label="Vortag">◀</button>
        <button onClick={() => setNav({ ...nav, date: today() })}>Heute</button>
        <button onClick={() => setNav({ ...nav, date: addDays(date, 1) })} aria-label="Folgetag">▶</button>
        <input type="date" value={date} onChange={(e) => e.target.value && setNav({ ...nav, date: e.target.value })} />
        <h1>{fmtLong(date)}</h1>
        {holiday && <span className="badge">{holiday.name}</span>}
      </div>
      <div className="day-columns">
        {section('shift', 'Im Dienst')}
        {section('presence', 'Sonstige Anwesenheit')}
        {section('absence', 'Abwesend')}
        <section className="day-section">
          <h2>Notizen <span className="count">{notes.length}</span></h2>
          {notes.length === 0 && <p className="muted small">–</p>}
          <ul>
            {notes.map(({ emp, e }) => (
              <Person key={e.id} emp={emp} team={teamName.get(emp.teamId)} e={e} onOpen={() => setEditing(emp.id)} types={types} />
            ))}
          </ul>
          <h2>Ohne Eintrag <span className="count">{without.length}</span></h2>
          <ul>
            {without.map((emp) => (
              <Person key={emp.id} emp={emp} team={teamName.get(emp.teamId)} onOpen={() => setEditing(emp.id)} />
            ))}
          </ul>
        </section>
      </div>
      {editing !== null && <CellEditor employeeId={editing} date={date} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Person({ emp, team, e, onOpen, types }: { emp: Employee; team?: string; e?: Entry; onOpen: () => void; types?: Map<number, EntryType> }) {
  const { boot } = useStore();
  const time = e && (e.startTime || e.endTime) ? `${e.startTime ?? ''}–${e.endTime ?? ''}` : '';
  return (
    <li>
      <button className="link" onClick={onOpen} disabled={!canEditEmployee(boot!, emp.id) && !e}>
        {emp.lastName}, {emp.firstName}
      </button>
      <span className="muted small"> · {team}</span>
      {time && <span className="small"> · {time}</span>}
      {e?.text && !e.masked && (types ? <> · <EntryChip e={e} types={types} /></> : <span className="small"> · {e.text}</span>)}
    </li>
  );
}
