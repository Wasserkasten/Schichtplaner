import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, requireUser, type AppContext } from '../app.js';
import { loadEmployees, yearPdf } from '../pdf.js';

/**
 * Nur ASCII-Dateiname: Mit zusätzlichem `filename*=UTF-8''…` (Umlaute) verwerfen manche Chromium-Versionen
 * den Namen komplett und speichern als „download“.
 */
function disposition(name: string): string {
  const ascii = name.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss').replace(/[^\w.-]+/g, '_');
  return `attachment; filename="${ascii}"`;
}

export async function pdfRoutes(app: FastifyInstance, { db }: AppContext) {
  /** Jahresübersicht als PDF – für einen Mitarbeiter oder alle aktiven Mitarbeiter eines Teams (eine Seite je Person). */
  app.get('/api/pdf/year', async (req, reply) => {
    const { user, perms } = requireUser(req);
    const q = z
      .object({
        year: z.coerce.number().int().min(1990).max(2100),
        employeeId: z.coerce.number().int().optional(),
        teamId: z.coerce.number().int().optional(),
      })
      .refine((v) => (v.employeeId === undefined) !== (v.teamId === undefined), 'Mitarbeiter oder Team angeben')
      .parse(req.query);

    let ids: number[];
    if (q.employeeId !== undefined) {
      const e = db.prepare('SELECT team_id FROM employees WHERE id = ?').get(q.employeeId) as { team_id: number } | undefined;
      if (!e) throw new HttpError(404, 'Mitarbeiter nicht gefunden');
      if (!perms.can(e.team_id, 'view')) throw new HttpError(403, 'Keine Berechtigung');
      ids = [q.employeeId];
    } else {
      if (!perms.can(q.teamId!, 'view')) throw new HttpError(403, 'Keine Berechtigung');
      ids = (db.prepare('SELECT id FROM employees WHERE team_id = ? AND active = 1').all(q.teamId) as { id: number }[]).map((r) => r.id);
    }
    const employees = loadEmployees(db, ids);
    const pdf = await yearPdf(db, perms, { employees, year: q.year, createdBy: user.display_name });
    const name =
      employees.length === 1
        ? `Jahresübersicht ${q.year} ${employees[0].last_name} ${employees[0].first_name}.pdf`
        : `Jahresübersicht ${q.year} ${employees[0]?.department_name ?? ''} ${employees[0]?.team_name ?? 'Team'}.pdf`;
    return reply.type('application/pdf').header('Content-Disposition', disposition(name)).header('Cache-Control', 'no-store').send(pdf);
  });
}
