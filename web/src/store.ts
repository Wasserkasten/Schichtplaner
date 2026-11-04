import { useSyncExternalStore } from 'react';
import { get } from './api';
import type { Bootstrap, Entry, Holiday } from './types';

type Listener = () => void;

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

  async loadBootstrap() {
    this.boot = await get<Bootstrap>('/api/bootstrap');
    this.emit();
    return this.boot;
  }

  reset() {
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
    this.holidays.set(year, await get<Holiday[]>(`/api/holidays?year=${year}`));
    this.emit();
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

  /** Live-Verbindung; verbindet sich bei Abbruch selbst neu und lädt dann die sichtbaren Zeiträume nach. */
  connect() {
    if (this.es) return;
    const es = new EventSource('/api/events');
    this.es = es;
    es.addEventListener('hello', () => {
      const wasOffline = !this.live;
      this.live = true;
      this.emit();
      // Über eine Kopie iterieren: loadRange() sortiert this.ranges um (löschen + neu anhängen).
      // Beim Iterieren über die Map selbst würde derselbe Eintrag endlos erneut besucht.
      if (wasOffline) for (const r of [...this.ranges.values()]) void this.loadRange(r.from, r.to, r.employeeId).catch(() => {});
    });
    es.addEventListener('entries', (ev) => {
      const msg = JSON.parse((ev as MessageEvent).data) as { action: 'upsert' | 'delete'; items: Entry[] };
      if (msg.action === 'upsert') this.upsert(msg.items);
      else this.remove(msg.items.map((i) => i.id));
    });
    es.addEventListener('masterdata', () => {
      void this.loadBootstrap().catch(() => {});
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
