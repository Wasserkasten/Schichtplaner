import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../api';
import { useStore } from '../store';
import { reportError } from '../helpers';
import { buildGroups, detail, type Row } from '../views/AuditLog';
import { Modal } from './Modal';

interface Page { rows: Row[]; undone: string[]; nextBeforeId: number | null; seenId: number | null; hasEmployee: boolean }

/** Benutzermenü → „Änderungen an meinem Plan“: wer hat wann was an den eigenen Einträgen geändert. */
export function MyChangesDialog({ onClose, onSeen }: { onClose: () => void; onSeen: () => void }) {
  const st = useStore();
  const boot = st.boot!;
  const me = boot.me;
  const [rows, setRows] = useState<Row[]>([]);
  const [undone, setUndone] = useState<Set<string>>(new Set());
  const [next, setNext] = useState<number | null>(null);
  const [seenId, setSeenId] = useState<number | null>(null);
  const [hasEmployee, setHasEmployee] = useState(true);
  const [onlyOthers, setOnlyOthers] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  async function load(beforeId?: number) {
    setLoading(true);
    try {
      const p = await get<Page>(`/api/me/changes?limit=200${beforeId ? `&beforeId=${beforeId}` : ''}`);
      setRows((r) => (beforeId ? [...r, ...p.rows] : p.rows));
      setUndone((u) => new Set([...(beforeId ? u : []), ...p.undone]));
      setNext(p.nextBeforeId);
      setHasEmployee(p.hasEmployee);
      if (!beforeId) {
        setSeenId(p.seenId); // „neu“ bezieht sich auf den Stand vor dem Öffnen
        await post('/api/me/changes/seen');
        onSeen();
      }
    } catch (e) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => void load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => buildGroups(boot, rows), [boot, rows]);
  const shown = groups.filter((g) => !onlyOthers || g.first.user_id !== me.id);
  const isNew = (r: Row) => seenId != null && r.id > seenId && r.user_id !== me.id;

  return (
    <Modal title="Änderungen an meinem Plan" onClose={onClose} wide>
      {!hasEmployee ? (
        <p className="muted">Mit deinem Konto ist kein Mitarbeiter verknüpft – daher gibt es keinen eigenen Plan.</p>
      ) : (
        <>
          <div className="toolbar">
            <label className="inline"><input type="checkbox" checked={onlyOthers} onChange={(e) => setOnlyOthers(e.target.checked)} /> nur Änderungen durch andere</label>
          </div>
          <table className="simple">
            <thead><tr><th style={{ width: 130 }}>Zeitpunkt</th><th style={{ width: 160 }}>Von</th><th>Änderung</th></tr></thead>
            <tbody>
              {shown.map((g) => {
                const fresh = g.rows.some(isNew);
                return (
                  <tr key={g.key} className={g.first.change_id && undone.has(g.first.change_id) ? 'inactive-soft' : fresh ? 'fresh' : ''}>
                    <td>{new Date(g.first.ts).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td>{g.first.user_id === me.id ? <span className="muted">dir selbst</span> : g.first.user_name ?? '–'}</td>
                    <td>
                      {g.text}
                      {fresh && <span className="badge"> neu</span>}
                      {g.first.change_id && undone.has(g.first.change_id) && <span className="badge light"> zurückgenommen</span>}
                      {g.rows.length > 1 && (
                        <button className="link small details-toggle" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}>
                          {open.has(g.key) ? '▾' : '▸'} {g.rows.length} Einzeländerungen
                        </button>
                      )}
                      {open.has(g.key) && (
                        <ul className="small audit-details">{g.rows.map((r) => <li key={r.id}>{detail(boot, r)}</li>)}</ul>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && shown.length === 0 && <tr><td colSpan={3} className="muted">Keine Änderungen.</td></tr>}
            </tbody>
          </table>
          {next && <div className="actions"><button disabled={loading} onClick={() => void load(next)}>Ältere laden</button></div>}
        </>
      )}
    </Modal>
  );
}
