import { useEffect, useRef, useState } from 'react';
import { ApiError, del, get, post, put } from '../api';
import { store } from '../store';
import { reportError } from '../helpers';
import { WEEKDAYS_LONG } from '../dates';
import { Modal } from '../components/Modal';

type Kind = 'auto' | 'manual' | 'safety' | 'upload';
interface Schedule { mode: 'off' | 'hourly' | 'daily' | 'weekly'; time: string; weekday: number; keep: number; extraDir: string }
interface Last { at: string; ok: boolean; file?: string; error?: string; extraError?: string }
interface BackupFile { name: string; kind: Kind; size: number; createdAt: string }
interface Overview { dir: string; schedule: Schedule; last: Last | null; next: string | null; files: BackupFile[] }

const KIND: Record<Kind, [string, string]> = {
  auto: ['automatisch', 'Nach Zeitplan angelegt. Es werden nur die neuesten (siehe „Aufbewahren“) behalten.'],
  manual: ['von Hand', 'Über „Jetzt sichern“ angelegt. Bleibt, bis sie gelöscht wird.'],
  safety: ['vor Einspielen', 'Automatisch angelegt, bevor eine Sicherung eingespielt wurde – damit lässt sich das Einspielen rückgängig machen.'],
  upload: ['hochgeladen', 'Von einem anderen Rechner oder Server hochgeladen.'],
};

const dt = (iso: string) => new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);

function describe(s: Schedule): string {
  switch (s.mode) {
    case 'off': return 'keine automatischen Sicherungen';
    case 'hourly': return `stündlich zur Minute ${s.time.slice(3)}`;
    case 'daily': return `täglich um ${s.time} Uhr`;
    case 'weekly': return `jeden ${WEEKDAYS_LONG[s.weekday]} um ${s.time} Uhr`;
  }
}

