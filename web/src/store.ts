import { useSyncExternalStore } from 'react';
import { get, post } from './api';
import { describeEntries, type ChangeParts } from './describe';
import type { Bootstrap, Entry, Holiday, SchoolHoliday } from './types';

type Listener = () => void;

/** Eine eigene Änderung dieser Sitzung – mit Rückgängig/Wiederholen. */
export interface ChangeNotice {
  id: number;
  /** Änderungs-ID, die beim nächsten Klick zurückgenommen wird (nach „Rückgängig“ die der Rücknahme) */
  changeId: string;
  text: string;
  at: Date;
  state: 'done' | 'undone' | 'busy';
  /** solange gesetzt und in der Zukunft, wird die Meldung unten eingeblendet */
  popupUntil: number;
}

const POPUP_MS = 12_000;
const MAX_NOTICES = 30;

/**
 * Zentraler Client-Zustand: Stammdaten, geladene Einträge, Feiertage.
 * Änderungen anderer Benutzer kommen per Server-Sent Events herein.
 */
class Store {
  boot: Bootstrap | null = null;
  entries = new Map<number, Entry>();
  holidays = new Map<number, Holiday[]>();
  live = false;
  toasts: { id: number; text: string; kind: 'info' | 'error' }[] = [];
  notices: ChangeNotice[] = [];
  /** Änderungen anderer am eigenen Plan, seit der Hinweis zuletzt gelesen wurde (Live-Zähler) */
  foreignChanges = 0;
  private foreignToastAt = 0;
  private foreignChangeIds = new Set<string>();

