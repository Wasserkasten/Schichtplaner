// Prüft, ob die plattformabhängigen Binärdateien der Build-Werkzeuge installiert sind.
// Hintergrund: npm überspringt optionale Pakete stillschweigend, wenn z. B. ihr Download
// fehlschlägt (https://github.com/npm/cli/issues/4828). Der Docker-Build würde sonst erst
// später mit "Cannot find native binding" abbrechen – und den kaputten Stand cachen.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const checks = [
  ['rolldown (Vite)', async () => { await import('rolldown'); }],
  ['lightningcss (Vite)', async () => { require('lightningcss'); }],
  ['typescript', async () => {
    const pkg = require.resolve('typescript/package.json');
    execFileSync(process.execPath, [join(dirname(pkg), require(pkg).bin.tsc), '-v'], { stdio: 'pipe' });
  }],
  ['better-sqlite3', async () => { const D = require('better-sqlite3'); new D(':memory:').close(); }],
];

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
  } catch (e) {
    failed++;
    console.error(`FEHLT: ${name} – ${String(e?.message ?? e).split('\n')[0]}`);
  }
}
if (failed) {
  console.error(`\n${failed} Binärdatei(en) fehlen (Plattform: ${process.platform}-${process.arch}).`);
  process.exit(1);
}
console.log(`Binärdateien vollständig (${process.platform}-${process.arch}).`);
