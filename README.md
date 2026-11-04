# Schichtplaner

Web-App für Dienst- und Abwesenheitsplanung mehrerer Abteilungen und Teams – mit persönlichen Konten,
granularen Rechten, Änderungsprotokoll und Live-Aktualisierung bei gleichzeitiger Bearbeitung.

Konzept, Rechtemodell und Fahrplan: **[docs/KONZEPT.md](docs/KONZEPT.md)** · Installation: **[docs/INSTALLATION.md](docs/INSTALLATION.md)**

## Funktionen

- **Kalender**: Mitarbeiter (nach Abteilung/Team gruppiert) × Tage über die volle Fensterbreite, KW, Wochenenden, Feiertage;
  bis zu 3 Dienste pro Mitarbeiter und Tag.
- **Schriftgröße** pro Benutzer einstellbar (Benutzermenü), gilt auf allen Geräten.
  Klick auf eine Zelle öffnet den Bearbeitungsdialog; mit dem **Pinsel** (Eintragsart wählen) lassen sich
  Zellen anklicken oder ganze Bereiche aufziehen.
- **Tagesübersicht**: Wer hat welchen Dienst, wer ist abwesend, wer hat keinen Eintrag?
- **Jahreskalender** je Mitarbeiter mit Urlaubskonto und Auswertung.
- **Gespeicherte Ansichten** und persönliche Standardansicht.
- **Eintragsarten** frei konfigurierbar (Kürzel, Farbe, Zeiten, „zählt als Urlaub“, „vertraulich“) plus Freitext.
- **Rechte**: ansehen / bearbeiten / verwalten – je Team, Abteilung oder global; eigenes Team automatisch.
- **Konten einfach anlegen**: Mitarbeiter und Konto in einem Schritt; Passwort legt jeder selbst über einen
  persönlichen Link fest (QR-Code, druckbares Zugangsschreiben, Bestätigung per Personalnummer/Kürzel).
- **Rückgängig** über Meldungen nach jeder Änderung (auch mehrere, Strg+Z), sicher bei gleichzeitiger Bearbeitung.
- **Änderungsprotokoll** in Klartext mit Verlauf pro Zelle.
- **Jahresübersicht drucken und als PDF** (einzeln oder ganzes Team).
- **Mehrbenutzer**: Live-Updates (Server-Sent Events) und Konflikterkennung.
- **PWA**: auf Handy und PC installierbar, responsives Layout.
- **Feiertage** je Bundesland plus eigene arbeitsfreie Tage (Heiligabend, Silvester, Rosenmontag …), pflegbar unter *Verwaltung → Feiertage*.
- **Beispieldaten** per Klick einfügen und wieder entfernen (*Verwaltung → Einstellungen*).

## Installation

**Empfohlen für den Betrieb: Docker** – App und automatisches HTTPS (Caddy) mit einem Befehl, tägliche Backups inklusive:

```bash
git clone https://github.com/wasserkasten/schichtplaner.git && cd schichtplaner
cp .env.example .env      # ADMIN_PASSWORD und Zugang eintragen (siehe unten)
docker compose up -d --build
```

Zugang aus dem Internet wahlweise über **Caddy** (Ports 80/443, `DOMAIN` setzen) oder **Cloudflare Tunnel**
(keine offenen Ports, `COMPOSE_PROFILES=cloudflare` und `CLOUDFLARE_TUNNEL_TOKEN` setzen). Ist Port 3000 auf dem Server
schon belegt: `APP_BIND=127.0.0.1:3001` in `.env`.

**Zum Ausprobieren und Entwickeln: npm** (Node.js 22):

```bash
npm ci
npm run seed              # optional: Beispieldaten, Logins admin / demo.mitarbeiter / demo.teamleitung / demo.leser, Passwort "demo1234"
npm run dev               # → http://localhost:5173
```

➡️ **Ausführliche Anleitung** (Server vorbereiten, Ersteinrichtung, Rechte, Backups, Updates, nginx, systemd,
Fehlerbehebung): **[docs/INSTALLATION.md](docs/INSTALLATION.md)**

## Versionierung

Versionsnummern nach [Semantic Versioning](https://semver.org/lang/de/), Änderungen in **[CHANGELOG.md](CHANGELOG.md)**.
Die laufende Version zeigt die App Administratoren unter *Verwaltung → Info* und unter `/api/health`.

Bei jeder Änderung, die nach `main` geht:

1. Eintrag in `CHANGELOG.md` unter der kommenden Version (*Neu*, *Geändert*, *Behoben*). Was alle Benutzer wissen
   sollten, zusätzlich unter **Für alle** (erscheint als Hinweisleiste); nur bei einschneidenden Änderungen
   **Wichtig** (erscheint als Fenster mit „Verstanden“)
2. Version anheben – `npm version minor --no-git-tag-version --workspaces --include-workspace-root`
   für neue Funktionen, `patch` für reine Fehlerbehebungen
3. Nach dem Merge den Stand auf `main` taggen, z. B. `git tag v0.3.0 && git push origin v0.3.0`

## Aufbau

```
server/   Fastify-API, SQLite-Schema (src/schema.sql), Rechte (src/permissions.ts),
          Kommandozeilenwerkzeug (src/cli.ts), Tests
web/      React-Oberfläche (src/views: Kalender, Tag, Jahr, Verwaltung), PWA-Konfiguration
docs/     Konzept
```

> Hinweis: Privates Projekt. Vor einem Einsatz beim Arbeitgeber bitte Kapitel 7 im Konzept beachten
> (Freigabe, Betriebsrat, Datenschutz).