/** Verwaltung → Backups */
export function BackupAdmin() {
  const [o, setO] = useState<Overview | null>(null);
  const [form, setForm] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState('');
  const [restore, setRestore] = useState<BackupFile | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = () =>
    get<Overview>('/api/admin/backups').then((r) => {
      setO(r);
      setForm((f) => f ?? r.schedule);
    }, reportError);
  useEffect(() => void load(), []);

  if (!o || !form) return <p className="muted">Lade …</p>;
  const dirty = JSON.stringify(form) !== JSON.stringify(o.schedule);

  async function saveSchedule() {
    try {
      await put('/api/admin/backups/schedule', form);
      store.toast(`Zeitplan gespeichert: ${describe(form!)}`);
      setForm(null);
      void load();
    } catch (e) {
      reportError(e);
    }
  }

  async function backupNow() {
    setBusy('now');
    try {
      const r = await post<{ name: string; last: Last }>('/api/admin/backups');
      store.toast(r.last.extraError ? `Gesichert, aber: ${r.last.extraError}` : `Gesichert: ${r.name}`);
      void load();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy('');
    }
  }

  async function remove(f: BackupFile) {
    if (!confirm(`Sicherung „${f.name}“ (${dt(f.createdAt)}) endgültig löschen?`)) return;
    try {
      await del(`/api/admin/backups/${encodeURIComponent(f.name)}`);
      void load();
    } catch (e) {
      reportError(e);
    }
  }

  async function upload(file: File) {
    setBusy('upload');
    try {
      const res = await fetch('/api/admin/backups/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const data = (await res.json().catch(() => ({}))) as { name?: string; error?: string };
      if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText);
      store.toast(`Hochgeladen und geprüft: ${data.name}. Zum Einspielen in der Liste auf ↺ klicken.`);
      void load();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy('');
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const set = (p: Partial<Schedule>) => setForm({ ...form, ...p });

  return (
    <div className="backups">
      <div className="card status-card">
        <div className="row">
          <strong>Zeitplan:</strong> {describe(o.schedule)}
          {o.next && <span className="muted">· nächste Sicherung {dt(o.next)}</span>}
        </div>
        <div className="row">
          <strong>Letzte automatische/manuelle Sicherung:</strong>
          {!o.last ? <span className="muted">noch keine</span>
            : o.last.ok ? <span>{dt(o.last.at)} <span className="ok">✓</span></span>
            : <span className="error">{dt(o.last.at)} – fehlgeschlagen: {o.last.error}</span>}
        </div>
        {o.last?.extraError && <p className="warn small">{o.last.extraError}</p>}
        <div className="row muted small">Ordner auf dem Server: <code>{o.dir}</code></div>
        <div className="row">
          <button className="primary" disabled={!!busy} onClick={() => void backupNow()}>{busy === 'now' ? 'Sichere …' : 'Jetzt sichern'}</button>
          <button disabled={!!busy} onClick={() => fileInput.current?.click()}>{busy === 'upload' ? 'Lade hoch …' : 'Sicherung hochladen …'}</button>
          <input ref={fileInput} type="file" accept=".db,.sqlite,.sqlite3,application/octet-stream" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        </div>
      </div>

      <div className="card form narrow">
        <h3>Automatische Sicherung</h3>
        <div className="seg" role="radiogroup" aria-label="Häufigkeit">
          {([['off', 'Aus'], ['hourly', 'Stündlich'], ['daily', 'Täglich'], ['weekly', 'Wöchentlich']] as const).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={form.mode === k} className={form.mode === k ? 'active' : ''} onClick={() => set({ mode: k })}>{l}</button>
          ))}
        </div>
        {form.mode !== 'off' && (
          <div className="grid2">
            {form.mode === 'weekly' && (
              <label>Wochentag
                <select value={form.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{WEEKDAYS_LONG[d]}</option>)}
                </select>
              </label>
            )}
            {form.mode === 'hourly' ? (
              <label>Minute
                <select value={form.time.slice(3)} onChange={(e) => set({ time: `00:${e.target.value}` })}>
                  {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map((m) => <option key={m} value={m}>:{m}</option>)}
                </select>
              </label>
            ) : (
              <label>Uhrzeit<input type="time" value={form.time} onChange={(e) => e.target.value && set({ time: e.target.value })} /></label>
            )}
            <label>Aufbewahren (Anzahl)
              <input type="number" min={1} max={365} value={form.keep} onChange={(e) => set({ keep: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })} />
            </label>
          </div>
        )}
        <label>Zusätzlicher Speicherort (optional)
          <input value={form.extraDir} placeholder="z. B. /mnt/nas/schichtplaner" onChange={(e) => set({ extraDir: e.target.value })} />
          <span className="muted small">
            Jede Sicherung wird zusätzlich dorthin kopiert – am besten ein anderes Laufwerk oder ein NAS, damit bei einem Plattendefekt nicht alles weg ist.
            Absoluter Pfad auf dem Server; bei Docker muss der Ordner im Container eingebunden sein.
          </span>
        </label>
        <span className="muted small">
          {form.mode === 'off' ? 'Ohne Zeitplan gibt es nur Sicherungen, die du selbst über „Jetzt sichern“ anlegst.'
            : `Es werden die neuesten ${form.keep} automatischen Sicherungen behalten – ${form.mode === 'hourly' ? `das reicht ${form.keep} Stunden` : form.mode === 'daily' ? `das reicht ${form.keep} Tage` : `das reicht ${form.keep} Wochen`} zurück. Sicherungen von Hand, hochgeladene und solche vor dem Einspielen bleiben, bis du sie löschst.`}
        </span>
        <div className="row">
          <button className="primary" disabled={!dirty} onClick={() => void saveSchedule()}>Speichern</button>
          {dirty && <button onClick={() => setForm(o.schedule)}>Verwerfen</button>}
        </div>
      </div>

      <h3>Vorhandene Sicherungen</h3>
      <table className="simple">
        <thead><tr><th>Zeitpunkt</th><th>Art</th><th>Größe</th><th className="hide-narrow">Datei</th><th /></tr></thead>
        <tbody>
          {o.files.map((f) => (
            <tr key={f.name}>
              <td>{dt(f.createdAt)}</td>
              <td><span className={`badge light kind-${f.kind}`} title={KIND[f.kind][1]}>{KIND[f.kind][0]}</span></td>
              <td>{size(f.size)}</td>
              <td className="muted small hide-narrow"><code>{f.name}</code></td>
              <td>
                <div className="row nowrap">
                <a className="button" href={`/api/admin/backups/${encodeURIComponent(f.name)}/download`} download title="Herunterladen">⬇</a>
                <button onClick={() => setRestore(f)} title="Diese Sicherung einspielen">↺ Einspielen</button>
                <button className="danger" onClick={() => void remove(f)} title="Löschen" aria-label={`${f.name} löschen`}>🗑</button>
                </div>
              </td>
            </tr>
          ))}
          {o.files.length === 0 && <tr><td colSpan={5} className="muted">Noch keine Sicherungen vorhanden.</td></tr>}
        </tbody>
      </table>

      <div className="hint small backup-help">
        <strong>Wie funktionieren die Sicherungen?</strong>
        <ul>
          <li>Eine Sicherung ist eine vollständige Kopie der Datenbank: Plan, Mitarbeiter, Benutzer mit Rechten, Einstellungen und Protokoll. Sie wird im laufenden Betrieb angelegt, niemand muss sich abmelden.</li>
          <li><strong>Einspielen</strong> setzt alles auf den Stand der Sicherung zurück. Was danach eingetragen wurde, ist dann weg – vorher wird deshalb automatisch eine Sicherung „vor Einspielen“ angelegt. Angemeldete Benutzer bleiben angemeldet und sehen den alten Stand sofort.</li>
          <li>Die Sicherungen liegen auf demselben Server. Lade ab und zu eine herunter oder richte einen zusätzlichen Speicherort ein.</li>
          <li>Eine heruntergeladene Sicherung lässt sich auf einem neuen Server über „Sicherung hochladen“ einspielen – so zieht der Schichtplaner um.</li>
        </ul>
      </div>

      {restore && <RestoreDialog file={restore} onClose={() => setRestore(null)} />}
    </div>
  );
}

