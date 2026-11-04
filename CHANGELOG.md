# Changelog

Alle wesentlichen Änderungen am Schichtplaner. Versionsnummern nach [Semantic Versioning](https://semver.org/lang/de/):
**MAJOR.MINOR.PATCH** – solange die Version mit `0.` beginnt, ist der Schichtplaner noch in Erprobung.
Die aktuell installierte Version steht unter *Verwaltung → Info*.

<!--
So wird dieser Changelog in der App verwendet (je Version):
  ### Für alle   – verständliche Punkte für alle Benutzer. Nach dem Update erscheint eine Hinweisleiste
                   „Was ist neu?“. Ohne diesen Abschnitt sehen nur Administratoren einen Hinweis.
  ### Wichtig    – nur bei einschneidenden Änderungen! Erscheint allen beim nächsten Start als Fenster, das mit
                   „Verstanden“ bestätigt werden muss; Administratoren sehen, wer schon bestätigt hat.
  ### Neu / Geändert / Behoben – technische Details, nur für Administratoren (Verwaltung → Info).
-->

## [0.3.0] – 2026-11-04

### Für alle
- **Vertippt? Einfach rückgängig machen:** Nach jeder Änderung erscheint unten links eine Meldung mit **Rückgängig**. Auch mehrere Änderungen lassen sich einzeln zurücknehmen; **Strg+Z** nimmt die letzte zurück. Frühere Änderungen findest du über **↶** oben rechts.
- **Mehrere Dienste an einem Tag:** bis zu drei, z. B. IV-Dienst und Telefondienst. Im Kalender das Häkchen **zusätzlich eintragen** setzen oder beim Klicken **Strg** gedrückt halten.
- **Mehr Tage auf einen Blick:** Der Kalender nutzt die ganze Bildschirmbreite. Unter *Zeitraum* zeigt **Fensterbreite** so viele Tage, wie hineinpassen.
- **Schrift zu klein?** Oben rechts auf deinen Namen klicken und mit **A−** / **A+** einstellen. Das gilt für dein Konto auf allen Geräten.
- **Jahresübersicht drucken oder als PDF speichern:** im Jahreskalender über **Drucken** bzw. **PDF**.
- **Feiertage und arbeitsfreie Tage** wie Heiligabend oder Rosenmontag sind im Plan farbig markiert.

### Neu
- **Neuigkeiten für alle:** Nach einem Update erscheint allen Benutzern eine Hinweisleiste „Was ist neu?“ mit den Punkten aus *Für alle*; besonders wichtige Hinweise (*Wichtig*) erscheinen als Fenster mit „Verstanden“, Administratoren sehen unter *Verwaltung → Info*, wer schon bestätigt hat. Lese- und Bestätigungsstand werden am Benutzerkonto gespeichert; „Neuigkeiten“ im Benutzermenü zeigt sie erneut.
- **Rückgängig:** Nach jeder eigenen Änderung erscheint unten links eine Meldung („U eingetragen · Becker, Anna · 11.–13.11.“) mit **Rückgängig**. Mehrere Meldungen können gleichzeitig offen sein; ältere Änderungen über **↶** in der Kopfzeile, die letzte auch mit **Strg+Z**. Zurückgenommenes lässt sich **wiederholen**. Hat jemand anderes den Eintrag inzwischen geändert, wird nichts überschrieben.
- **Jahresübersicht drucken und als PDF:** im Jahreskalender **Drucken** (A4 quer) und **PDF** – für einen Mitarbeiter oder ein ganzes Team (eine Seite je Person).
- **Protokoll lesbar:** *Verwaltung → Protokoll* zeigt Mitarbeiter, Datum und Änderung („F → S“), fasst zusammengehörige Änderungen zu einer Zeile zusammen, öffnet per Klick den Verlauf der Zelle und kann Änderungen zurücknehmen.
- **Versionsnummer und Changelog** unter *Verwaltung → Info*; nach einem Update weist ein Hinweis für Administratoren darauf hin.
- **Mehrere Dienste pro Tag:** bis zu 3 Dienste bzw. An-/Abwesenheiten je Mitarbeiter und Tag (z. B. IV-Dienst + Telefondienst). Pinsel mit „zusätzlich eintragen“ bzw. Strg-Klick.
- **Volle Kalenderbreite** und neuer Zeitraum **„Fensterbreite“** (so viele Tage, wie passen).
- **Schriftgröße** je Benutzer (90–175 %) im Benutzermenü, gilt auf allen Geräten.
- **Feiertage verwalten** (*Verwaltung → Feiertage*): aus der eingebauten Quelle übernehmen, eigene Tage anlegen, ändern, löschen. Neue Art **„arbeitsfrei“** für Heiligabend, Silvester, Rosenmontag usw.; regionale Feiertage als Vorschlag.
- **Beispieldaten** per Klick einfügen und wieder vollständig entfernen (*Verwaltung → Einstellungen*).
- Teams werden überall **mit Abteilung** angezeigt (gleichnamige Teams wie „Meisterei 1“ unterscheidbar); Abteilungszeilen im Kalender.

### Geändert
- Die Zählung der Dienste in den Team-Zeilen des Kalenders entfällt.
- Notizen erscheinen neben Diensten als kleine Markierung in der Zellecke.
- Der Pflicht-Dialog zum Passwortwechsel lässt sich nicht mehr wegklicken.

### Behoben
- Browser-Tab fror nach dem Anmelden ein (Endlosschleife beim Nachladen, v. a. über Cloudflare Tunnel).
- Docker-Build brach mit „Cannot find native binding“ ab, wenn npm ein optionales Paket übersprang.
- Meldungen wie „Höchstens 3 Dienste“ wurden fälschlich als Bearbeitungskonflikt angezeigt.

## [0.2.0] – 2026-11-04

### Neu
- **Cloudflare Tunnel** als Alternative zu Caddy (`COMPOSE_PROFILES=cloudflare`), ohne offene Ports.
- Port auf dem Server über `APP_BIND` einstellbar; `PORT` gilt auch im Entwicklungsmodus.

## [0.1.0] – 2026-11-01

### Neu
- Erste Version: Abteilungen, Teams, Mitarbeiter, persönliche Konten mit Rechten (ansehen/bearbeiten/verwalten),
  Kalender mit Pinsel, Tagesübersicht, Jahreskalender, gespeicherte Ansichten, Änderungsprotokoll,
  Live-Aktualisierung, Feiertage je Bundesland, PWA, Docker mit Caddy, automatische Backups, Kommandozeilenwerkzeug.
