/**
 * Gesetzliche Feiertage in Deutschland, je Bundesland.
 * Kürzel: BW BY BE BB HB HH HE MV NI NW RP SL SN ST SH TH
 */
export interface Holiday {
  date: string;
  name: string;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400_000);
}

/** Ostersonntag nach der Gaußschen Osterformel (anonymer gregorianischer Algorithmus). */
export function easterSunday(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(y, month, day);
}

export function holidays(year: number, state: string): Holiday[] {
  const s = state.toUpperCase();
  const easter = easterSunday(year);
  const list: Holiday[] = [];
  const add = (d: Date, name: string, states?: string[]) => {
    if (!states || states.includes(s)) list.push({ date: iso(d), name });
  };

  add(utc(year, 1, 1), 'Neujahr');
  add(utc(year, 1, 6), 'Heilige Drei Könige', ['BW', 'BY', 'ST']);
  add(utc(year, 3, 8), 'Internationaler Frauentag', ['BE', 'MV']);
  add(addDays(easter, -2), 'Karfreitag');
  add(easter, 'Ostersonntag', ['BB']);
  add(addDays(easter, 1), 'Ostermontag');
  add(utc(year, 5, 1), 'Tag der Arbeit');
  add(addDays(easter, 39), 'Christi Himmelfahrt');
  add(addDays(easter, 49), 'Pfingstsonntag', ['BB']);
  add(addDays(easter, 50), 'Pfingstmontag');
  add(addDays(easter, 60), 'Fronleichnam', ['BW', 'BY', 'HE', 'NW', 'RP', 'SL']);
  add(utc(year, 8, 15), 'Mariä Himmelfahrt', ['SL']);
  add(utc(year, 9, 20), 'Weltkindertag', ['TH']);
  add(utc(year, 10, 3), 'Tag der Deutschen Einheit');
  add(utc(year, 10, 31), 'Reformationstag', ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH']);
  add(utc(year, 11, 1), 'Allerheiligen', ['BW', 'BY', 'NW', 'RP', 'SL']);
  // Buß- und Bettag: Mittwoch vor dem 23. November
  const nov23 = utc(year, 11, 23);
  const back = ((nov23.getUTCDay() - 3 + 7) % 7) || 7;
  add(addDays(nov23, -back), 'Buß- und Bettag', ['SN']);
  add(utc(year, 12, 25), '1. Weihnachtsfeiertag');
  add(utc(year, 12, 26), '2. Weihnachtsfeiertag');

  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/** Art eines Tages: gesetzlicher Feiertag oder betrieblich arbeitsfreier Tag. */
export type HolidayKind = 'public' | 'company';

export interface SourceDay {
  date: string;
  name: string;
  kind: HolidayKind;
  /** official = gesetzlich im ganzen Bundesland, regional = nur in Teilen, common = häufig arbeitsfrei, aber kein Feiertag */
  group: 'official' | 'regional' | 'common';
  note?: string;
}

/**
 * Alles, was die eingebaute Quelle für ein Jahr anbietet: gesetzliche Feiertage des Bundeslandes,
 * nur regional geltende Feiertage und häufig arbeitsfreie Tage (Vorschläge, keine Feiertage).
 */
export function sourceDays(year: number, state: string): SourceDay[] {
  const s = state.toUpperCase();
  const easter = easterSunday(year);
  const list: SourceDay[] = holidays(year, s).map((h) => ({ ...h, kind: 'public', group: 'official' }));
  const regional = (d: Date, name: string, note: string) => list.push({ date: iso(d), name, kind: 'public', group: 'regional', note });
  const common = (d: Date, name: string, note?: string) => list.push({ date: iso(d), name, kind: 'company', group: 'common', note });

  if (s === 'BY') {
    regional(utc(year, 8, 8), 'Augsburger Friedensfest', 'nur im Stadtgebiet Augsburg');
    regional(utc(year, 8, 15), 'Mariä Himmelfahrt', 'in Gemeinden mit überwiegend katholischer Bevölkerung');
  }
  if (s === 'SN') regional(addDays(easter, 60), 'Fronleichnam', 'in einigen Gemeinden im Landkreis Bautzen');
  if (s === 'TH') regional(addDays(easter, 60), 'Fronleichnam', 'im Eichsfeld und einigen weiteren Gemeinden');

  common(addDays(easter, -52), 'Weiberfastnacht', 'Karneval/Fastnacht, v. a. im Rheinland');
  common(addDays(easter, -48), 'Rosenmontag', 'Karneval/Fastnacht');
  common(addDays(easter, -47), 'Faschingsdienstag', 'Karneval/Fastnacht');
  common(utc(year, 12, 24), 'Heiligabend');
  common(utc(year, 12, 31), 'Silvester');

  return list.sort((a, b) => a.date.localeCompare(b.date) || a.group.localeCompare(b.group));
}
