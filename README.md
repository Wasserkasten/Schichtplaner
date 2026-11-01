# Schichtplaner

Web-App für Dienst- und Abwesenheitsplanung mehrerer Abteilungen und Teams – mit persönlichen Konten,
granularen Rechten, Änderungsprotokoll und Live-Aktualisierung bei gleichzeitiger Bearbeitung.

Konzept, Rechtemodell und Fahrplan: **[docs/KONZEPT.md](docs/KONZEPT.md)** · Installation: **[docs/INSTALLATION.md](docs/INSTALLATION.md)**

## Funktionen

- **Kalender**: Mitarbeiter (nach Team gruppiert) × Tage, KW, Wochenenden, Feiertage, Besetzung je Team.
  Klick auf eine Zelle öffnet den Bearbeitungsdialog; mit dem **Pinsel** (Eintragsart wählen) lassen sich
  Zellen anklicken oder ganze Bereiche aufziehen.
- **Tagesübersicht**: Wer hat welchen Dienst, wer ist abwesend, wer hat keinen Eintrag?
- **Jahreskalender** je Mitarbeiter mit Urlaubskonto und Auswertung.
- **Gespeicherte Ansichten** und persönliche Standardansicht.
- **Eintragsarten** frei konfigurierbar (Kürzel, Farbe, Zeiten, „zählt als Urlaub“, „vertraulich“) plus Freitext.
- **Rechte**: ansehen / bearbeiten / verwalten – je Team, Abteilung oder global; eigenes Team automatisch.
- **Änderungsprotokoll** mit Verlauf pro Zelle.
- **Mehrbenutzer**: Live-Updates (Server-Sent Events) und Konflikterkennung.
- **PWA**: auf Handy und PC installierbar, responsives Layout.

## Installation

**Empfohlen für den Betrieb: Docker** – App und automatisches HTTPS (Caddy) mit einem Befehl, tägliche Backups inklusive:

```bash
git clone https://github.com/wasserkasten/schichtplaner.git && cd schichtplaner
cp .env.example .env      # DOMAIN und ADMIN_PASSWORD eintragen
docker compose up -d --build
```

**Zum Ausprobieren und Entwickeln: npm** (Node.js 22):

```bash
npm ci
npm run seed              # optional: Demodaten, Logins admin / anna / ben, Passwort "demo1234"
npm run dev               # → http://localhost:5173
```

➡️ **Ausführliche Anleitung** (Server vorbereiten, Ersteinrichtung, Rechte, Backups, Updates, nginx, systemd,
Fehlerbehebung): **[docs/INSTALLATION.md](docs/INSTALLATION.md)**

## Aufbau

```
server/   Fastify-API, SQLite-Schema (src/schema.sql), Rechte (src/permissions.ts),
          Kommandozeilenwerkzeug (src/cli.ts), Tests
web/      React-Oberfläche (src/views: Kalender, Tag, Jahr, Verwaltung), PWA-Konfiguration
docs/     Konzept
```

> Hinweis: Privates Projekt. Vor einem Einsatz beim Arbeitgeber bitte Kapitel 7 im Konzept beachten
> (Freigabe, Betriebsrat, Datenschutz).
