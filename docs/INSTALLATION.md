# Installation und Konfiguration

## Kurz: npm oder Docker?

| | **Docker** (empfohlen für den Betrieb) | **npm** |
|---|---|---|
| Wofür | dauerhafter, öffentlich erreichbarer Betrieb | Ausprobieren, Entwicklung, oder wenn Docker nicht erlaubt ist |
| HTTPS | automatisch (Caddy **oder** Cloudflare Tunnel ist dabei) | selbst einrichten (Caddy/nginx/cloudflared) |
| Neustart nach Absturz/Reboot | automatisch | selbst einrichten (systemd) |
| Backups | automatisch (Zeitplan in der App) | ebenso; Ordner `backups` neben der Datenbank oder `BACKUP_DIR` |
| Updates | `git pull` + ein Befehl | `git pull` + Build + Neustart |
| Abhängigkeiten auf dem Server | nur Docker | Node.js 22 |

**Empfehlung: Docker** auf einem kleinen Linux-Server. Ein einziger Befehl startet App und HTTPS-Proxy, Neustarts und Backups laufen automatisch, und
der Server bleibt sauber, weil alles im Container steckt. Mit **npm** probierst du die App auf dem eigenen PC aus und entwickelst sie weiter.

**Zugang aus dem Internet** – eine der beiden mitgelieferten Varianten wählen:

