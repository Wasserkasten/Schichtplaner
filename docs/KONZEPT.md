# Schichtplaner – Konzept

Stand: November 2026 · Hobbyprojekt, angelehnt an die gewohnte Arbeitsweise von schichtplaner.de
(Tabelle Mitarbeiter × Tage), aber schneller, mehrbenutzerfähig und von überall erreichbar.

## 1. Ziele

| Anforderung | Umsetzung |
|---|---|
| Persönliche Konten statt Team-Sammelkonten | Jeder Mitarbeiter bekommt einen eigenen Benutzer, verknüpft mit seinem Eintrag im Plan |
| Änderungen nachvollziehbar | Jede Änderung landet mit Benutzer, Zeitpunkt, Vorher/Nachher im Änderungsprotokoll; pro Zelle als „Verlauf“ abrufbar |
| Granulare Rechte | Stufen *ansehen / bearbeiten / verwalten* je Team, je Abteilung oder global |
| Vordefinierte An-/Abwesenheiten + Freitext | Administrierbare Eintragsarten (Kürzel, Farbe, Zeiten); zusätzlich Freitext-Einträge für alle mit Bearbeitungsrecht |
| Mehrere Ansichten, Standardansicht konfigurierbar | Kalender, Tagesübersicht, Jahreskalender; Filter als „Ansicht“ speicherbar, eine davon als persönliche Standardansicht |
| Öffentlich erreichbar, PC zuerst, mobil vorgesehen | Web-App mit HTTPS, Desktop-optimiert, responsiv, als PWA installierbar |
| Gleichzeitige Bearbeitung | Live-Aktualisierung aller offenen Pläne, Konflikterkennung pro Eintrag |

## 2. Fachliches Modell

```
Abteilung ─┬─ Team ─┬─ Mitarbeiter ──(0..1)── Benutzerkonto ── Berechtigungen
           │        │        │
           │        │        └─ Planeintrag (Tag, Eintragsart und/oder Freitext, optional Uhrzeiten)
           │        │
Eintragsart (Dienst | sonstige Anwesenheit | Abwesenheit)
```

* **Mitarbeiter ≠ Benutzer.** Ein Mitarbeiter kann im Plan stehen, ohne ein Konto zu haben
  (z. B. während der Umstellung). Ein Konto kann ohne Mitarbeiter existieren (z. B. Personalabteilung).
* **Mehrere Einträge pro Tag** sind erlaubt, z. B. „F“ + Notiz „Arzttermin 10 Uhr“.
* **Eintragsarten** (vorbelegt, frei änderbar):
  Dienste F/S/N/T/B · Anwesenheit Homeoffice, Dienstreise, Fortbildung ·
  Abwesenheit Urlaub, Freizeitausgleich, Sonderurlaub, Krank, Kind krank.
  Eigenschaften: Kürzel, Farbe, Standardzeiten, „zählt als Urlaub“, „vertraulich“.
* **Feiertage** werden je Bundesland berechnet (einstellbar) und im Plan markiert.

## 3. Berechtigungen

Die effektive Stufe je Team ist das **Maximum** aus:

1. Grundstufe für alle angemeldeten Benutzer (Einstellung, Standard: *ansehen*)
2. Stufe für das eigene Team (Einstellung, Standard: *bearbeiten*) – „jeder Mitarbeiter kann im eigenen Team ändern“
3. Explizite Freigaben je Benutzer auf **Team**, **Abteilung** oder **alle** – z. B. Teamleitung darf zusätzlich Team X bearbeiten
4. Administratoren: alles

| Stufe | darf |
|---|---|
| ansehen | Plan lesen; vertrauliche Abwesenheiten erscheinen nur als „abwesend“ |
| bearbeiten | Einträge anlegen/ändern/löschen, Verlauf sehen |
| verwalten | zusätzlich Mitarbeiter des Teams anlegen/ändern |
| Administrator | Struktur, Benutzer, Rechte, Eintragsarten, Einstellungen, Gesamtprotokoll |

## 4. Ansichten

* **Kalender** (Hauptansicht wie bisher): links Mitarbeiter gruppiert nach Team, oben Tage mit KW,
  Wochenenden/Feiertage/Heute hervorgehoben, Besetzungszahl je Team und Tag.
  - *Auswahlmodus*: Klick auf Zelle öffnet Dialog (Einträge, Freitext, Uhrzeiten, Zeitraum „bis“, Verlauf).
  - *Pinsel*: Eintragsart wählen, dann Zellen anklicken oder ein Rechteck aufziehen – schnelles Planen
    ganzer Wochen/Teams. „Leeren“ entfernt Einträge.
  - Zeitraum: Monat, 7/14 Tage, 4/6 Wochen.
* **Tag**: Wer hat welchen Dienst (nach Dienstart, mit Zeiten)? Wer ist sonst anwesend? Wer fehlt?
  Notizen, Mitarbeiter ohne Eintrag. Ideal fürs Handy.
