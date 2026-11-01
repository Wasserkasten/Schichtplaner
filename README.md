# Schichtplaner

Web-App für Dienst- und Abwesenheitsplanung mehrerer Abteilungen und Teams – mit persönlichen Konten,
granularen Rechten, Änderungsprotokoll und Live-Aktualisierung bei gleichzeitiger Bearbeitung.

Konzept, Rechtemodell und Fahrplan: **[docs/KONZEPT.md](docs/KONZEPT.md)**

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

## Entwicklung

Voraussetzung: Node.js 22+

```bash
npm install
npm run seed            # Demodaten: Benutzer admin / anna / ben, Passwort "demo1234"
npm run dev             # Server :3000 + Vite-Dev-Server :5173 → http://localhost:5173
npm test                # API-Tests (Rechte, Konflikte, Pinsel, Feiertage)
npm run typecheck
```

Ohne Demodaten legt der Server beim ersten Start den Benutzer `admin` an und gibt das Passwort im Log aus
(oder nimmt `ADMIN_PASSWORD`).

## Betrieb

```bash
npm run build && npm start          # liefert API + gebaute Oberfläche auf Port 3000 aus
```

oder mit Docker inkl. automatischem HTTPS über Caddy:

```bash
DOMAIN=plan.example.de ADMIN_PASSWORD='…' docker compose up -d
```

| Variable | Bedeutung | Standard |
|---|---|---|
| `PORT` | HTTP-Port | `3000` |
| `DB_FILE` | Pfad der SQLite-Datenbank | `server/data/schichtplaner.db` |
| `STATIC_DIR` | gebaute Oberfläche | `web/dist` |
| `SECURE_COOKIES` | `true` hinter HTTPS | `false` |
| `ADMIN_PASSWORD` | Passwort des ersten Admins | zufällig, im Log |

Backup: die Datei `schichtplaner.db` sichern (im laufenden Betrieb z. B. mit `sqlite3 schichtplaner.db ".backup backup.db"`).

## Aufbau

```
server/   Fastify-API, SQLite-Schema (src/schema.sql), Rechte (src/permissions.ts), Tests
web/      React-Oberfläche (src/views: Kalender, Tag, Jahr, Verwaltung), PWA-Konfiguration
docs/     Konzept
```

> Hinweis: Privates Projekt. Vor einem Einsatz beim Arbeitgeber bitte Kapitel 7 im Konzept beachten
> (Freigabe, Betriebsrat, Datenschutz).