| | **Cloudflare Tunnel** | **Caddy** |
|---|---|---|
| Geeignet, wenn … | die Domain bei Cloudflare liegt bzw. Cloudflare Tunnel ohnehin genutzt wird | Cloudflare nicht genutzt werden soll |
| Offene Ports am Server/Router | **keine** | 80 und 443 |
| Funktioniert auch zu Hause hinter einem Router ohne feste IP | ja | nur mit Portfreigabe und DynDNS |
| HTTPS-Zertifikat | macht Cloudflare | holt Caddy automatisch |
| Einrichtung | Tunnel im Cloudflare-Dashboard anlegen, Token in `.env` | Domain in `.env`, DNS-Eintrag setzen |
| Anleitung | [Kapitel 5](#5-variante-cloudflare-tunnel) | [Kapitel 2](#2-installation-mit-docker-empfohlen) (Standard) |

Den **Port** der App (Standard 3000) änderst du in `.env` mit `APP_BIND`, siehe [Port ändern](#port-ändern).

Inhalt:

1. [Voraussetzungen](#1-voraussetzungen)
2. [Installation mit Docker (empfohlen)](#2-installation-mit-docker-empfohlen)
3. [Ersteinrichtung in der App](#3-ersteinrichtung-in-der-app)
4. [Betrieb: Updates, Backups, Passwort vergessen](#4-betrieb)
5. [Variante: Cloudflare Tunnel (statt Caddy)](#5-variante-cloudflare-tunnel)
6. [Variante: bereits vorhandener Reverse-Proxy](#6-variante-bereits-vorhandener-reverse-proxy-nginx-traefik)
7. [Installation ohne Docker (npm + systemd)](#7-installation-ohne-docker-npm--systemd)
8. [Lokal ausprobieren / entwickeln](#8-lokal-ausprobieren--entwickeln)
9. [Referenz: alle Einstellungen](#9-referenz)
10. [Fehlerbehebung](#10-fehlerbehebung)
11. [Sicherheits-Checkliste](#11-sicherheits-checkliste)

---

## 1. Voraussetzungen

**Server**
- Linux-Server (VPS) mit **Debian 12** oder **Ubuntu 22.04/24.04**, x64 oder ARM64
- Ressourcen: 1 vCPU, 1–2 GB RAM und 10 GB Speicher reichen für einige Hundert Benutzer
- Standort in der EU (Datenschutz, siehe [Konzept, Kapitel 7](KONZEPT.md#7-wichtig-vor-einem-echten-einsatz)), z. B. bei Hetzner, netcup oder IONOS
- Mit **Caddy**: Ports **80** und **443** müssen aus dem Internet erreichbar sein (für HTTPS-Zertifikate und Zugriff)
- Mit **Cloudflare Tunnel**: keine offenen Ports nötig; der Server muss nur selbst ins Internet kommen

**Domain**
- Eine (Sub-)Domain, z. B. `plan.example.de`
- Mit **Cloudflare Tunnel**: Die Domain wird bei Cloudflare verwaltet; den DNS-Eintrag legt Cloudflare selbst an, die beiden folgenden Punkte entfallen
- Mit **Caddy**: beim Domain-Anbieter einen **A-Eintrag** (IPv4) und, wenn vorhanden, einen **AAAA-Eintrag** (IPv6) auf die IP des Servers setzen
- Prüfen (vom eigenen PC): `nslookup plan.example.de` muss die Server-IP liefern

**Zugang**
- SSH-Zugang zum Server mit einem Benutzer, der `sudo` darf

---

## 2. Installation mit Docker (empfohlen)

### 2.1 Server vorbereiten

```bash
# System aktualisieren
sudo apt update && sudo apt upgrade -y

# Firewall: nur SSH, HTTP und HTTPS zulassen
sudo apt install -y ufw git
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp      # HTTP/3, optional
sudo ufw enable
```

Mit **Cloudflare Tunnel** die drei Zeilen für 80/443 weglassen; dann ist außer SSH nichts offen.

> Hinweis: Docker veröffentlicht Ports an `ufw` vorbei. Deshalb lauscht die App in der mitgelieferten Konfiguration
> nur auf `127.0.0.1` und ist damit aus dem Internet nicht direkt erreichbar. Von außen erreichbar ist nur Caddy auf 80/443 – mit Cloudflare Tunnel gar nichts.

### 2.2 Docker installieren

Offizielles Installationsskript (Debian/Ubuntu):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER     # Docker ohne sudo nutzen
# einmal ab- und wieder anmelden, dann prüfen:
docker version
docker compose version             # muss v2 oder neuer sein
```

### 2.3 Schichtplaner herunterladen

```bash
sudo mkdir -p /opt/schichtplaner && sudo chown $USER: /opt/schichtplaner
git clone https://github.com/wasserkasten/schichtplaner.git /opt/schichtplaner
cd /opt/schichtplaner
```

Ist das Repository privat, verlangt GitHub beim Klonen eine Anmeldung. Als Passwort einen
[Personal Access Token](https://github.com/settings/tokens) mit Leserecht auf das Repository verwenden, oder auf dem Server einen
*Deploy Key* (nur Lesen) einrichten und per `git@github.com:wasserkasten/schichtplaner.git` klonen.

### 2.4 Konfigurieren

```bash
cp .env.example .env
nano .env
```

Mindestens diese Werte anpassen – **mit Caddy**:

```ini
ADMIN_PASSWORD=EinLangesStartPasswort   # nur beim allerersten Start; danach in der App ändern
COMPOSE_PROFILES=caddy
DOMAIN=plan.example.de                  # deine Domain (DNS muss schon auf den Server zeigen)
```

**Mit Cloudflare Tunnel** stattdessen `COMPOSE_PROFILES=cloudflare` und `CLOUDFLARE_TUNNEL_TOKEN=…`. Wie du an das Token kommst,
steht in [Kapitel 5](#5-variante-cloudflare-tunnel).

#### Port ändern

Die App belegt auf dem Server standardmäßig Port **3000**. Läuft dort schon etwas anderes (z. B. Dockhand, Grafana oder eine
andere Web-App), bricht `docker compose up` mit `port is already allocated` ab. Dann in `.env` einen freien Port eintragen:

```ini
APP_BIND=127.0.0.1:3001
```

- Die Zahl hinter dem Doppelpunkt ist der Port auf dem Server; jeder freie Port geht (z. B. `3001` oder `8080`).
- `127.0.0.1` heißt: nur vom Server selbst erreichbar. Das ist richtig für Caddy und Cloudflare Tunnel und verhindert, dass
  jemand am Proxy vorbei direkt auf die App zugreift.
- **Innerhalb von Docker bleibt die App immer auf Port 3000.** Caddy und der mitgelieferte cloudflared sprechen sie über
  `http://schichtplaner:3000` an; daran ändert `APP_BIND` nichts, dort ist also nichts weiter anzupassen.
- Welche Ports schon belegt sind, zeigt `sudo ss -tlnp` (Spalte *Local Address*).

Nach einer Änderung: `docker compose up -d`.

Alle weiteren Werte haben sinnvolle Vorgaben (siehe [Referenz](#9-referenz)). Danach die Datei schützen:

```bash
chmod 600 .env
```

### 2.5 Starten

```bash
docker compose up -d --build
```

Beim ersten Mal dauert das einige Minuten, weil das Image gebaut wird. Danach prüfen:

```bash
docker compose ps
# app          … Up … (healthy)
# caddy        … Up …        (bzw. cloudflared … Up … bei Cloudflare Tunnel)

docker compose logs app | grep "Erster Start"
# === Erster Start: Benutzer "admin" angelegt, Passwort: (aus ADMIN_PASSWORD) ===

docker compose logs caddy | grep -i "certificate obtained"                 # nur bei Caddy
docker compose logs cloudflared | grep -i "registered tunnel connection"   # nur bei Cloudflare
```

Ohne `ADMIN_PASSWORD` erzeugt die App ein zufälliges Passwort und schreibt es in die Logs (`docker compose logs app`).

### 2.6 Erste Anmeldung

1. `https://plan.example.de` im Browser öffnen
2. Mit Benutzer **admin** und dem Startpasswort anmelden
3. Die App verlangt sofort ein neues, eigenes Passwort (mindestens 8 Zeichen)
4. Weiter mit der [Ersteinrichtung](#3-ersteinrichtung-in-der-app)

> Nach der ersten Anmeldung kann `ADMIN_PASSWORD` aus der `.env` gelöscht werden. Die App verwendet es nur, solange noch kein Benutzer existiert.

---

## 3. Ersteinrichtung in der App

Alles Folgende geschieht im Browser unter **Verwaltung** (nur für Administratoren sichtbar). Empfohlene Reihenfolge:

> **Erst einmal nur ausprobieren?** Mit [Beispieldaten](#39-beispieldaten-zum-ausprobieren) ist der Plan in einem Klick gefüllt
> und lässt sich danach genauso schnell wieder leeren.

### 3.1 Einstellungen

*Verwaltung → Einstellungen*

| Einstellung | Bedeutung | Empfehlung |
|---|---|---|
| Bundesland | Quelle für die gesetzlichen Feiertage (Anpassungen unter *Feiertage*, siehe [3.8](#38-feiertage-und-arbeitsfreie-tage)) | Bundesland des Betriebs – **vor** dem Anpassen der Feiertage einstellen |
| Planungsbeginn | frühestes Datum im Plan: davor kein Zurückblättern und keine Einträge. Leer = automatisch bis zu den ersten vorhandenen Daten (bei leerem Plan bis zum aktuellen Monat) | leer lassen; setzen, wenn ältere Monate gezielt nachgetragen werden sollen bzw. ausgeschlossen sein sollen |
| Recht aller Benutzer auf alle Teams | Grundstufe für jeden angemeldeten Benutzer | **ansehen**: jeder sieht den Gesamtplan; „kein Zugriff“, wenn Teams sich nicht sehen sollen |
| Recht auf das eigene Team | gilt automatisch für das Team des verknüpften Mitarbeiters | **bearbeiten**: entspricht „jeder Mitarbeiter kann im eigenen Team ändern“ |
| Hilfe bei Anmeldeproblemen | Ansprechpartner (Name/Stelle, Telefon, E-Mail, Hinweis) für vergessene Passwörter und abgelaufene Links; erscheint öffentlich auf der Anmeldeseite und im Zugangsschreiben | z. B. Leitstelle mit Durchwahl – keine privaten Nummern |

### 3.2 Abteilungen und Teams

*Verwaltung → Abteilungen & Teams*: zuerst Abteilungen anlegen, darin die Teams. Die Reihenfolge der Teams im Kalender folgt dieser Struktur.

### 3.3 An- und Abwesenheitsarten

*Verwaltung → An-/Abwesenheitsarten*: Vorbelegt sind übliche Dienste (F, S, N, T, B), Anwesenheiten (HO, DR, FB) und Abwesenheiten (U, FA, SU, K, KK).
Diese Werte am besten an die bisherigen Kürzel aus schichtplaner.de anpassen, damit sich niemand umgewöhnen muss.

- **Kategorie**: entscheidet, wo der Eintrag in der Tagesübersicht erscheint (*Im Dienst*, *Sonstige Anwesenheit* oder *Abwesend*).
- **Beginn/Ende**: Standardzeiten (pro Eintrag überschreibbar)
- **zählt als Urlaub**: geht in das Urlaubskonto im Jahreskalender ein
- **vertraulich**: z. B. Krank. Klartext sehen nur Benutzer, die das Team bearbeiten dürfen, und der Mitarbeiter selbst; alle anderen sehen „abwesend“
- Nicht mehr benötigte Arten auf **inaktiv** setzen statt sie zu löschen; alte Einträge bleiben dann lesbar.

**Notizen:** Im Zell-Dialog unter *Neuer Eintrag* Text in „Freitext / Notiz“ eingeben – mit gewählter Art hängt der Text
an diesem Dienst, mit „– nur Freitext –“ ist es eine eigene Notiz. In beiden Fällen zeigt die **gelbe Ecke** in der Zelle,
dass es Text gibt (Text beim Darüberfahren); eine Notiz ganz ohne Dienst steht direkt in der Zelle.

**Mehrere Dienste an einem Tag:** Ein Mitarbeiter kann an einem Tag bis zu **3** Dienste bzw. An-/Abwesenheiten haben, z. B.
IV-Dienst und Telefondienst (dieselbe Art nicht doppelt; Notizen zählen nicht mit). Dafür die Arten hier anlegen und im Kalender:

- im Zell-Dialog unter *Neuer Eintrag* hinzufügen – an einem einzelnen Tag wird standardmäßig **zusätzlich** eingetragen,
  über einen Zeitraum (z. B. Urlaub) werden vorhandene Dienste ersetzt; beides lässt sich mit dem Häkchen umschalten, oder
- mit dem Pinsel bei gesetztem Häkchen **„zusätzlich eintragen“** bzw. mit **Strg** (Mac: ⌘) beim Klicken.

Tage, die schon voll sind oder die Art bereits haben, werden dabei übersprungen (mit Hinweis).

### 3.4 Mitarbeiter

*Verwaltung → Mitarbeiter → + Mitarbeiter*: Name, Kürzel, Team, Urlaubsanspruch, **Eintritt** und **Austritt** (beide optional).

- Vor dem Eintritt und nach dem Austritt ist **nichts eintragbar**; der Mitarbeiter erscheint im Kalender und in der
  Tagesübersicht nur in Zeiträumen, in denen er beschäftigt ist. Im Jahreskalender und im PDF sind die Tage grau.
- Wird ein Austritt (oder Eintritt) so geändert, dass vorhandene Einträge außerhalb liegen, fragt die App:
  **löschen** oder **behalten** – behaltene bleiben sichtbar, lassen sich aber nur noch löschen.
- **inaktiv** blendet einen Mitarbeiter dagegen komplett aus (auch rückwirkend); seine Historie bleibt erhalten.
  Für Ausgeschiedene ist das Austrittsdatum meist die bessere Wahl, weil der Plan bis zum letzten Tag sichtbar bleibt.

### 3.5 Benutzer und Rechte

Mitarbeiter und Benutzerkonten gehören normalerweise paarweise zusammen; beides lässt sich in einem Schritt anlegen:

- *Verwaltung → Mitarbeiter → + Mitarbeiter*: Häkchen **„Benutzerkonto gleich mit anlegen“** (Benutzername wird als
  `vorname.nachname` vorgeschlagen).
- *Verwaltung → Mitarbeiter*: in der Spalte **Konto** bei Mitarbeitern ohne Konto **+ Konto** – ein Klick.
- *Verwaltung → Benutzer & Rechte → + Benutzer*: **„neuen Mitarbeiter gleich mit anlegen“** oder einen vorhandenen verknüpfen.
  Ohne verknüpften Mitarbeiter (z. B. Personalabteilung) gibt es kein „eigenes Team“.

Konten mit Mitarbeiter-Verknüpfung können nur Administratoren anlegen; Teamverwalter legen nur Mitarbeiter an.

**Passwort – empfohlen: Einrichtungslink.** Statt ein Passwort zu vergeben, erzeugt die App einen persönlichen Link:

1. Nach dem Anlegen erscheint der Link mit **QR-Code**. Weitergeben per **Link kopieren** (Chat, Teams …) oder
   **Zugangsschreiben drucken** (A4 mit Name, Benutzername, QR-Code, Anleitung und Ansprechpartner).
2. Der Kollege öffnet den Link, bestätigt sich mit seiner **Personalnummer** (falls hinterlegt, sonst dem **Kürzel**)
   und legt **selbst** ein Passwort fest – danach ist er angemeldet. Du erfährst das Passwort nie.
3. Der Link gilt **7 Tage**, ist **einmal** verwendbar und nach **5** falschen Eingaben gesperrt. In der Benutzerliste
   steht so lange „Einrichtung offen“.

Ohne Personalnummer und Kürzel gibt es keine Rückfrage – dann den Link nur persönlich übergeben. Alternativ lässt sich
ein **Startpasswort** festlegen (Knopf **🎲 Zufällig** erzeugt ein gut lesbares), das bei der ersten Anmeldung geändert
werden muss.

**Passwort vergessen:** *Benutzer bearbeiten → 🔗 Link zum Zurücksetzen erstellen* – gleicher Ablauf, ein älterer Link
wird ungültig. Wen Kollegen dafür ansprechen sollen, steht auf der Anmeldeseite unter „Passwort vergessen?“
(einstellbar unter *Einstellungen → Hilfe bei Anmeldeproblemen*).

Typische Konfigurationen:

| Rolle | Verknüpfter Mitarbeiter | Zusätzliche Berechtigungen |
|---|---|---|
| Mitarbeiter | ja | keine (eigenes Team bearbeiten, Rest ansehen, über die Einstellungen) |
| Teamleitung | ja | eigenes Team: *verwalten*; ggf. Nachbarteam: *bearbeiten* |
| Abteilungsleitung | ja/nein | Abteilung X: *verwalten* |
| Personalabteilung | nein | Alle: *bearbeiten* |
| Nur-Lesen (z. B. Pforte) | nein | keine, liest über die Grundstufe; bei Grundstufe „kein Zugriff“: einzelne Teams auf *ansehen* |
| Administrator | beliebig | Haken „Administrator“ |

Rechtestufen: **ansehen** (Plan lesen) < **bearbeiten** (Einträge ändern, Verlauf sehen) < **verwalten** (zusätzlich Mitarbeiter des Teams pflegen).
Es gilt immer die höchste zutreffende Stufe.

> Tipp: Mindestens **zwei** Administratoren anlegen, damit nie jemand ausgesperrt ist.

### 3.6 Ansichten

Jeder Benutzer kann im Menü **Ansichten** die aktuelle Auswahl speichern (Ansicht + Teamfilter + Zeitraum) und eine davon als
**Standardansicht** festlegen; sie öffnet sich nach der Anmeldung. Administratoren können Ansichten **für alle freigeben**, z. B. „Leitstelle gesamt“.

Der Kalender nutzt immer die volle Fensterbreite. Als **Zeitraum** gibt es *Monat*, 7/14 Tage, 4/6 Wochen und **Fensterbreite** –
dann werden so viele Tage gezeigt, wie nebeneinander passen (auf einem 1920-px-Bildschirm etwa 50), ab Montag der aktuellen Woche.

**Schriftgröße:** im Benutzermenü oben rechts mit **A−** / **A+** (90 % bis 175 %, Klick auf die Prozentzahl = 100 %). Die Einstellung
gehört zum Benutzerkonto und gilt damit auf allen Geräten – auch, wenn sich mehrere Kollegen einen PC teilen.

### 3.7 Als App installieren (PWA)

- **Android (Chrome):** Seite öffnen → Menü ⋮ → *App installieren* bzw. *Zum Startbildschirm hinzufügen*
- **iPhone/iPad (Safari):** Teilen-Symbol → *Zum Home-Bildschirm*
- **Windows/macOS (Chrome/Edge):** Installieren-Symbol rechts in der Adressleiste

### 3.8 Feiertage und arbeitsfreie Tage

*Verwaltung → Feiertage*

**Woher kommen die Feiertage?** Die App berechnet die gesetzlichen Feiertage selbst – feste Termine und die beweglichen
Feiertage über die Osterformel, jeweils passend zum Bundesland aus den *Einstellungen*. Dafür ist keine Internetverbindung nötig.
Jedes Jahr wird beim ersten Aufruf automatisch damit befüllt; danach gilt, was in dieser Liste steht.

Es gibt zwei Arten von Tagen; beide werden im Plan markiert und im Jahreskalender nicht als Urlaubstag gezählt:

| Art | Farbe im Plan | Beispiele |
|---|---|---|
| **Feiertag** | orange | gesetzliche Feiertage |
| **arbeitsfrei** | grün | betrieblich freie Tage ohne gesetzlichen Status: Heiligabend, Silvester, Rosenmontag, Betriebsruhe |

Möglichkeiten:

- **Aus Quelle übernehmen …** zeigt für das gewählte Jahr alles, was die eingebaute Quelle anbietet, mit Häkchen zum Auswählen:
  - *Gesetzliche Feiertage* des Bundeslandes (fehlende sind vorausgewählt)
  - *Regionale Feiertage*, die nur in Teilen gelten, z. B. Mariä Himmelfahrt oder Augsburger Friedensfest in Bayern, Fronleichnam in Teilen Sachsens und Thüringens
  - *Häufig arbeitsfreie Tage*: Weiberfastnacht, Rosenmontag, Faschingsdienstag, Heiligabend, Silvester – werden als „arbeitsfrei“ übernommen

  Steht am selben Datum schon ein anderer Eintrag, wird er beim Übernehmen ersetzt (der Dialog weist darauf hin).
- **+ Tag hinzufügen** für eigene Tage, z. B. „Betriebsruhe“ zwischen den Jahren oder einen Betriebsausflug.
- **Bearbeiten** und **Löschen** für jeden Eintrag. Gelöschte Feiertage kommen nicht von selbst zurück.

Die Liste gilt für alle Abteilungen gemeinsam. Rosenmontag usw. jedes Jahr neu übernehmen, da sich das Datum ändert.

> **Bundesland wechseln:** Die unveränderten gesetzlichen Feiertage werden in allen bereits eingerichteten Jahren durch die des
> neuen Bundeslandes ersetzt. Eigene, geänderte und arbeitsfreie Tage bleiben erhalten.

### 3.9 Beispieldaten zum Ausprobieren

*Verwaltung → Einstellungen → Beispieldaten → **Beispieldaten einfügen***

Angelegt werden **zusätzlich** zu vorhandenen Daten:

| Was | Inhalt |
|---|---|
| Abteilungen und Teams | *Beispiel Nord* und *Beispiel Süd* mit je *Meisterei 1* und *Meisterei 2* (gleichnamige Teams in zwei Abteilungen), *Beispiel Verwaltung* mit *Disposition* und *Werkstatt* |
| Mitarbeiter | 20, mit Planeinträgen vom vorigen bis zum nächsten Monat: Schichtrhythmus F-F-S-S-N-N-frei-frei, Tagdienst, Homeoffice, Bereitschaft, Urlaub, Krankheit, Fortbildung, Notizen |
| Beispielkonten (Passwort jeweils `demo1234`) | `demo.mitarbeiter`: darf das eigene Team bearbeiten<br>`demo.teamleitung`: verwaltet das eigene Team und bearbeitet ein Nachbarteam<br>`demo.leser`: nur ansehen, kein eigenes Team – sieht Krankmeldungen nur als „abwesend“ |

Mit den Beispielkonten lässt sich gut ausprobieren, wie die Rechte wirken: zwei Browser (oder ein privates Fenster) öffnen und mit
unterschiedlichen Konten anmelden. Änderungen erscheinen im jeweils anderen Fenster sofort.

**Entfernen:** an derselben Stelle **Beispieldaten entfernen**. Gelöscht werden genau die Beispiel-Abteilungen, -Teams, -Mitarbeiter,
ihre Planeinträge und die Beispielkonten; eigene Daten bleiben unverändert. Hast du einen eigenen Mitarbeiter in ein Beispiel-Team
(oder ein eigenes Team in eine Beispiel-Abteilung) verschoben, bricht das Entfernen mit einem Hinweis ab, statt ihn mitzulöschen.

Dasselbe geht über die Kommandozeile:

```bash
docker compose exec app node server/dist/cli.js demo           # einfügen
docker compose exec app node server/dist/cli.js demo-remove    # entfernen
```

Nach dem Einfügen per Kommandozeile die Seite im Browser einmal neu laden.

> Für den echten Betrieb die Beispielkonten nicht stehen lassen: Ihr Passwort ist öffentlich bekannt.

### 3.10 Rückgängig, Protokoll und Drucken

**Rückgängig (für alle Benutzer):** Nach jeder eigenen Änderung im Plan erscheint unten links eine Meldung, z. B.
„U eingetragen · Becker, Anna · 11.–13.11.“, mit **↶ Rückgängig**. Mehrere Meldungen können gleichzeitig offen sein,
jede lässt sich einzeln zurücknehmen und danach mit **↷ Wiederholen** wieder anwenden.

- Ältere Änderungen der aktuellen Sitzung: Knopf **↶** oben rechts in der Kopfzeile.
- Tastatur: **Strg+Z** nimmt die letzte Änderung zurück, **Strg+Y** wiederholt sie (Mac: ⌘).
- Ein Pinselstrich über mehrere Tage oder Mitarbeiter ist **eine** Änderung und wird als Ganzes zurückgenommen.
- Hat ein Kollege einen der Einträge inzwischen geändert, wird **nichts** zurückgenommen – die Meldung sagt, wer es war.
  So überschreibt Rückgängig nie die Arbeit anderer.

**Protokoll (Administratoren):** *Verwaltung → Protokoll* listet jede Änderung als eine Zeile in Klartext
(„S eingetragen (statt K) · Hoffmann, David · So 15.11.“, „Mitarbeiter angelegt: …“, „Feiertag gelöscht: …“).
Änderungen über mehrere Tage lassen sich mit **▸ Einzeländerungen** aufklappen. **Verlauf** öffnet den Verlauf der
betroffenen Zelle wie im Kalender, **↶ Rückgängig** nimmt eine Planänderung zurück (auch die anderer Benutzer).
Filter und Suche helfen beim Finden; ältere Einträge über *Ältere laden*.

**Jahresübersicht drucken / als PDF:** im Jahreskalender

- **🖨 Drucken** – Druckansicht auf A4 quer, ohne Bedienelemente. Im Druckdialog kann auch *Als PDF speichern* gewählt werden.
- **⬇ PDF** – fertige PDF-Datei für den gewählten Mitarbeiter.
- **⬇ PDF ganzes Team** – eine Datei mit einer Seite je Mitarbeiter des Teams.

Die PDF enthält Dienste und Abwesenheiten in Farbe, Wochenenden, Feiertage und arbeitsfreie Tage, das Urlaubskonto und
eine Auswertung je Eintragsart. Vertrauliche Arten (z. B. Krank) erscheinen wie im Browser nur für Berechtigte im Klartext.

---

## 4. Betrieb

Alle Befehle im Verzeichnis `/opt/schichtplaner` ausführen.

### 4.1 Status und Logs

```bash
docker compose ps                    # läuft alles? app sollte "(healthy)" zeigen
docker compose logs -f app           # Logs der App live ansehen (Strg+C beendet)
docker compose logs --since 1h caddy # Proxy-Logs der letzten Stunde (bzw. cloudflared)
docker compose restart app           # App neu starten
docker compose down                  # alles stoppen (Daten bleiben erhalten)
docker compose up -d                 # wieder starten
```

### 4.2 Updates

```bash
cd /opt/schichtplaner
docker compose exec app node server/dist/cli.js backup /data/backups/manuell-$(date +%Y%m%d-%H%M%S).db   # Sicherheitskopie (oder in der App: Backups → Jetzt sichern)
git pull
docker compose up -d --build
docker image prune -f                # alte Images aufräumen
```

Welche Version läuft und was sich geändert hat, steht unter *Verwaltung → Info* (Versionsnummer und Changelog).

**Was die Benutzer nach einem Update sehen:**

| Im Changelog der Version steht … | Mitarbeiter | Administratoren |
|---|---|---|
| nur technische Abschnitte (*Neu*, *Geändert*, *Behoben*) | nichts | gelbe Leiste „aktualisiert“ → Changelog |
| ein Abschnitt **Für alle** | gelbe Leiste „Was ist neu?“ mit diesen Punkten, schließbar mit ✕ | ebenso |
| ein Abschnitt **Wichtig** | beim nächsten Start ein Fenster, das nur mit **Verstanden** schließt | ebenso; unter *Verwaltung → Info* steht, wer schon bestätigt hat |

Gelesen bzw. bestätigt wird am Benutzerkonto gespeichert (gilt auf allen Geräten, auch an gemeinsam genutzten PCs).
Wer mehrere Updates verpasst hat, sieht die Neuigkeiten aller verpassten Versionen; neue Konten sehen keine alten.
Über *Benutzermenü → Neuigkeiten* lassen sie sich jederzeit erneut aufrufen. Von außen prüfbar: `https://plan.example.de/api/health`
liefert z. B. `{"ok":true,"version":"0.3.0"}`.

Die Datenbank wird beim Start automatisch auf das neue Schema gebracht. Die Unterbrechung dauert nur wenige Sekunden;
offene Browser verbinden sich selbst neu (der Punkt oben rechts ist kurz rot, dann wieder grün).

Docker-Images (Node, Caddy bzw. cloudflared) gelegentlich aktualisieren:

```bash
docker compose pull --ignore-buildable && docker compose build --pull app && docker compose up -d
```

### 4.3 Backups

*Benutzermenü → ⚙ Verwaltung → Backups* (nur Administratoren)

Eine Sicherung ist eine vollständige Kopie der Datenbank: Plan, Mitarbeiter, Benutzer mit Rechten, Einstellungen und Protokoll.
Sie entsteht im laufenden Betrieb und ist trotzdem konsistent – niemand muss sich abmelden.

**Zeitplan** (Abschnitt *Automatische Sicherung*):

| Einstellung | Möglichkeiten | Standard |
|---|---|---|
| Häufigkeit | Aus · Stündlich (zur gewählten Minute) · Täglich (Uhrzeit) · Wöchentlich (Wochentag + Uhrzeit) | täglich 02:30 Uhr |
| Aufbewahren | Anzahl der automatischen Sicherungen, die behalten werden (ältere werden gelöscht) | 14 (bzw. `BACKUP_KEEP`) |
| Zusätzlicher Speicherort | zweiter Ordner, in den jede Sicherung zusätzlich kopiert wird, z. B. ein eingebundenes NAS | leer |

War der Server zum geplanten Zeitpunkt aus, wird die Sicherung kurz nach dem Start nachgeholt. Die Uhrzeit richtet sich nach `TZ`
(Docker: `Europe/Berlin`).

**Arten von Sicherungen** in der Liste:

| Art | Entsteht durch | Wird automatisch gelöscht? |
|---|---|---|
| automatisch | Zeitplan | ja, nur die neuesten *Aufbewahren* bleiben |
| von Hand | Knopf **Jetzt sichern** | nein |
| vor Einspielen | automatisch, bevor eine Sicherung eingespielt wird | nein |
| hochgeladen | **Sicherung hochladen …** (z. B. vom alten Server) | nein |

Je Sicherung: **⬇** herunterladen, **↺ Einspielen**, **🗑** löschen.

**Einspielen** setzt alle Daten auf den Stand der Sicherung zurück – auch Benutzer, Rechte und Einstellungen; was danach
eingetragen wurde, ist weg. Deshalb legt die App vorher automatisch eine Sicherung „vor Einspielen“ an, mit der sich das
Einspielen wieder rückgängig machen lässt. Angemeldete Benutzer bleiben angemeldet, offene Browser zeigen sofort den
eingespielten Stand. Nicht zurückgesetzt werden der Zeitplan und die Liste der Sicherungen selbst. Sicherungen älterer
Versionen lassen sich ebenfalls einspielen (neuere Felder bleiben dann leer bzw. auf dem Standard).

**Hochladen:** Beim Hochladen prüft die App, ob die Datei eine unbeschädigte Schichtplaner-Datenbank ist. Danach steht sie in
der Liste und kann eingespielt werden – so zieht der Schichtplaner auf einen neuen Server um.

**Wichtig – Sicherungen vom Server wegbringen.** Liegen sie nur auf dem Server, helfen sie bei einem Serverausfall nicht. Möglichkeiten:

- ab und zu eine Sicherung mit **⬇** herunterladen,
- einen **zusätzlichen Speicherort** auf einem anderen Laufwerk/NAS einrichten. Unter Docker muss der Ordner dafür in den
  Container eingebunden werden, in `docker-compose.yml` beim Dienst `app` unter `volumes`:

  ```yaml
      volumes:
        - data:/data
        - /mnt/nas/schichtplaner:/backup-extra     # Ordner auf dem Server : Ordner im Container
  ```

  Die App läuft im Container als Benutzer mit der ID 1000 – der Ordner muss für ihn beschreibbar sein
  (`sudo chown 1000:1000 /mnt/nas/schichtplaner`). Nach `docker compose up -d` in der App als zusätzlichen Speicherort
  `/backup-extra` eintragen. Schlägt das Kopieren fehl
  (z. B. NAS nicht erreichbar), steht das oben auf der Backup-Seite; die Sicherung im Hauptordner ist trotzdem vorhanden.
- oder per Cron abholen (`crontab -e`, täglich 3:30 Uhr):

  ```cron
  30 3 * * * cd /opt/schichtplaner && mkdir -p backups && docker compose cp app:/data/backups/. ./backups/ >/dev/null 2>&1
  ```

**Über die Kommandozeile** (z. B. wenn die App nicht mehr startet):

```bash
docker compose exec app ls -lh /data/backups                                            # Sicherungen anzeigen
docker compose exec app node server/dist/cli.js backup /data/backups/manuell-$(date +%Y%m%d-%H%M%S).db

docker compose stop app                                                                  # Wiederherstellen offline
docker compose run --rm --no-deps app node server/dist/cli.js restore /data/backups/<datei>.db
docker compose start app
```

Beim Wiederherstellen per Kommandozeile wird der bisherige Stand als `/data/schichtplaner.db.vor-wiederherstellung.db` gesichert.

### 4.4 Passwort vergessen / ausgesperrt

Ein Administrator setzt Passwörter normalerweise in der App zurück (*Benutzer bearbeiten → Link zum Zurücksetzen*, siehe [3.5](#35-benutzer-und-rechte)).
Ist kein Administrator mehr erreichbar, geht es über die Kommandozeile auf dem Server:

```bash
docker compose exec app node server/dist/cli.js list-users
docker compose exec -e PUBLIC_URL=https://plan.example.de app node server/dist/cli.js password-link admin   # Link zum Selbst-Festlegen
docker compose exec app node server/dist/cli.js reset-password admin             # zufälliges Passwort
docker compose exec app node server/dist/cli.js reset-password admin NeuesPw123  # festes Passwort
docker compose exec app node server/dist/cli.js create-admin notfall-admin       # zusätzlichen Admin anlegen
```

Nach zu vielen Fehlversuchen ist eine Anmeldung 5 Minuten gesperrt; `docker compose restart app` hebt die Sperre sofort auf.

### 4.5 Wo liegen die Daten?

| Was | Wo |
|---|---|
| Datenbank | Docker-Volume `schichtplaner_data` → `/data/schichtplaner.db` im Container |
| Sicherungen | dasselbe Volume → `/data/backups/` (optional zusätzlich ein eigener Ordner, siehe [4.3](#43-backups)) |
| HTTPS-Zertifikate | Docker-Volume `schichtplaner_caddy` |
| Konfiguration | `/opt/schichtplaner/.env` |

> Achtung: `docker compose down -v` löscht die Volumes und damit **alle Daten**. Nur `docker compose down` verwenden.

**Variante wechseln** (z. B. von Caddy zu Cloudflare): erst `docker compose --profile "*" down`, dann `COMPOSE_PROFILES` in `.env`
ändern und `docker compose up -d`. Ohne `--profile "*"` bliebe der alte Caddy- bzw. cloudflared-Container stehen.

---

## 5. Variante: Cloudflare Tunnel

Mit Cloudflare Tunnel brauchst du **keinen Caddy und keine offenen Ports**. Ein kleines Programm (`cloudflared`) baut von deinem Server
aus eine Verbindung zu Cloudflare auf; Cloudflare stellt die Seite unter deiner Domain per HTTPS bereit und leitet die Anfragen durch
den Tunnel an die App. Das funktioniert auch auf einem Rechner zu Hause hinter einem Router.

```
Browser ──HTTPS──► Cloudflare ◄──Tunnel (ausgehend)── cloudflared ──► schichtplaner:3000
```

Es gibt zwei Wege:

| | **A: eigener Tunnel** (empfohlen) | **B: vorhandenen Tunnel mitnutzen** |
|---|---|---|
| Was läuft | ein zusätzlicher cloudflared-Container, den diese Installation mitbringt | dein bereits laufender cloudflared |
| Aufwand | Tunnel im Dashboard anlegen, Token in `.env` | Route im vorhandenen Tunnel ergänzen, ggf. Container ins Docker-Netz aufnehmen |
| Unabhängigkeit | Schichtplaner und deine anderen Dienste beeinflussen sich nicht | Updates/Neustarts des gemeinsamen cloudflared betreffen alle Dienste |

> **Wichtig:** Dasselbe Tunnel-Token **nicht** für einen zweiten cloudflared verwenden. Cloudflare verteilt die Anfragen dann auf beide
> Container; jeder müsste alle Dienste erreichen, sonst gibt es sporadisch Fehler 502. Für Weg A also einen **neuen** Tunnel anlegen.

Die Bezeichnungen im Cloudflare-Dashboard ändern sich gelegentlich ein wenig; die Abläufe bleiben gleich.

### 5.1 Voraussetzungen

- Cloudflare-Konto, die Domain (z. B. `example.de`) wird bei Cloudflare verwaltet
- Zero Trust ist aktiviert (der kostenlose Tarif genügt); wenn du schon Tunnel nutzt, ist das erledigt
- Docker ist installiert und Schichtplaner heruntergeladen ([2.1](#21-server-vorbereiten) bis [2.3](#23-schichtplaner-herunterladen);
  die Firewall-Freigaben für 80/443 entfallen)

### 5.2 Variante A: eigener Tunnel (empfohlen)

**1. Tunnel anlegen**

1. <https://one.dash.cloudflare.com> öffnen → **Networks** → **Tunnels** → **Create a tunnel**
2. Typ **Cloudflared** wählen, Name z. B. `schichtplaner`, speichern
3. Auf der Seite *Install and run connectors* **Docker** auswählen. Angezeigt wird ein Befehl wie
   `docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token eyJhIjoi…`.
   **Den Befehl nicht ausführen**, sondern nur den langen Teil hinter `--token` kopieren (beginnt mit `eyJ`).
4. **Next** → Route anlegen (je nach Dashboard-Version *Public Hostname* oder *Published application*):

   | Feld | Wert |
   |---|---|
   | Subdomain | `plan` |
   | Domain | `example.de` |
   | Path | leer lassen |
   | Service → Type | `HTTP` |
   | Service → URL | `schichtplaner:3000` |

   Speichern. Den DNS-Eintrag für `plan.example.de` legt Cloudflare selbst an.

   > **Nicht `localhost` eintragen.** cloudflared läuft hier in einem eigenen Container; `localhost` wäre der Container selbst,
   > und Cloudflare meldet dann *Error 502*. Richtig ist immer `schichtplaner:3000` – auch wenn `APP_BIND` einen anderen Port hat.

**2. `.env` einstellen**

```bash
cd /opt/schichtplaner
cp .env.example .env
nano .env
```

```ini
ADMIN_PASSWORD=EinLangesStartPasswort
COMPOSE_PROFILES=cloudflare
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi…            # das kopierte Token, komplett in einer Zeile
APP_BIND=127.0.0.1:3001                      # nur nötig, wenn Port 3000 schon belegt ist (z. B. Dockhand)
```

`DOMAIN` wird bei dieser Variante nicht gebraucht. Danach `chmod 600 .env` (das Token ist ein Passwort).

**3. Starten und prüfen**

```bash
docker compose up -d --build
docker compose ps                       # app (healthy), cloudflared Up
docker compose logs cloudflared | grep -i "registered tunnel connection"
```

Im Cloudflare-Dashboard steht der Tunnel jetzt auf **Healthy**. `https://plan.example.de` öffnen und weiter mit der
[ersten Anmeldung](#26-erste-anmeldung).

> `APP_BIND` hat mit dem Tunnel nichts zu tun – cloudflared spricht die App im Docker-Netz direkt an (`schichtplaner:3000`).
> Der Port auf dem Server ist nur noch für dich da, z. B. für `curl http://127.0.0.1:3001/api/health` auf dem Server selbst.

### 5.3 Variante B: vorhandenen Tunnel nutzen

**1. In `.env` nur die App starten:**

```ini
ADMIN_PASSWORD=EinLangesStartPasswort
COMPOSE_PROFILES=
APP_BIND=127.0.0.1:3001        # freier Port, falls 3000 belegt ist
```

```bash
docker compose up -d --build
```

**2. Route im vorhandenen Tunnel ergänzen:** Dashboard → **Networks** → **Tunnels** → deinen Tunnel → **Edit** → Reiter
*Public Hostname* bzw. *Published application routes* → **Add**: Subdomain `plan`, Domain `example.de`, Type `HTTP`, URL je nachdem,
wie dein cloudflared läuft:

| Dein cloudflared läuft … | Service-URL | Zusätzlich nötig |
|---|---|---|
| als **Docker-Container** (z. B. über Dockhand gestartet) | `schichtplaner:3000` | Container in das Netz `schichtplaner` aufnehmen (siehe unten) |
| **direkt auf dem Server** (installiert per `cloudflared service install`) oder als Container mit `network_mode: host` | `localhost:3001` (Port aus `APP_BIND`) | – |
| auf einem **anderen Rechner** im Netzwerk | `<IP-des-Servers>:3001` | `APP_BIND=0.0.0.0:3001` setzen und den Port per Firewall auf diesen Rechner beschränken |

**3. Nur bei cloudflared als Docker-Container:** Er muss die App über das Docker-Netz `schichtplaner` erreichen können.

```bash
docker ps --filter ancestor=cloudflare/cloudflared --format '{{.Names}}'   # Namen deines Containers herausfinden
docker network connect schichtplaner <name-des-containers>
```

Das hält über Neustarts hinweg, aber **nicht**, wenn der cloudflared-Container neu erstellt wird (z. B. bei einem Image-Update).
Dauerhaft geht es in der Compose-Datei deines cloudflared (bzw. in der Stack-Konfiguration in Dockhand):

```yaml
services:
  cloudflared:
    # … deine bisherige Konfiguration …
    networks: [default, schichtplaner]

networks:
  schichtplaner:
    external: true      # das Netz legt die Schichtplaner-Installation an – sie muss daher zuerst laufen
```

Läuft dein cloudflared mit `network_mode: host`, ist dieser Schritt nicht nötig (siehe Tabelle).

### 5.4 Cloudflare-Einstellungen und Hinweise

- **HTTPS erzwingen:** Dashboard der Domain → *SSL/TLS* → *Edge Certificates* → **Always Use HTTPS** einschalten.
- **Live-Aktualisierung** funktioniert über den Tunnel. Die App sendet alle 25 Sekunden ein Lebenszeichen, damit Cloudflare die
  Verbindung nicht nach 100 Sekunden trennt.
- **Caching:** Cloudflare speichert nur Dateien wie JavaScript und CSS zwischen, keine Plandaten (`/api/…`). Keine Cache-Regeln wie
  *Cache Everything* für diese Domain anlegen.
- **Rocket Loader** (*Speed* → *Optimization*): Bleibt die Seite nach dem Aufruf leer, für diese Domain ausschalten.
- **Echte IP-Adressen:** cloudflared übergibt die Adresse des Besuchers; `TRUST_PROXY=true` (Standard) bleibt deshalb richtig.
- **Optional: Cloudflare Access** kann vor die App eine zusätzliche Anmeldung legen (z. B. Code per E-Mail an Firmenadressen). Das
  erhöht die Sicherheit, bedeutet aber zwei Anmeldungen. Mit dieser App nicht getestet.
- **Datenschutz:** Cloudflare entschlüsselt den Datenverkehr auf seinen Servern und sieht damit die Plandaten im Klartext, auch
  Krankmeldungen. Cloudflare bietet einen Auftragsverarbeitungsvertrag (DPA) an; ob diese Variante beim Arbeitgeber in Ordnung ist,
  gehört zur Freigabe durch Datenschutz und IT ([Konzept, Kapitel 7](KONZEPT.md#7-wichtig-vor-einem-echten-einsatz)).

---

## 6. Variante: bereits vorhandener Reverse-Proxy (nginx, Traefik)

Wenn auf dem Server schon ein Proxy läuft, der HTTPS übernimmt, den mitgelieferten Caddy abschalten. In `.env`:

```ini
COMPOSE_PROFILES=
APP_BIND=127.0.0.1:3000
```

`docker compose up -d --build` startet dann nur die App auf `127.0.0.1:3000`. Läuft der Proxy auf einem anderen Rechner, stattdessen
`APP_BIND=0.0.0.0:3000` setzen und Port 3000 per Firewall auf den Proxy beschränken.

**nginx** – wichtig ist, dass die Live-Verbindung (`/api/events`) nicht gepuffert wird:

```nginx
server {
    listen 443 ssl http2;
    server_name plan.example.de;
    # ssl_certificate … (z. B. von certbot)

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /api/events {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }
}
```

**Traefik** (als Container): dem Docker-Netz `schichtplaner` beitreten, Ziel `http://schichtplaner:3000`; Traefik reicht Server-Sent Events ohne weitere Einstellungen durch.

Der Proxy muss `X-Forwarded-For` setzen (`TRUST_PROXY=true`, Standard). Nur so sieht die App die echte IP, die die Sperre bei
Fehlversuchen beim Anmelden braucht.

---

## 7. Installation ohne Docker (npm + systemd)

Für Server, auf denen Docker nicht erlaubt ist. Getestet unter Debian/Ubuntu; Windows Server funktioniert grundsätzlich ebenfalls, die
Dienst-Einrichtung (z. B. mit NSSM) ist hier aber nicht beschrieben.

### 7.1 Node.js 22 installieren

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node -v    # v22.x
```

### 7.2 Eigener Systembenutzer, Code und Build

```bash
sudo useradd --system --create-home --home-dir /opt/schichtplaner --shell /usr/sbin/nologin schichtplaner
sudo -u schichtplaner git clone https://github.com/wasserkasten/schichtplaner.git /opt/schichtplaner/app
cd /opt/schichtplaner/app
sudo -u schichtplaner npm ci
sudo -u schichtplaner npm run build
sudo -u schichtplaner mkdir -p /opt/schichtplaner/data /opt/schichtplaner/backups
```

### 7.3 Konfiguration

`/etc/schichtplaner.env` anlegen (`sudo nano /etc/schichtplaner.env`, danach `sudo chmod 600 /etc/schichtplaner.env`):

```ini
NODE_ENV=production
TZ=Europe/Berlin
HOST=127.0.0.1
PORT=3000
DB_FILE=/opt/schichtplaner/data/schichtplaner.db
BACKUP_DIR=/opt/schichtplaner/backups
BACKUP_KEEP=14
SECURE_COOKIES=true
ADMIN_PASSWORD=EinLangesStartPasswort
```

### 7.4 systemd-Dienst

`/etc/systemd/system/schichtplaner.service`:

```ini
[Unit]
Description=Schichtplaner
After=network.target

[Service]
User=schichtplaner
WorkingDirectory=/opt/schichtplaner/app
EnvironmentFile=/etc/schichtplaner.env
ExecStart=/usr/bin/node server/dist/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/opt/schichtplaner/data /opt/schichtplaner/backups

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now schichtplaner
sudo systemctl status schichtplaner
journalctl -u schichtplaner -f        # Logs
```

### 7.5 HTTPS mit Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```caddy
plan.example.de {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

Alternativ nginx + certbot mit der Konfiguration aus [Kapitel 6](#6-variante-bereits-vorhandener-reverse-proxy-nginx-traefik),
oder **Cloudflare Tunnel** mit cloudflared direkt auf dem Server: Route wie in [5.3](#53-variante-b-vorhandenen-tunnel-nutzen), Service-URL `localhost:3000`.

### 7.6 Betrieb ohne Docker

```bash
# Update
cd /opt/schichtplaner/app
sudo -u schichtplaner git pull
sudo -u schichtplaner npm ci
sudo -u schichtplaner npm run build
sudo systemctl restart schichtplaner

# Werkzeuge (Backup, Passwort zurücksetzen, …) – DB_FILE muss gesetzt sein
export DB_FILE=/opt/schichtplaner/data/schichtplaner.db
sudo -u schichtplaner DB_FILE=$DB_FILE node server/dist/cli.js list-users
sudo -u schichtplaner DB_FILE=$DB_FILE node server/dist/cli.js reset-password admin

# Wiederherstellen
sudo systemctl stop schichtplaner
sudo -u schichtplaner DB_FILE=$DB_FILE node server/dist/cli.js restore /opt/schichtplaner/backups/<datei>.db
sudo systemctl start schichtplaner
```

---

## 8. Lokal ausprobieren / entwickeln

Voraussetzung: [Node.js 22](https://nodejs.org/) (Windows, macOS oder Linux) und Git.

```bash
git clone https://github.com/wasserkasten/schichtplaner.git
cd schichtplaner
npm ci
npm run seed      # optional: leere Datenbank mit Beispieldaten füllen, Logins admin, demo.mitarbeiter, demo.teamleitung, demo.leser – Passwort "demo1234"
npm run dev       # startet API (Port 3000) und Oberfläche (Port 5173)
```

Ist Port 3000 auf deinem Rechner belegt (z. B. durch Dockhand): `PORT=3001 npm run dev` (Windows PowerShell:
`$env:PORT=3001; npm run dev`). Die Oberfläche bleibt unter <http://localhost:5173> und leitet automatisch an den geänderten Port weiter.

Dann <http://localhost:5173> öffnen. Änderungen am Code werden sofort übernommen.

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsmodus mit automatischem Neuladen |
| `npm run seed` | **leere** Datenbank mit Administrator und Beispieldaten füllen (sonst: [3.9](#39-beispieldaten-zum-ausprobieren)) |
| `npm test` | automatische Tests |
| `npm run typecheck` | TypeScript-Prüfung |
| `npm run build` + `npm start` | Produktionsbuild lokal starten → <http://localhost:3000> |

Die Entwicklungsdatenbank liegt unter `server/data/schichtplaner.db`. Zum Zurücksetzen den Ordner `server/data` löschen.

Docker lokal testen (ohne Domain/HTTPS), `.env`:

```ini
COMPOSE_PROFILES=
APP_BIND=127.0.0.1:3000
ADMIN_PASSWORD=test1234
```

`docker compose up -d --build`, dann <http://localhost:3000> öffnen. Für den Zugriff von anderen Geräten im LAN zusätzlich
`APP_BIND=0.0.0.0:3000` und `SECURE_COOKIES=false` setzen (nur zum Testen!).

---

## 9. Referenz

### 9.1 Umgebungsvariablen der App

| Variable | Bedeutung | Standard |
|---|---|---|
| `PORT` | HTTP-Port der App. Unter Docker **nicht** ändern, dort `APP_BIND` verwenden | `3000` |
| `HOST` | Netzwerkadresse, auf der die App lauscht | `0.0.0.0` |
| `DB_FILE` | Pfad der SQLite-Datenbank | `server/data/schichtplaner.db` (Docker: `/data/schichtplaner.db`) |
| `STATIC_DIR` | Verzeichnis der gebauten Oberfläche | `web/dist` |
| `SECURE_COOKIES` | Anmelde-Cookie nur über HTTPS senden; im Internet **immer `true`** | `false` (Docker: `true`) |
| `TRUST_PROXY` | `X-Forwarded-For` vom vorgeschalteten Proxy übernehmen; `false`, wenn die App ohne Proxy direkt erreichbar ist | `true` |
| `ADMIN_PASSWORD` | Passwort des ersten Benutzers `admin`, nur wenn noch kein Benutzer existiert | zufällig, steht im Log |
| `BACKUP_DIR` | Ordner für Sicherungen (Zeitplan und Verwaltung unter *Verwaltung → Backups*) | Unterordner `backups` neben der Datenbank (Docker: `/data/backups`) |
| `BACKUP_KEEP` | Vorgabe für „Aufbewahren“, solange in der App nichts eingestellt wurde | `14` |
| `TZ` | Zeitzone für Logs und Zeitstempel der Sicherungsdateien | Systemzeit (Docker: `Europe/Berlin`) |

### 9.2 Zusätzliche Werte in `.env` (nur Docker Compose)

| Variable | Bedeutung | Standard |
|---|---|---|
| `COMPOSE_PROFILES` | `caddy` = mitgelieferten HTTPS-Proxy starten · `cloudflare` = mitgelieferten Cloudflare Tunnel starten · leer = nur die App | `caddy` |
| `DOMAIN` | nur Caddy: Domain, für die das HTTPS-Zertifikat geholt wird | `localhost` |
| `CLOUDFLARE_TUNNEL_TOKEN` | nur Cloudflare: Token des Tunnels | leer |
| `APP_BIND` | Adresse:Port, unter der die App **auf dem Server** erreichbar ist; hier den Port ändern, wenn 3000 belegt ist | `127.0.0.1:3000` |

Innerhalb des Docker-Netzes `schichtplaner` ist die App unabhängig von `APP_BIND` immer unter `http://schichtplaner:3000` erreichbar.

### 9.3 Einstellungen in der App

*Verwaltung → Einstellungen*: Bundesland, Grundrecht für alle, Recht auf das eigene Team (siehe [3.1](#31-einstellungen)).
Die Einstellungen stehen in der Datenbank und sind damit Teil jeder Sicherung.

### 9.4 Kommandozeilenwerkzeug

Aufruf: Docker `docker compose exec app node server/dist/cli.js <befehl>`, ohne Docker `node server/dist/cli.js <befehl>`
(mit gesetztem `DB_FILE`).

| Befehl | Wirkung |
|---|---|
| `backup <datei>` | konsistente Sicherung im laufenden Betrieb |
| `restore <datei>` | Sicherung zurückspielen (**App vorher stoppen**), bisheriger Stand wird vorher gesichert |
| `list-users` | alle Benutzer anzeigen |
| `reset-password <benutzer> [passwort]` | Passwort setzen, Benutzer aktivieren, alle Sitzungen beenden |
| `create-admin <benutzer> [passwort]` | zusätzlichen Administrator anlegen |
| `password-link <benutzer>` | Link erzeugen, über den der Benutzer sein Passwort selbst festlegt (`PUBLIC_URL` = Adresse der App) |
| `demo` | [Beispieldaten](#39-beispieldaten-zum-ausprobieren) einfügen |
| `demo-remove` | Beispieldaten wieder vollständig entfernen |

### 9.5 Netzwerk

| Port | Dienst | von außen erreichbar? |
|---|---|---|
| 80/tcp | Caddy (Umleitung auf HTTPS, Zertifikatsprüfung) | ja – nur bei Caddy |
| 443/tcp+udp | Caddy (HTTPS, HTTP/3) | ja – nur bei Caddy |
| 3000/tcp (änderbar mit `APP_BIND`) | App | nein (nur `127.0.0.1`) |
| – | cloudflared: nur **ausgehende** Verbindungen zu Cloudflare | keine eingehenden Ports |

Health-Check für Monitoring (z. B. Uptime Kuma): `https://plan.example.de/api/health` liefert `{"ok":true}`.

---

## 10. Fehlerbehebung

| Problem | Ursache / Lösung |
|---|---|
| Browser meldet Zertifikatsfehler, Caddy-Log zeigt `challenge failed` | DNS zeigt noch nicht auf den Server, oder Port 80/443 ist gesperrt (Firewall, auch die des Hosters). `nslookup`, `sudo ufw status` und `docker compose logs caddy` prüfen |
| Anmeldung scheint zu klappen, man landet aber wieder beim Login | Zugriff über `http://` bei `SECURE_COOKIES=true`. Über `https://` aufrufen, oder für reine Tests `SECURE_COOKIES=false` setzen |
| Punkt oben rechts bleibt rot, Änderungen anderer erscheinen erst nach Neuladen | Ein Proxy puffert `/api/events`. Bei nginx `proxy_buffering off` setzen (siehe [Kapitel 6](#6-variante-bereits-vorhandener-reverse-proxy-nginx-traefik)) |
| „Zu viele Fehlversuche“ | 5 Minuten warten oder `docker compose restart app` |
| Admin-Passwort vergessen | [4.4](#44-passwort-vergessen--ausgesperrt) |
| `docker compose up` meldet `Bind for 0.0.0.0:3000 failed: port is already allocated` | Port 3000 ist schon belegt (z. B. durch Dockhand). In `.env` `APP_BIND=127.0.0.1:3001` setzen, siehe [Port ändern](#port-ändern) |
| `docker compose up` meldet `port is already allocated` für Port 80 oder 443 | Port 80/443 ist schon belegt (z. B. Apache/nginx). Den Dienst beenden, [Cloudflare Tunnel](#5-variante-cloudflare-tunnel) nutzen oder [Kapitel 6](#6-variante-bereits-vorhandener-reverse-proxy-nginx-traefik) |
| cloudflared startet ständig neu, Log: `Provided Tunnel token is not valid` | `CLOUDFLARE_TUNNEL_TOKEN` fehlt oder ist unvollständig kopiert (es ist sehr lang und beginnt mit `eyJ`) |
| Cloudflare zeigt **Error 502 / Bad Gateway** | Der Tunnel läuft, erreicht aber die App nicht. Ursache zeigt `docker compose logs cloudflared \| grep -i error`: `dial tcp [::1]:…` bzw. `127.0.0.1` → Route zeigt auf `localhost`; `first record does not look like a TLS handshake` → Typ steht auf `HTTPS`; `no such host` → cloudflared ist nicht im Netz `schichtplaner`. In der Route muss Type `HTTP` und URL `schichtplaner:3000` stehen. Bei einem vorhandenen cloudflared-Container prüfen, ob er im Netz `schichtplaner` ist ([5.3](#53-variante-b-vorhandenen-tunnel-nutzen)) |
| Cloudflare zeigt **Error 1033** | Für diese Domain ist kein laufender Tunnel verbunden: `docker compose logs cloudflared` prüfen |
| Cloudflare-Fehler 502 **nur manchmal** | Dasselbe Tunnel-Token läuft in zwei cloudflared-Containern; für Schichtplaner einen eigenen Tunnel anlegen ([Kapitel 5](#5-variante-cloudflare-tunnel)) |
| Build bricht ab mit `Cannot find native binding` bzw. `Cannot find module '@rolldown/binding-…'` | npm hat beim Installieren ein optionales Paket übersprungen (meist ein kurzer Netzwerkfehler), und Docker hat diesen unvollständigen Stand zwischengespeichert. Die aktuelle Version erkennt das beim Bauen selbst und installiert neu. Bei einem älteren Stand oder falls es trotzdem auftritt: `git pull`, dann `docker compose build --no-cache app && docker compose up -d` |
| Build meldet `FEHLT: …` und `Binärdatei(en) fehlen` | Auch der zweite Installationsversuch war unvollständig. Netzwerk des Servers prüfen (`curl -I https://registry.npmjs.org`), freien Speicher prüfen (`df -h`), dann erneut bauen. Die Zeile `Plattform: …` zeigt, für welches System gebaut wird |
| `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock` | Der Benutzer ist nicht in der Gruppe `docker`, oder er hat sich danach noch nicht neu angemeldet. `sudo usermod -aG docker $USER`, abmelden und per SSH neu anmelden (prüfen mit `groups`). Alternativ jedem Docker-Befehl `sudo` voranstellen |
| `app` ist `unhealthy` | `docker compose logs app` lesen; häufig ist der Speicher voll (`df -h`) |
| Nach einem Update fehlen neue Funktionen im Browser | Die App aktualisiert sich als PWA beim nächsten Laden selbst; notfalls einmal Strg+F5 |
| `npm ci` meldet `node-gyp`/Python-Fehler | Die Projektdatei `.npmrc` (mit `ignore-scripts=true`) fehlt oder wird übergangen. Sie muss im Projektordner liegen; die benötigten Binärdateien bringt `better-sqlite3` für Linux, macOS und Windows (x64/ARM64) mit. Auf anderen Plattformen (z. B. 32-Bit-ARM) muss es mit `npm rebuild better-sqlite3 --ignore-scripts=false` kompiliert werden (braucht Python und C++-Compiler) |

---

## 11. Sicherheits-Checkliste

- [ ] Zugriff nur über **HTTPS**, `SECURE_COOKIES=true` (bei Cloudflare zusätzlich *Always Use HTTPS*)
- [ ] Startpasswort des `admin` geändert, `ADMIN_PASSWORD` aus `.env` entfernt
- [ ] Mindestens zwei Administratoren, aber nicht mehr als nötig
- [ ] Firewall aktiv, nur 22/80/443 offen (bei Cloudflare Tunnel nur 22); SSH nur mit Schlüssel (`PasswordAuthentication no`)
- [ ] Automatische Sicherheitsupdates des Servers (`sudo apt install unattended-upgrades`)
- [ ] Backups werden regelmäßig **vom Server weg** kopiert, und eine Wiederherstellung wurde einmal ausprobiert
- [ ] Ausgeschiedene Mitarbeiter: Benutzer auf *inaktiv*, Mitarbeiter auf *inaktiv*
- [ ] Beispieldaten entfernt (*Verwaltung → Einstellungen*), damit keine Konten mit bekanntem Passwort bestehen
- [ ] Freigabe von Arbeitgeber, Betriebsrat und Datenschutz liegt vor ([Konzept, Kapitel 7](KONZEPT.md#7-wichtig-vor-einem-echten-einsatz))
