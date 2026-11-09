import { put } from './api';

/** Wählbare Schriftgrößen (Faktor auf die Grundgröße). */
export const FONT_STEPS = [0.9, 1, 1.15, 1.3, 1.5, 1.75];
const KEY = 'sp-font-scale';

/** Setzt die Schriftgröße für die ganze Oberfläche (alle Maße hängen über rem daran). */
export function applyFontScale(scale: number): void {
  document.documentElement.style.setProperty('--fs', String(scale));
  try {
    localStorage.setItem(KEY, String(scale)); // damit schon die Anmeldeseite in der gewohnten Größe erscheint
  } catch {
    /* privates Fenster o. Ä. – egal */
  }
}

/** Zuletzt auf diesem Gerät benutzte Größe (für die Anmeldeseite). */
export function restoreFontScale(): void {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (v >= 0.8 && v <= 2) document.documentElement.style.setProperty('--fs', String(v));
  } catch {
    /* ignorieren */
  }
}

export function nextStep(current: number, dir: 1 | -1): number {
  const i = FONT_STEPS.findIndex((s) => Math.abs(s - current) < 0.01);
  const idx = i === -1 ? FONT_STEPS.indexOf(1) : i;
  return FONT_STEPS[Math.max(0, Math.min(FONT_STEPS.length - 1, idx + dir))];
}

/** Speichert die Größe am Benutzerkonto, damit sie auf allen Geräten gilt. */
export async function saveFontScale(scale: number): Promise<void> {
  applyFontScale(scale);
  await put('/api/me/preferences', { fontScale: scale });
}

// ---------- Darstellung hell / dunkel ----------
export type Theme = 'auto' | 'light' | 'dark';
const THEME_KEY = 'sp-theme';

/** auto = wie das Betriebssystem; light/dark erzwingt die Darstellung (siehe styles.css, [data-theme]). */
export function applyTheme(theme: Theme): void {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* egal */
  }
}

export function restoreTheme(): void {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch {
    /* ignorieren */
  }
}

export async function saveTheme(theme: Theme): Promise<void> {
  applyTheme(theme);
  await put('/api/me/preferences', { theme });
}