  private version = 0;
  private cellIndex: Map<string, Entry[]> | null = null;
  private listeners = new Set<Listener>();
  private ranges = new Map<string, { from: string; to: string; employeeId?: number }>();
  private es: EventSource | null = null;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    this.cellIndex = null;
    for (const l of this.listeners) l();
  }

  toast(text: string, kind: 'info' | 'error' = 'info') {
    const id = Date.now() + Math.random();
    this.toasts = [...this.toasts, { id, text, kind }];
    this.emit();
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.emit();
    }, kind === 'error' ? 6000 : 3500);
  }

  /**
   * Ergebnis einer eigenen Änderung übernehmen und als Meldung mit „Rückgängig“ anzeigen.
   * `deletedIds` werden vor dem Entfernen nachgeschlagen, damit die Meldung sagen kann, was gelöscht wurde.
   */
  applyChange(changeId: string | undefined, c: { created?: Entry[]; deletedIds?: number[]; updated?: { before: Entry; after: Entry } }) {
    const removed = (c.deletedIds ?? []).map((id) => this.entries.get(id)).filter((e): e is Entry => !!e);
    this.remove(c.deletedIds ?? []);
    this.upsert([...(c.created ?? []), ...(c.updated ? [c.updated.after] : [])]);
    const parts: ChangeParts = { created: c.created, removed, updated: c.updated ? [c.updated] : [] };
    if (!changeId || (!c.created?.length && !removed.length && !c.updated) || !this.boot) return;
    const n: ChangeNotice = { id: Date.now() + Math.random(), changeId, text: describeEntries(this.boot, parts), at: new Date(), state: 'done', popupUntil: Date.now() + POPUP_MS };
    this.notices = [n, ...this.notices].slice(0, MAX_NOTICES);
    this.emit();
    setTimeout(() => this.emit(), POPUP_MS + 50); // Meldung ausblenden
  }

  /** Änderung zurücknehmen (state 'done') bzw. die Rücknahme wiederholen (state 'undone'). */
  async toggleUndo(id: number) {
    const n = this.notices.find((x) => x.id === id);
    if (!n || n.state === 'busy') return;
    const wasDone = n.state === 'done';
    this.patchNotice(id, { state: 'busy' });
    try {
      const res = await post<{ changeId: string; upserted: Entry[]; deleted: number[] }>(`/api/changes/${n.changeId}/undo`);
      this.remove(res.deleted);
      this.upsert(res.upserted);
      this.patchNotice(id, { state: wasDone ? 'undone' : 'done', changeId: res.changeId, popupUntil: Date.now() + POPUP_MS });
      setTimeout(() => this.emit(), POPUP_MS + 50);
    } catch (e) {
      this.patchNotice(id, { state: wasDone ? 'done' : 'undone' });
      this.toast((e as Error).message, 'error');
    }
  }

  private noteForeignChange(by: number, changeId?: string) {
    // „gelöscht“ + „angelegt“ derselben Aktion nur einmal zählen
    if (changeId && this.foreignChangeIds.has(changeId)) return;
    if (changeId) this.foreignChangeIds.add(changeId);
    this.foreignChanges++;
    // nicht bei jedem Pinselstrich einzeln melden
    if (Date.now() - this.foreignToastAt > 30_000) {
      this.foreignToastAt = Date.now();
      const name = this.boot?.users.find((u) => u.id === by)?.displayName ?? 'Jemand';
      this.toast(`${name} hat gerade deinen Plan geändert – Details unter „Änderungen an meinem Plan“.`);
    }
    this.emit();
  }

  resetForeignChanges() {
    this.foreignChanges = 0;
    this.emit();
  }

  dismissNotice(id: number) {
    this.patchNotice(id, { popupUntil: 0 });
  }

  private patchNotice(id: number, p: Partial<ChangeNotice>) {
    this.notices = this.notices.map((x) => (x.id === id ? { ...x, ...p } : x));
    this.emit();
  }

  async loadBootstrap() {
    this.boot = await get<Bootstrap>('/api/bootstrap');
    this.emit();
    return this.boot;
  }

  reset() {
    this.notices = [];
    this.es?.close();
    this.es = null;
    this.boot = null;
    this.entries.clear();
    this.ranges.clear();
    this.holidays.clear();
    this.emit();
  }

  /** Einträge eines Zeitraums laden; ersetzt den bisherigen Stand in diesem Zeitraum. */
  async loadRange(from: string, to: string, employeeId?: number) {
    const key = `${from}|${to}|${employeeId ?? ''}`;
    this.ranges.delete(key);
    this.ranges.set(key, { from, to, employeeId });
    // nur die zuletzt angesehenen Zeiträume bei Wiederverbindung nachladen
    if (this.ranges.size > 4) this.ranges.delete(this.ranges.keys().next().value!);
    const list = await get<Entry[]>(`/api/entries?from=${from}&to=${to}${employeeId ? `&employeeId=${employeeId}` : ''}`);
    for (const [id, e] of this.entries) {
      if (e.date >= from && e.date <= to && (!employeeId || e.employeeId === employeeId)) this.entries.delete(id);
    }
    for (const e of list) this.entries.set(e.id, e);
    this.emit();
  }

  async loadHolidays(year: number) {
    if (this.holidays.has(year)) return;
    this.holidays.set(year, []);
    try {
      this.holidays.set(year, await get<Holiday[]>(`/api/holidays?year=${year}`));
    } catch (e) {
      this.holidays.delete(year); // beim nächsten Mal erneut versuchen
      throw e;
    }
    this.emit();
  }

  /** Schulferien je Jahr (Zeiträume, die das Jahr berühren) */
  schoolHolidays = new Map<number, SchoolHoliday[]>();
  schoolHolidayState = '';

  async loadSchoolHolidays(year: number) {
    if (this.schoolHolidays.has(year)) return;
    this.schoolHolidays.set(year, []);
    try {
      const r = await get<{ state: string; periods: SchoolHoliday[] }>(`/api/school-holidays?year=${year}`);
      this.schoolHolidays.set(year, r.periods);
      this.schoolHolidayState = r.state;
      this.emit();
    } catch {
      this.schoolHolidays.delete(year);
    }
  }

  /** Schulferien an diesem Tag (oder undefined). */
  schoolHolidayOn(date: string): SchoolHoliday | undefined {
    const y = Number(date.slice(0, 4));
    if (!this.schoolHolidays.has(y)) void this.loadSchoolHolidays(y);
    return this.schoolHolidays.get(y)?.find((p) => p.start <= date && p.end >= date);
  }

  holidayOn(date: string): Holiday | undefined {
    const y = Number(date.slice(0, 4));
    if (!this.holidays.has(y)) void this.loadHolidays(y);
    return this.holidays.get(y)?.find((h) => h.date === date);
  }

  upsert(list: Entry[]) {
    for (const e of list) this.entries.set(e.id, e);
    this.emit();
  }
  remove(ids: number[]) {
    for (const id of ids) this.entries.delete(id);
    this.emit();
  }

  cell(employeeId: number, date: string): Entry[] {
    if (!this.cellIndex) {
      const idx = new Map<string, Entry[]>();
      for (const e of this.entries.values()) {
        const k = `${e.employeeId}|${e.date}`;
        const arr = idx.get(k);
        if (arr) arr.push(e);
        else idx.set(k, [e]);
      }
      for (const arr of idx.values()) arr.sort((a, b) => (a.typeId == null ? 1 : 0) - (b.typeId == null ? 1 : 0) || a.id - b.id);
      this.cellIndex = idx;
    }
    return this.cellIndex.get(`${employeeId}|${date}`) ?? [];
  }

  /** Alle zuletzt angesehenen Zeiträume neu laden (nach Neuverbindung oder größeren Änderungen). */
  reloadRanges() {
    // Über eine Kopie iterieren: loadRange() sortiert this.ranges um (löschen + neu anhängen).
    // Beim Iterieren über die Map selbst würde derselbe Eintrag endlos erneut besucht.
    for (const r of [...this.ranges.values()]) void this.loadRange(r.from, r.to, r.employeeId).catch(() => {});
  }

  /** Live-Verbindung; verbindet sich bei Abbruch selbst neu und lädt dann die sichtbaren Zeiträume nach. */
  connect() {
    if (this.es) return;
    const es = new EventSource('/api/events');
    this.es = es;
    es.addEventListener('hello', () => {
      const wasOffline = !this.live;
      this.live = true;
      this.emit();
      if (wasOffline) this.reloadRanges();
    });
    es.addEventListener('entries', (ev) => {
      const msg = JSON.parse((ev as MessageEvent).data) as { action: 'upsert' | 'delete'; by?: number; changeId?: string; items: Entry[] };
      // jemand anderes ändert gerade meinen Plan -> kurz Bescheid geben (gelöschte Einträge kennen wir vor dem Entfernen)
      const me = this.boot?.me;
      if (me?.employeeId && msg.by && msg.by !== me.id) {
        const mine = msg.action === 'upsert' ? msg.items.some((i) => i.employeeId === me.employeeId) : msg.items.some((i) => this.entries.get(i.id)?.employeeId === me.employeeId);
        if (mine) this.noteForeignChange(msg.by, msg.changeId);
      }
      if (msg.action === 'upsert') this.upsert(msg.items);
      else this.remove(msg.items.map((i) => i.id));
    });
    es.addEventListener('holidays', () => {
      this.holidays.clear(); // werden beim nächsten Zeichnen neu geladen
      this.schoolHolidays.clear();
      this.emit();
    });
    es.addEventListener('masterdata', (ev) => {
      const msg = JSON.parse((ev as MessageEvent).data || '{}') as { reloadEntries?: boolean };
      void this.loadBootstrap()
        .then(() => msg.reloadEntries && this.reloadRanges())
        .catch(() => {});
    });
    es.onerror = () => {
      this.live = false;
      this.emit();
    };
  }
}

export const store = new Store();

/** Rendert die Komponente neu, sobald sich der Store ändert. */
export function useStore(): Store {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}