function RestoreDialog({ file, onClose }: { file: BackupFile; onClose: () => void }) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const r = await post<{ safety: string }>(`/api/admin/backups/${encodeURIComponent(file.name)}/restore`);
      store.toast(`Eingespielt. Der vorherige Stand liegt in ${r.safety}.`);
      // eigene Ansicht komplett neu laden (Stammdaten, Rechte, Einstellungen)
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      reportError(e);
      setBusy(false);
    }
  }
  return (
    <Modal title="Sicherung einspielen" onClose={onClose} closable={!busy}>
      <p>Alle Daten werden auf den Stand vom <strong>{dt(file.createdAt)}</strong> zurückgesetzt ({KIND[file.kind][0]}, {size(file.size)}).</p>
      <p className="warn">Alles, was seitdem eingetragen oder geändert wurde, geht verloren – auch Benutzer und Rechte.</p>
      <p className="muted small">Vorher wird automatisch eine Sicherung des aktuellen Stands angelegt. Damit lässt sich das Einspielen rückgängig machen.</p>
      <label className="row"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Ja, ich möchte den Stand vom {dt(file.createdAt)} wiederherstellen.</label>
      <div className="actions">
        <button onClick={onClose} disabled={busy}>Abbrechen</button>
        <button className="primary danger-bg" disabled={!ok || busy} onClick={() => void go()}>{busy ? 'Spiele ein …' : 'Einspielen'}</button>
      </div>
    </Modal>
  );
}
