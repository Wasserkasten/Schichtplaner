import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function readRoot(file: string): string | null {
  // src/ bzw. dist/ liegen zwei Ebenen unter dem Projektordner (im Docker-Image: /app/server/dist)
  for (const p of [join(here, '..', '..', file), join(here, '..', file)]) {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      /* nächsten Pfad versuchen */
    }
  }
  return null;
}

/** Versionsnummer aus der package.json im Projektordner. */
export const APP_VERSION: string = (() => {
  const raw = readRoot('package.json');
  return (raw && (JSON.parse(raw) as { version?: string }).version) || process.env.APP_VERSION || '0.0.0';
})();

/** Inhalt von CHANGELOG.md (für die Anzeige in der Verwaltung). */
export function readChangelog(): string {
  return readRoot('CHANGELOG.md') ?? '';
}
