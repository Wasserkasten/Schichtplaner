import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { store } from '../store';
import { Modal } from './Modal';

export interface LinkInfo {
  token: string;
  expiresAt: string;
  secretKind: 'personnel_no' | 'short_name' | null;
  purpose: 'setup' | 'reset';
}
export interface SupportContact { name: string; phone: string; email: string; note: string }

export const SECRET_LABEL = { personnel_no: 'Personalnummer', short_name: 'Kürzel' } as const;
/** „die Personalnummer“ / „das Kürzel“ bzw. „deine …“ / „dein …“ */
export const article = (label: string, mine = false) => (label === 'Kürzel' ? (mine ? 'dein' : 'das') : mine ? 'deine' : 'die');

/** Vorschlag „vorname.nachname“ ohne Umlaute/Sonderzeichen. */
export function usernameSuggestion(first: string, last: string): string {
  const clean = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  return [clean(first), clean(last)].filter(Boolean).join('.');
}

/** Zufälliges, gut lesbares Passwort (ohne 0/O, 1/l/I), z. B. „Hk7p-Xw3a-Rm9e“. */
export function randomPassword(): string {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  const s = [...bytes].map((b) => chars[b % chars.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export const linkUrl = (token: string) => `${location.origin}/#/passwort/${token}`;
const fmt = (iso: string) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    store.toast('In die Zwischenablage kopiert');
  } catch {
    store.toast('Kopieren nicht möglich – bitte den Link markieren und kopieren', 'error');
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Zugangsschreiben in einem eigenen Fenster drucken (Name, Benutzername, QR-Code, Anleitung, Ansprechpartner). */
async function printHandout(p: { displayName: string; username: string; link: LinkInfo; contact: SupportContact | null }) {
  const url = linkUrl(p.link.token);
  const qr = await QRCode.toString(url, { type: 'svg', margin: 1, width: 220 });
  const secret = p.link.secretKind ? SECRET_LABEL[p.link.secretKind] : null;
  const c = p.contact;
  const contact = c
    ? [c.name, c.phone && `Tel. ${c.phone}`, c.email, c.note].filter(Boolean).map((x) => esc(String(x))).join('<br>')
    : 'deine Administratorin bzw. deinen Administrator';
  const w = window.open('', '_blank', 'width=800,height=1000');
  if (!w) return store.toast('Das Druckfenster wurde blockiert – bitte Pop-ups für diese Seite erlauben', 'error');
  w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Zugang Schichtplaner – ${esc(p.displayName)}</title>
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1d2733; line-height: 1.45; }
  h1 { font-size: 22px; margin: 0 0 4px; } .muted { color: #6b7785; }
  .box { border: 1px solid #c8ced6; border-radius: 10px; padding: 16px 20px; margin: 18px 0; }
  .row { display: flex; gap: 24px; align-items: center; }
  .big { font-size: 18px; font-weight: 700; }
  ol { padding-left: 20px; } li { margin: 6px 0; }
  .url { font-family: ui-monospace, Consolas, monospace; font-size: 12px; word-break: break-all; }
</style></head><body>
<h1>Dein Zugang zum Schichtplaner</h1>
<div class="muted">${p.link.purpose === 'reset' ? 'Neues Passwort festlegen' : 'Erstanmeldung'}</div>
<div class="box"><div class="row"><div>${qr}</div><div>
  <div class="muted">Für</div><div class="big">${esc(p.displayName)}</div>
  <div class="muted" style="margin-top:10px">Benutzername</div><div class="big">${esc(p.username)}</div>
</div></div></div>
<ol>
  <li>QR-Code mit dem Handy scannen oder diesen Link im Browser öffnen:<br><span class="url">${esc(url)}</span></li>
  ${secret ? `<li>Zur Bestätigung ${article(secret, true)} <b>${secret}</b> eingeben.</li>` : ''}
  <li>Ein eigenes Passwort festlegen (mindestens 8 Zeichen) – danach bist du angemeldet.</li>
  <li>Künftig unter <span class="url">${esc(location.origin)}</span> mit Benutzername und Passwort anmelden.</li>
</ol>
<p><b>Gültig bis ${esc(fmt(p.link.expiresAt))}</b>, nur einmal verwendbar. Bitte nicht weitergeben.</p>
<div class="box"><b>Probleme oder Link abgelaufen?</b><br>${contact}</div>
<script>window.onload = () => { window.print(); };</script>
</body></html>`);
  w.document.close();
}

/** Ergebnis nach dem Anlegen eines Kontos bzw. „Link zum Zurücksetzen“: Link kopieren, QR-Code, Zugangsschreiben. */
export function PasswordLinkDialog({ displayName, username, link, onClose }: { displayName: string; username: string; link: LinkInfo; onClose: () => void }) {
  const url = linkUrl(link.token);
  const [qr, setQr] = useState('');
  const [contact, setContact] = useState<SupportContact | null>(null);
  useEffect(() => {
    QRCode.toString(url, { type: 'svg', margin: 1, width: 160 }).then(setQr, () => {});
    fetch('/api/public/login-info').then((r) => r.json()).then((d: { contact: SupportContact | null }) => setContact(d.contact), () => {});
  }, [url]);
  const secret = link.secretKind ? SECRET_LABEL[link.secretKind] : null;
  return (
    <Modal title={link.purpose === 'reset' ? 'Link zum Zurücksetzen' : 'Konto angelegt'} onClose={onClose} wide>
      <p>
        <strong>{displayName}</strong> (Benutzername <code>{username}</code>) legt das Passwort über diesen Link selbst fest. Du erfährst es nicht.
      </p>
      <div className="link-box">
        {qr && <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />}
        <div className="link-text">
          <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Link" />
          <div className="row">
            <button className="primary" onClick={() => void copy(url)}>Link kopieren</button>
            <button onClick={() => void printHandout({ displayName, username, link, contact })}>🖨 Zugangsschreiben drucken</button>
          </div>
          <p className="small muted">
            Gültig bis {fmt(link.expiresAt)}, nur einmal verwendbar.{' '}
            {secret ? (
              <>Beim Öffnen wird {article(secret)} <strong>{secret}</strong> abgefragt.</>
            ) : (
              <span className="warn">Kein Prüfmerkmal hinterlegt (weder Personalnummer noch Kürzel) – Link nur persönlich übergeben.</span>
            )}
          </p>
        </div>
      </div>
      <p className="small muted">
        Weitergeben z. B. als Ausdruck, per Chat oder Teams. Den Link kannst du jederzeit unter <em>Benutzer & Rechte</em> neu erzeugen; der alte wird dann ungültig.
        {!contact && ' Tipp: Unter Einstellungen einen Ansprechpartner für Anmeldeprobleme eintragen – er erscheint im Zugangsschreiben und auf der Anmeldeseite.'}
      </p>
      <div className="actions"><button onClick={onClose}>Fertig</button></div>
    </Modal>
  );
}
