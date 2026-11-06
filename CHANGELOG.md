# Changelog

Alle wesentlichen Änderungen am Schichtplaner. Versionsnummern nach [Semantic Versioning](https://semver.org/lang/de/):
**MAJOR.MINOR.PATCH** – solange die Version mit `0.` beginnt, ist der Schichtplaner noch in Erprobung.
Die aktuell installierte Version steht unter *Benutzermenü → ⚙ Verwaltung → Info*.

<!--
So wird dieser Changelog in der App verwendet (je Version):
  ### Für alle   – verständliche Punkte für alle Benutzer. Nach dem Update erscheint eine Hinweisleiste
                   „Was ist neu?“. Ohne diesen Abschnitt sehen nur Administratoren einen Hinweis.
  ### Wichtig    – nur bei einschneidenden Änderungen! Erscheint allen beim nächsten Start als Fenster, das mit
                   „Verstanden“ bestätigt werden muss; Administratoren sehen, wer schon bestätigt hat.
  ### Neu / Geändert / Behoben – technische Details, nur für Administratoren (Verwaltung → Info).
-->

## [0.5.0] – 2026-11-06

### Für alle
- **Neues Menü oben rechts:** Klick auf deinen Namen öffnet **Profil & Einstellungen** – mit **Hell- und Dunkelmodus**, Schriftgröße und Passwort ändern. Die Verwaltung ist (für Berechtigte) ebenfalls hier zu finden.
- **Änderungen an deinem Plan:** Hat jemand anderes deine Einträge geändert, siehst du das beim nächsten Start. Im Menü unter **📝 Änderungen an meinem Plan** steht jederzeit, wer wann was geändert hat.
- **Pinsel auf belegtem Feld:** Die App fragt jetzt, ob der vorhandene Eintrag **überschrieben** oder **zusätzlich eingetragen** werden soll. Mit **Strg** trägt der Pinsel ohne Rückfrage zusätzlich ein.
- **Gezielt löschen:** Stehen in den markierten Feldern verschiedene Einträge, kannst du auswählen, welche entfernt werden.
- **Monat oder Jahr direkt wählen:** auf die Überschrift (z. B. „November 2026 ▾“) klicken.
- **Kommentare beim Darüberfahren:** Der Text einer Notiz erscheint sofort, sobald die Maus über dem Feld ist. Im Kalender selbst zeigt nur noch die gelbe Ecke, dass es Text gibt.
- **Schulferien** sind im Kalender als türkiser Balken über den Tagen markiert.
- **Wochenenden** sind deutlicher abgesetzt.

### Neu
- **Backups** (*Verwaltung → Backups*): Zeitplan (aus, stündlich, täglich, wöchentlich mit Uhrzeit), Anzahl aufbewahrter Sicherungen, optional zweiter Speicherort (z. B. NAS); Liste aller Sicherungen mit Art und Größe; **Jetzt sichern**, Herunterladen, Löschen, Hochladen (mit Prüfung) und **Einspielen im laufenden Betrieb** – vorher wird automatisch eine Sicherung „vor Einspielen“ angelegt, angemeldete Benutzer bleiben angemeldet. Verpasste Termine werden nach dem Start nachgeholt.
- **Schulferien** je Bundesland (*Verwaltung → Ferien*): aus openholidaysapi.org übernehmen (Abgleich fehlt/vorhanden/abweichend) oder selbst pflegen; Anzeige im Kalender, Jahreskalender und in der Tagesübersicht.
- **Profil & Einstellungen** je Benutzer: Darstellung Automatisch/Hell/Dunkel (am Konto gespeichert), Benachrichtigungen an/aus, Schriftgröße, Passwort.
- **Änderungen an meinem Plan:** Hinweis beim Start über Änderungen anderer an den eigenen Einträgen, vollständige Liste mit „neu“-Markierung und Filter „nur von anderen“; Live-Hinweis, wenn jemand während der Sitzung ändert.
- **Monats- und Jahresauswahl** per Klick auf die Überschrift (Kalender und Jahreskalender).
- Protokoll: lesbare Texte für Sicherungen, Backup-Zeitplan und Schulferien.

### Geändert
- **Verwaltung im Benutzermenü** statt in der Hauptnavigation; im Verwaltungsbereich ist die Kopfzeile dunkler gefärbt, **← Zurück zum Plan** führt zurück.
- Pinsel: Rückfrage auf belegten Feldern ersetzt das Häkchen „zusätzlich eintragen“; Radiergummi fragt bei gemischten Einträgen nach.
- Notizen ohne Dienst stehen nicht mehr als Text in der Zelle, sondern nur als gelbe Ecke mit sofortigem Tooltip.
- Wochenenden kräftiger hinterlegt (hell und dunkel).
- Automatische Sicherungen laufen jetzt immer (Standard täglich 02:30 Uhr in `data/backups` neben der Datenbank bzw. `BACKUP_DIR`) und werden in der App eingestellt; `BACKUP_KEEP` ist nur noch die Vorgabe.

## [0.4.0] – 2026-11-05

### Für alle
- **Notiz-Ecke bei jedem Text:** Steht an einem Tag ein Text – auch zusätzlich zu einem Dienst (z. B. „F“ mit „Schulung ab 10 Uhr“) –, zeigt die gelbe Ecke das an. Mit der Maus darüberfahren zeigt den Text.
- **Ein- und Austritt:** Vor dem ersten und nach dem letzten Arbeitstag erscheinen Kollegen nicht mehr im Plan; solche Tage sind grau schraffiert und gesperrt.
- **Kein unnötiges Zurückblättern:** Im Kalender geht es nur so weit zurück, wie es Daten gibt.

### Neu
- **Eintritts- und Austrittsdatum** je Mitarbeiter (*Verwaltung → Mitarbeiter*, Spalte „Beschäftigt“). Außerhalb sind keine Einträge möglich (auch per Pinsel und Rückgängig serverseitig geprüft); Kalender und Tagesübersicht zeigen nur in dem Zeitraum Beschäftigte, Jahreskalender und PDF graue Tage. Wird ein Austritt vorgezogen und gibt es danach noch Einträge, fragt die App: löschen oder behalten (dann nur noch löschbar).
- **Planungsbeginn** (*Verwaltung → Einstellungen*): davor kein Zurückblättern und keine Einträge. Ohne Einstellung geht es zurück bis zu den ersten vorhandenen Daten (bei leerem Plan bis zum aktuellen Monat).

### Geändert
- Die Notiz-Ecke erscheint auch bei Text, der an einem Dienst hängt (vorher nur bei eigenständigen Notizen); ebenso im PDF.

## [0.3.0] – 2026-11-04

### Für alle
- **Vertippt? Einfach rückgängig machen:** Nach jeder Änderung erscheint unten links eine Meldung mit **Rückgängig**. Auch mehrere Änderungen lassen sich einzeln zurücknehmen; **Strg+Z** nimmt die letzte zurück. Frühere Änderungen findest du über **↶** oben rechts.
- **Mehrere Dienste an einem Tag:** bis zu drei, z. B. IV-Dienst und Telefondienst. Im Kalender das Häkchen **zusätzlich eintragen** setzen oder beim Klicken **Strg** gedrückt halten.
- **Mehr Tage auf einen Blick:** Der Kalender nutzt die ganze Bildschirmbreite. Unter *Zeitraum* zeigt **Fensterbreite** so viele Tage, wie hineinpassen.
- **Schrift zu klein?** Oben rechts auf deinen Namen klicken und mit **A−** / **A+** einstellen. Das gilt für dein Konto auf allen Geräten.
- **Jahresübersicht drucken oder als PDF speichern:** im Jahreskalender über **Drucken** bzw. **PDF**.
- **Feiertage und arbeitsfreie Tage** wie Heiligabend oder Rosenmontag sind im Plan farbig markiert.
- **Passwort vergessen?** Auf der Anmeldeseite steht, an wen du dich wenden kannst. Du bekommst dann einen persönlichen Link und legst dein neues Passwort selbst fest.

### Neu
- **Mitarbeiter und Konto in einem Schritt:** beim Anlegen eines Mitarbeiters gleich das Benutzerkonto (und umgekehrt); Spalte „Konto“ in der Mitarbeiterliste mit „+ Konto“.
- **Einrichtungslink statt Startpasswort:** Link mit QR-Code bzw. druckbares Zugangsschreiben; Bestätigung über Personalnummer oder Kürzel, 7 Tage gültig, einmal nutzbar, Sperre nach 5 Fehlversuchen. Ebenso „Link zum Zurücksetzen“ und `cli.js password-link`. Zufallspasswort-Generator für die manuelle Vergabe.
- **Ansprechpartner bei Anmeldeproblemen** einstellbar; erscheint auf der Anmeldeseite („Passwort vergessen?“), bei ungültigen Links und im Zugangsschreiben.
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