* **Jahr**: pro Mitarbeiter 12 Monate × 31 Tage, Auswertung je Eintragsart, Urlaubskonto (verplant/Rest).
* **Gespeicherte Ansichten**: Ansichtstyp + Teamfilter (+ Mitarbeiter/Zeitraum) unter einem Namen,
  eine davon als Standardansicht beim Start; Administratoren können Ansichten für alle freigeben.
* Ansichten sind per URL verlinkbar (`#/tag/2026-11-02`, `#/jahr/2026-01-01/5`).

## 5. Gleichzeitiges Arbeiten

* **Live-Aktualisierung** per Server-Sent Events: Änderungen erscheinen sofort bei allen, die den
  betroffenen Zeitraum offen haben – gefiltert/maskiert nach den Rechten des jeweiligen Empfängers.
* **Optimistische Sperre**: jeder Eintrag hat eine Versionsnummer. Wer einen veralteten Stand speichert,
  bekommt eine Konfliktmeldung und sieht den aktuellen Stand, statt fremde Änderungen zu überschreiben.
* Pinsel-Aktionen laufen als eine Transaktion.
* Bei Verbindungsabbruch verbindet sich der Client neu und lädt die offenen Zeiträume nach
  (grüner/roter Punkt oben rechts).

## 6. Technik

| Baustein | Wahl | Begründung |
|---|---|---|
| Frontend | React + TypeScript + Vite | verbreitet, schnell, gute Tabellen-Performance |
| PWA | vite-plugin-pwa (Manifest + Service Worker) | installierbar auf Handy/PC; Plan-Daten werden bewusst nicht offline gecacht |
| Backend | Node.js + Fastify + Zod | schlank, schnell, Validierung aller Eingaben |
| Datenbank | SQLite (WAL-Modus) | eine Datei, keine Wartung, problemlos für Hunderte Benutzer bei diesem Lastprofil; Umstieg auf PostgreSQL bei Bedarf möglich |
| Live-Updates | Server-Sent Events | einfacher als WebSockets, funktioniert durch Proxys |
| Auth | Benutzername/Passwort (scrypt), HttpOnly-Session-Cookie, Sperre nach Fehlversuchen | ohne externe Abhängigkeiten; SSO (z. B. Microsoft Entra ID) später nachrüstbar |
| Betrieb | Docker + Caddy (automatisches HTTPS) | ein kleiner VPS (z. B. 2 GB RAM) genügt |

## 7. Wichtig vor einem echten Einsatz

Das ist ein privates Projekt mit Daten des Arbeitgebers – das sollte vor einem Einsatz geklärt sein:

* **Freigabe durch den Arbeitgeber / IT** – insbesondere für öffentliches Hosting.
* **Betriebsrat/Personalrat**: Ein System, das Änderungen personenbezogen protokolliert, ist eine technische
  Einrichtung, die zur Verhaltens-/Leistungskontrolle geeignet ist (§ 87 Abs. 1 Nr. 6 BetrVG bzw. Personalvertretungsrecht) –
  in der Regel mitbestimmungspflichtig.
* **Datenschutz (DSGVO)**: Krankmeldungen sind Gesundheitsdaten (Art. 9). Deshalb gibt es die Eigenschaft
  „vertraulich“; zu klären sind außerdem Hosting-Standort (EU), Auftragsverarbeitungsvertrag mit dem Hoster,
  Löschfristen für Plan- und Protokolldaten, Backups.
* **Sicherheit**: HTTPS ist Pflicht (Caddy), starke Passwörter, regelmäßige Updates; mittelfristig 2FA oder SSO.

## 8. Fahrplan

**Erledigt (Version 0.1 – dieser Stand)**
- Datenmodell, Rechte, Änderungsprotokoll, Feiertage
- Kalender mit Pinsel, Zell-Dialog mit Verlauf, Tages- und Jahresansicht, gespeicherte Ansichten
- Verwaltung: Abteilungen/Teams, Mitarbeiter, Benutzer & Rechte, Eintragsarten, Einstellungen, Protokoll
- Live-Aktualisierung, Konflikterkennung, PWA, Docker-Betrieb

**Als Nächstes**
1. Import der bisherigen Daten aus schichtplaner.de (CSV/Excel-Export) und Export (Excel/PDF/Druckansicht)
2. Tastaturbedienung im Kalender (Pfeiltasten + Kürzel tippen, wie in einer Tabellenkalkulation), Kopieren/Einfügen
3. Mobile Kalenderansicht (Wochenliste pro Person statt breiter Tabelle), „Mein Plan“ als Startseite auf dem Handy
4. Mindestbesetzung je Team/Dienst mit Warnung bei Unterschreitung
5. Urlaubsanträge mit Genehmigung durch Teamleitung
6. Kalender-Abo (iCal) für den eigenen Dienstplan, Benachrichtigungen (E-Mail/Push) bei Planänderungen
7. Dienst-Rhythmen/Vorlagen (z. B. F-F-S-S-N-N-frei-frei) automatisch eintragen
8. SSO / 2-Faktor-Anmeldung, Backups automatisieren
