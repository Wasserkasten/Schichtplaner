/**
 * Jahresübersicht als PDF (A4 quer, eine Seite je Mitarbeiter).
 * Zeigt genau das, was der anfragende Benutzer auch im Browser sehen darf (vertrauliche Arten maskiert).
 */
import PDFDocument from 'pdfkit';
import type { DB } from './db.js';
import { EntryContext, type EntryDTO, type EntryRow } from './entries.js';
import type { Permissions } from './permissions.js';
import { listHolidays, type HolidayRow } from './holiday-store.js';
import { APP_VERSION } from './version.js';

interface EmployeeRow {
  id: number;
  team_id: number;
  first_name: string;
  last_name: string;
  vacation_days_per_year: number;
  team_name: string;
  department_name: string;
}
interface TypeRow {
  id: number;
  code: string;
  name: string;
  color: string;
  text_color: string;
  counts_as_vacation: number;
  sort_order: number;
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const C = {
  line: '#c8ced6',
  text: '#1d2733',
  muted: '#6b7785',
  weekend: '#eef1f5',
  holiday: '#fdeedd',
  free: '#e6f2e3',
  void: '#f4f5f7',
  masked: '#d9dee5',
  note: '#e0a800',
  accent: '#1f4e79',
};

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const weekday = (date: string) => new Date(date + 'T00:00:00Z').getUTCDay();

export function loadEmployees(db: DB, ids: number[]): EmployeeRow[] {
  if (ids.length === 0) return [];
  return db
    .prepare(
      `SELECT e.id, e.team_id, e.first_name, e.last_name, e.vacation_days_per_year, t.name AS team_name, d.name AS department_name
       FROM employees e JOIN teams t ON t.id = e.team_id JOIN departments d ON d.id = t.department_id
       WHERE e.id IN (${ids.map(() => '?').join(',')}) ORDER BY e.sort_order, e.last_name, e.first_name`,
    )
    .all(...ids) as EmployeeRow[];
}

export function yearPdf(
  db: DB,
  perms: Permissions,
  opts: { employees: EmployeeRow[]; year: number; createdBy: string },
): Promise<Buffer> {
  const { year } = opts;
  const types = db.prepare('SELECT * FROM entry_types ORDER BY sort_order, name').all() as TypeRow[];
  const typeById = new Map(types.map((t) => [t.id, t]));
  const holidays = new Map(listHolidays(db, year).map((h) => [h.date, h] as [string, HolidayRow]));
  const ec = new EntryContext(db);

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 28, left: 28, right: 28, bottom: 8 }, info: { Title: `Jahresübersicht ${year}`, Creator: `Schichtplaner ${APP_VERSION}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const pageW = doc.page.width;
  const m = 28;
  const labelW = 62;
  const colW = (pageW - 2 * m - labelW) / 31;
  const headH = 15;
  const rowH = 34;
  const created = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });

  opts.employees.forEach((emp, idx) => {
    if (idx > 0) doc.addPage();
    const rows = db
      .prepare("SELECT * FROM entries WHERE employee_id = ? AND date LIKE ? ORDER BY date, id")
      .all(emp.id, `${year}-%`) as EntryRow[];
    const byDate = new Map<string, EntryDTO[]>();
    for (const r of rows) {
      const dto = ec.present(r, perms);
      if (!dto) continue;
      byDate.set(dto.date, [...(byDate.get(dto.date) ?? []), dto]);
    }

    // Auswertung
    const counts = new Map<number, number>();
    let vacation = 0;
    for (const [date, list] of byDate) {
      for (const e of list) {
        if (!e.typeId) continue;
        counts.set(e.typeId, (counts.get(e.typeId) ?? 0) + 1);
        const wd = weekday(date);
        if (typeById.get(e.typeId)?.counts_as_vacation && wd !== 0 && wd !== 6 && !holidays.has(date)) vacation++;
      }
    }

    // Kopf
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(16).text(`Jahresübersicht ${year}`, m, m, { lineBreak: false });
    doc.font('Helvetica').fontSize(11).fillColor(C.text)
      .text(`${emp.last_name}, ${emp.first_name}`, m, m + 21, { lineBreak: false })
      .fillColor(C.muted).text(`   ${emp.department_name} · ${emp.team_name}`, { lineBreak: false });
    const vac = `Urlaub: ${vacation} von ${emp.vacation_days_per_year} Tagen verplant · Rest ${emp.vacation_days_per_year - vacation}`;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.text).text(vac, m, m + 4, { width: pageW - 2 * m, align: 'right', lineBreak: false });

    // Raster
    const top = m + 44;
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.muted);
    for (let d = 1; d <= 31; d++) {
      doc.text(String(d), m + labelW + (d - 1) * colW, top + 4, { width: colW, align: 'center', lineBreak: false });
    }
    for (let mo = 0; mo < 12; mo++) {
      const y = top + headH + mo * rowH;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.text).text(MONTHS[mo], m + 2, y + rowH / 2 - 4, { width: labelW - 4, lineBreak: false });
      for (let d = 1; d <= 31; d++) {
        const x = m + labelW + (d - 1) * colW;
        if (d > daysIn(year, mo)) {
          doc.rect(x, y, colW, rowH).fill(C.void);
          continue;
        }
        const date = iso(year, mo, d);
        const wd = weekday(date);
        const h = holidays.get(date);
        const bg = h ? (h.kind === 'company' ? C.free : C.holiday) : wd === 0 || wd === 6 ? C.weekend : null;
        if (bg) doc.rect(x, y, colW, rowH).fill(bg);
        doc.font('Helvetica').fontSize(4.5).fillColor(C.muted).text(WD[wd], x + 1.2, y + 1.2, { lineBreak: false });

        const list = byDate.get(date) ?? [];
        const typed = list.filter((e) => e.typeId || e.masked).slice(0, 3);
        const notes = list.filter((e) => !e.typeId && !e.masked);
        if (typed.length) {
          const areaTop = y + 7;
          const areaH = rowH - 9;
          const boxH = Math.min(11, (areaH - (typed.length - 1)) / typed.length);
          const startY = areaTop + (areaH - (boxH * typed.length + (typed.length - 1))) / 2;
          typed.forEach((e, i) => {
            const t = e.typeId ? typeById.get(e.typeId) : undefined;
            const code = t ? t.code : 'abw';
            const by = startY + i * (boxH + 1);
            doc.roundedRect(x + 1.5, by, colW - 3, boxH, 1.5).fill(t ? t.color : C.masked);
            let fs = typed.length === 1 ? 7 : 5.8;
            doc.font('Helvetica-Bold');
            while (fs > 4 && doc.fontSize(fs).widthOfString(code) > colW - 4) fs -= 0.5;
            doc.fillColor(t ? t.text_color : C.muted).fontSize(fs).text(code, x + 1.5, by + (boxH - fs) / 2 + 0.6, { width: colW - 3, align: 'center', lineBreak: false });
          });
        } else if (notes.length) {
          doc.font('Helvetica-Oblique').fontSize(4.8).fillColor(C.text)
            .text(notes[0].text ?? '', x + 1, y + 8, { width: colW - 2, height: rowH - 9, ellipsis: true });
        }
        if (notes.length && typed.length) {
          doc.polygon([x + colW - 5, y], [x + colW, y], [x + colW, y + 5]).fill(C.note);
        }
      }
    }
    // Gitterlinien
    doc.lineWidth(0.4).strokeColor(C.line);
    const gridBottom = top + headH + 12 * rowH;
    for (let r = 0; r <= 12; r++) doc.moveTo(m, top + headH + r * rowH).lineTo(pageW - m, top + headH + r * rowH).stroke();
    for (let c = 0; c <= 31; c++) doc.moveTo(m + labelW + c * colW, top).lineTo(m + labelW + c * colW, gridBottom).stroke();
    doc.moveTo(m, top).lineTo(m, gridBottom).stroke();
    doc.moveTo(m, top).lineTo(pageW - m, top).stroke();

    // Auswertung und Legende
    let ly = gridBottom + 10;
    let lx = m;
    const legend = (fill: string, label: string, textColor?: string, code?: string) => {
      const w = code ? Math.max(14, doc.font('Helvetica-Bold').fontSize(6.5).widthOfString(code) + 5) : 9;
      const labelW2 = doc.font('Helvetica').fontSize(7.5).widthOfString(label);
      if (lx + w + 4 + labelW2 > pageW - m) {
        lx = m;
        ly += 13;
      }
      doc.roundedRect(lx, ly, w, 9, 1.5).fill(fill);
      if (code) doc.font('Helvetica-Bold').fontSize(6.5).fillColor(textColor ?? C.text).text(code, lx, ly + 1.6, { width: w, align: 'center', lineBreak: false });
      doc.font('Helvetica').fontSize(7.5).fillColor(C.text).text(label, lx + w + 3, ly + 1.2, { lineBreak: false });
      lx += w + 3 + labelW2 + 12;
    };
    for (const t of types.filter((tt) => counts.has(tt.id))) legend(t.color, `${t.name}: ${counts.get(t.id)}`, t.text_color, t.code);
    legend(C.holiday, 'Feiertag');
    legend(C.free, 'arbeitsfreier Tag');
    legend(C.weekend, 'Wochenende');
    if (rows.some((r) => !r.type_id)) legend(C.note, 'Notiz (neben Diensten als Ecke)');

    // Fuß
    doc.font('Helvetica').fontSize(7).fillColor(C.muted).text(
      `Erstellt am ${created} von ${opts.createdBy} · Schichtplaner ${APP_VERSION}${opts.employees.length > 1 ? ` · Seite ${idx + 1} von ${opts.employees.length}` : ''}`,
      m, doc.page.height - m - 8, { width: pageW - 2 * m, align: 'right', lineBreak: false },
    );
  });

  if (opts.employees.length === 0) doc.font('Helvetica').fontSize(12).text('Keine Mitarbeiter.');
  doc.end();
  return done;
}
