# Installation und Konfiguration

## Kurz: npm oder Docker?

| | **Docker** (empfohlen für den Betrieb) | **npm** |
|---|---|---|
| Wofür | dauerhafter, öffentlich erreichbarer Betrieb | Ausprobieren, Entwicklung, oder wenn Docker nicht erlaubt ist |
| HTTPS | automatisch (Caddy ist dabei) | selbst einrichten (Caddy/nginx) |
| Neustart nach Absturz/Reboot | automatisch | selbst einrichten (systemd) |
| Backups | automatisch täglich | automatisch, wenn `BACKUP_DIR` gesetzt ist |
| Updates | `git pull` + ein Befehl | `git pull` + Build + Neustart |
| Abhängigkeiten auf dem Server | nur Docker | Node.js 22 |

**Empfehlung: Docker** auf einem kleinen Linux-Server. Ein einziger Befehl startet App und HTTPS-Proxy, Neustarts und Backups laufen automatisch, und
der Server bleibt sauber, weil alles im Container steckt. Mit **npm** probierst du die App auf dem eigenen PC aus und entwickelst sie weiter.

Inhalt:

1. [Voraussetzungen](#1-voraussetzungen)
2. [Installation mit Docker (empfohlen)](#2-installation-mit-docker-empfohlen)
3. [Ersteinrichtung in der App](#3-ersteinrichtung-in-der-app)
4. [Betrieb: Updates, Backups, Passwort vergessen](#4-betrieb)
5. [Variante: bereits vorhandener Reverse-Proxy](#5-variante-bereits-vorhandener-reverse-proxy-nginx-traefik)
6. [Installation ohne Docker (npm + systemd)](#6-installation-ohne-docker-npm--systemd)
7. [Lokal ausprobieren / entwickeln](#7-lokal-ausprobieren--entwickeln)
8. [Referenz: alle Einstellungen](#8-referenz)
9. [Fehlerbehebung](#9-fehlerbehebung)
10. [Sicherheits-Checkliste](#10-sicherheits-checkliste)

---

## 1. Voraussetzungen

**Server**
- Linux-Server (VPS) mit **Debian 12** oder **Ubuntu 22.04/24.04**, x64 oder ARM64
- Ressourcen: 1 vCPU, 1–2 GB RAM und 10 GB Speicher reichen für einige Hundert Benutzer
- Standort in der EU (Datenschutz, siehe [Konzept, Kapitel 7](KONZEPT.md#7-wichtig-vor-einem-echten-einsatz)), z. B. bei Hetzner, netcup oder IONOS
- Ports **80** und **443** müssen aus dem Internet erreichbar sein (für HTTPS-Zertifikate und Zugriff)

**Domain**
- Eine (Sub-)Domain, z. B. `plan.example.de`
- Beim Domain-Anbieter einen **A-Eintrag** (IPv4) und, wenn vorhanden, einen **AAAA-Eintrag** (IPv6) auf die IP des Servers setzen
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

> Hinweis: Docker veröffentlichte Ports an `ufw` vorbei. Deshalb lauscht die App in der mitgelieferten Konfiguration
> nur auf `127.0.0.1:3000`; nach außen erreichbar ist nur Caddy auf 80/443.

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

Mindestens diese Werte anpassen:

```ini
DOMAIN=plan.example.de          # deine Domain (DNS muss schon auf den Server zeigen)
ADMIN_PASSWORD=EinLangesStartPasswort   # nur beim allerersten Start; danach in der App ändern
```

Alle weiteren Werte haben sinnvolle Vorgaben (siehe [Referenz](#8-referenz)). Danach die Datei schützen:

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
# app    … Up … (healthy)
# caddy  … Up …

docker compose logs app | grep "Erster Start"
# === Erster Start: Benutzer "admin" angelegt, Passwort: (aus ADMIN_PASSWORD) ===

docker compose logs caddy | grep -i "certificate obtained"
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

### 3.1 Einstellungen

*Verwaltung → Einstellungen*

| Einstellung | Bedeutung | Empfehlung |
|---|---|---|
| Bundesland | bestimmt die angezeigten gesetzlichen Feiertage | Bundesland des Betriebs |
| Recht aller Benutzer auf alle Teams | Grundstufe für jeden angemeldeten Benutzer | **ansehen**: jeder sieht den Gesamtplan; „kein Zugriff“, wenn Teams sich nicht sehen sollen |
| Recht auf das eigene Team | gilt automatisch für das Team des verknüpften Mitarbeiters | **bearbeiten**: entspricht „jeder Mitarbeiter kann im eigenen Team ändern“ |

### 3.2 Abteilungen und Teams

*Verwaltung → Abteilungen & Teams*: zuerst Abteilungen anlegen, darin die Teams. Die Reihenfolge der Teams im Kalender folgt dieser Struktur.

### 3.3 An- und Abwesenheitsarten

*Verwaltung → An-/Abwesenheitsarten*: Vorbelegt sind übliche Dienste (F, S, N, T, B), Anwesenheiten (HO, DR, FB) und Abwesenheiten (U, FA, SU, K, KK).
Diese Werte am besten an die bisherigen Kürzel aus schichtplaner.de anpassen, damit sich niemand umgewöhnen muss.

- **Kategorie**: entscheidet, wo der Eintrag in der Tagesübersicht erscheint (*Im Dienst*, *Sonstige Anwesenheit* oder *Abwesend*). Nur Dienste zählen zur Besetzungszahl.
- **Beginn/Ende**: Standardzeiten (pro Eintrag überschreibbar)
- **zählt als Urlaub**: geht in das Urlaubskonto im Jahreskalender ein
- **vertraulich**: z. B. Krank. Klartext sehen nur Benutzer, die das Team bearbeiten dürfen, und der Mitarbeiter selbst; alle anderen sehen „abwesend“
- Nicht mehr benötigte Arten auf **inaktiv** setzen statt sie zu löschen; alte Einträge bleiben dann lesbar.

### 3.4 Mitarbeiter

*Verwaltung → Mitarbeiter → + Mitarbeiter*: Name, Kürzel, Team, Urlaubsanspruch. Ausgeschiedene Mitarbeiter auf **inaktiv** setzen;
sie verschwinden aus dem Plan, ihre Historie bleibt erhalten.

### 3.5 Benutzer und Rechte

*Verwaltung → Benutzer & Rechte → + Benutzer*

1. **Benutzername** (z. B. `vorname.nachname`), **Anzeigename**, **Startpasswort**
2. **Verknüpfter Mitarbeiter**: daraus ergibt sich das „eigene Team“
3. Optional **zusätzliche Berechtigungen** anlegen

Die Startpasswörter gibst du persönlich weiter. Bei der ersten Anmeldung muss jeder ein eigenes Passwort vergeben.

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

Jeder Benutzer kann im Menü **Ansichten** die aktuelle Auswahl speichern (Ansicht + Teamfilter) und eine davon als **Standardansicht**
festlegen; sie öffnet sich nach der Anmeldung. Administratoren können Ansichten **für alle freigeben**, z. B. „Leitstelle gesamt“.

### 3.7 Als App installieren (PWA)

- **Android (Chrome):** Seite öffnen → Menü ⋮ → *App installieren* bzw. *Zum Startbildschirm hinzufügen*
- **iPhone/iPad (Safari):** Teilen-Symbol → *Zum Home-Bildschirm*
- **Windows/macOS (Chrome/Edge):** Installieren-Symbol rechts in der Adressleiste

---

## 4. Betrieb

Alle Befehle im Verzeichnis `/opt/schichtplaner` ausführen.

### 4.1 Status und Logs

```bash
docker compose ps                    # läuft alles? app sollte "(healthy)" zeigen
docker compose logs -f app           # Logs der App live ansehen (Strg+C beendet)
docker compose logs --since 1h caddy # HTTPS/Proxy-Logs der letzten Stunde
docker compose restart app           # App neu starten
docker compose down                  # alles stoppen (Daten bleiben erhalten)
docker compose up -d                 # wieder starten
```

### 4.2 Updates

```bash
cd /opt/schichtplaner
docker compose exec app node server/dist/cli.js backup /data/backups/vor-update.db   # Sicherheitskopie
git pull
docker compose up -d --build
docker image prune -f                # alte Images aufräumen
```

Die Datenbank wird beim Start automatisch auf das neue Schema gebracht. Die Unterbrechung dauert nur wenige Sekunden;
offene Browser verbinden sich selbst neu (der Punkt oben rechts ist kurz rot, dann wieder grün).

Docker-Images (Node, Caddy) gelegentlich aktualisieren:

```bash
docker compose pull caddy && docker compose build --pull app && docker compose up -d
```

### 4.3 Backups

**Automatisch:** Die App sichert die Datenbank etwa eine Minute nach dem Start und danach alle 24 Stunden nach
`/data/backups` im Docker-Volume. Aufbewahrt werden die letzten `BACKUP_KEEP` Sicherungen (Standard 14).

```bash
docker compose exec app ls -lh /data/backups
```

**Manuell** (im laufenden Betrieb möglich, die Kopie ist konsistent):

```bash
docker compose exec app node server/dist/cli.js backup /data/backups/manuell-$(date +%F).db
```

**Wichtig – Sicherungen vom Server wegkopieren.** Liegen die Backups nur auf dem Server, helfen sie bei einem Serverausfall nicht. Die
Backups lassen sich auf den Server-Rechner kopieren und von dort z. B. per `rsync`/`scp` abholen:

```bash
mkdir -p backups
docker compose cp app:/data/backups/. ./backups/
# vom eigenen PC aus:
scp -r benutzer@plan.example.de:/opt/schichtplaner/backups ./schichtplaner-backups
```

Optional per Cron automatisieren (`crontab -e`, täglich 3:30 Uhr):

```cron
30 3 * * * cd /opt/schichtplaner && mkdir -p backups && docker compose cp app:/data/backups/. ./backups/ >/dev/null 2>&1
```

**Wiederherstellen:**

```bash
docker compose stop app
docker compose run --rm --no-deps app node server/dist/cli.js restore /data/backups/<datei>.db
docker compose start app
```

Der bisherige Stand wird dabei vorsichtshalber als `/data/schichtplaner.db.vor-wiederherstellung.db` gesichert.
Eine Sicherung vom eigenen PC zurückspielen: erst mit `docker compose cp ./datei.db app:/data/backups/` in den Container kopieren.

### 4.4 Passwort vergessen / ausgesperrt

Ein Administrator setzt Passwörter normalerweise in der App zurück (*Benutzer bearbeiten → Neues Passwort*).
Ist kein Administrator mehr erreichbar, geht es über die Kommandozeile auf dem Server:

```bash
docker compose exec app node server/dist/cli.js list-users
docker compose exec app node server/dist/cli.js reset-password admin             # zufälliges Passwort
docker compose exec app node server/dist/cli.js reset-password admin NeuesPw123  # festes Passwort
docker compose exec app node server/dist/cli.js create-admin notfall-admin       # zusätzlichen Admin anlegen
```

Nach zu vielen Fehlversuchen ist eine Anmeldung 5 Minuten gesperrt; `docker compose restart app` hebt die Sperre sofort auf.

### 4.5 Wo liegen die Daten?

| Was | Wo |
|---|---|
| Datenbank | Docker-Volume `schichtplaner_data` → `/data/schichtplaner.db` im Container |
| Automatische Backups | dasselbe Volume → `/data/backups/` |
| HTTPS-Zertifikate | Docker-Volume `schichtplaner_caddy` |
| Konfiguration | `/opt/schichtplaner/.env` |

> Achtung: `docker compose down -v` löscht die Volumes und damit **alle Daten**. Nur `docker compose down` verwenden.

---

## 5. Variante: bereits vorhandener Reverse-Proxy (nginx, Traefik, …)

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

**Traefik**: Router auf den Dienst `app`, Port 3000; Traefik reicht Server-Sent Events ohne weitere Einstellungen durch.

Der Proxy muss `X-Forwarded-For` setzen (`TRUST_PROXY=true`, Standard). Nur so sieht die App die echte IP, die die Sperre bei
Fehlversuchen beim Anmelden braucht.

---

## 6. Installation ohne Docker (npm + systemd)

Für Server, auf denen Docker nicht erlaubt ist. Getestet unter Debian/Ubuntu; Windows Server funktioniert grundsätzlich ebenfalls, die
Dienst-Einrichtung (z. B. mit NSSM) ist hier aber nicht beschrieben.

### 6.1 Node.js 22 installieren

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node -v    # v22.x
```

### 6.2 Eigener Systembenutzer, Code und Build

```bash
sudo useradd --system --create-home --home-dir /opt/schichtplaner --shell /usr/sbin/nologin schichtplaner
sudo -u schichtplaner git clone https://github.com/wasserkasten/schichtplaner.git /opt/schichtplaner/app
cd /opt/schichtplaner/app
sudo -u schichtplaner npm ci
sudo -u schichtplaner npm run build
sudo -u schichtplaner mkdir -p /opt/schichtplaner/data /opt/schichtplaner/backups
```

### 6.3 Konfiguration

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

### 6.4 systemd-Dienst

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

### 6.5 HTTPS mit Caddy

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

Alternativ nginx + certbot mit der Konfiguration aus [Kapitel 5](#5-variante-bereits-vorhandener-reverse-proxy-nginx-traefik).

### 6.6 Betrieb ohne Docker

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

## 7. Lokal ausprobieren / entwickeln

Voraussetzung: [Node.js 22](https://nodejs.org/) (Windows, macOS oder Linux) und Git.

```bash
git clone https://github.com/wasserkasten/schichtplaner.git
cd schichtplaner
npm ci
npm run seed      # optional: Demodaten, Logins admin / anna / ben, Passwort "demo1234"
npm run dev       # startet API (Port 3000) und Oberfläche (Port 5173)
```

Dann <http://localhost:5173> öffnen. Änderungen am Code werden sofort übernommen.

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsmodus mit automatischem Neuladen |
| `npm run seed` | Demodaten in eine **leere** Datenbank schreiben |
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

## 8. Referenz

### 8.1 Umgebungsvariablen der App

| Variable | Bedeutung | Standard |
|---|---|---|
| `PORT` | HTTP-Port der App | `3000` |
| `HOST` | Netzwerkadresse, auf der die App lauscht | `0.0.0.0` |
| `DB_FILE` | Pfad der SQLite-Datenbank | `server/data/schichtplaner.db` (Docker: `/data/schichtplaner.db`) |
| `STATIC_DIR` | Verzeichnis der gebauten Oberfläche | `web/dist` |
| `SECURE_COOKIES` | Anmelde-Cookie nur über HTTPS senden; im Internet **immer `true`** | `false` (Docker: `true`) |
| `TRUST_PROXY` | `X-Forwarded-For` vom vorgeschalteten Proxy übernehmen; `false`, wenn die App ohne Proxy direkt erreichbar ist | `true` |
| `ADMIN_PASSWORD` | Passwort des ersten Benutzers `admin`, nur wenn noch kein Benutzer existiert | zufällig, steht im Log |
| `BACKUP_DIR` | Verzeichnis für tägliche automatische Sicherungen; leer = keine | leer (Docker: `/data/backups`) |
| `BACKUP_KEEP` | Anzahl aufbewahrter automatischer Sicherungen | `14` |
| `TZ` | Zeitzone für Logs und Zeitstempel der Sicherungsdateien | Systemzeit (Docker: `Europe/Berlin`) |

### 8.2 Zusätzliche Werte in `.env` (nur Docker Compose)

| Variable | Bedeutung | Standard |
|---|---|---|
| `DOMAIN` | Domain, für die Caddy das HTTPS-Zertifikat holt | `localhost` |
| `COMPOSE_PROFILES` | `caddy` = mitgelieferten HTTPS-Proxy starten; leer = nur die App | `caddy` |
| `APP_BIND` | Adresse:Port, unter der die App auf dem Server erreichbar ist | `127.0.0.1:3000` |

### 8.3 Einstellungen in der App

*Verwaltung → Einstellungen*: Bundesland, Grundrecht für alle, Recht auf das eigene Team (siehe [3.1](#31-einstellungen)).
Die Einstellungen stehen in der Datenbank und sind damit Teil jeder Sicherung.

### 8.4 Kommandozeilenwerkzeug

Aufruf: Docker `docker compose exec app node server/dist/cli.js <befehl>`, ohne Docker `node server/dist/cli.js <befehl>`
(mit gesetztem `DB_FILE`).

| Befehl | Wirkung |
|---|---|
| `backup <datei>` | konsistente Sicherung im laufenden Betrieb |
| `restore <datei>` | Sicherung zurückspielen (**App vorher stoppen**), bisheriger Stand wird vorher gesichert |
| `list-users` | alle Benutzer anzeigen |
| `reset-password <benutzer> [passwort]` | Passwort setzen, Benutzer aktivieren, alle Sitzungen beenden |
| `create-admin <benutzer> [passwort]` | zusätzlichen Administrator anlegen |

### 8.5 Netzwerk

| Port | Dienst | von außen erreichbar? |
|---|---|---|
| 80/tcp | Caddy (Umleitung auf HTTPS, Zertifikatsprüfung) | ja |
| 443/tcp+udp | Caddy (HTTPS, HTTP/3) | ja |
| 3000/tcp | App | nein (nur `127.0.0.1`) |

Health-Check für Monitoring (z. B. Uptime Kuma): `https://plan.example.de/api/health` liefert `{"ok":true}`.

---

## 9. Fehlerbehebung

| Problem | Ursache / Lösung |
|---|---|
| Browser meldet Zertifikatsfehler, Caddy-Log zeigt `challenge failed` | DNS zeigt noch nicht auf den Server, oder Port 80/443 ist gesperrt (Firewall, auch die des Hosters). `nslookup`, `sudo ufw status` und `docker compose logs caddy` prüfen |
| Anmeldung scheint zu klappen, man landet aber wieder beim Login | Zugriff über `http://` bei `SECURE_COOKIES=true`. Über `https://` aufrufen, oder für reine Tests `SECURE_COOKIES=false` setzen |
| Punkt oben rechts bleibt rot, Änderungen anderer erscheinen erst nach Neuladen | Ein Proxy puffert `/api/events`. Bei nginx `proxy_buffering off` setzen (siehe [Kapitel 5](#5-variante-bereits-vorhandener-reverse-proxy-nginx-traefik)) |
| „Zu viele Fehlversuche“ | 5 Minuten warten oder `docker compose restart app` |
| Admin-Passwort vergessen | [4.4](#44-passwort-vergessen--ausgesperrt) |
| `docker compose up` meldet `port is already allocated` | Port 80/443 ist schon belegt (z. B. Apache/nginx). Den Dienst beenden oder [Kapitel 5](#5-variante-bereits-vorhandener-reverse-proxy-nginx-traefik) nutzen |
| `app` ist `unhealthy` | `docker compose logs app` lesen; häufig ist der Speicher voll (`df -h`) |
| Nach einem Update fehlen neue Funktionen im Browser | Die App aktualisiert sich als PWA beim nächsten Laden selbst; notfalls einmal Strg+F5 |
| `npm ci` meldet `node-gyp`/Python-Fehler | Die Projektdatei `.npmrc` (mit `ignore-scripts=true`) fehlt oder wird übergangen. Sie muss im Projektordner liegen; die benötigten Binärdateien bringt `better-sqlite3` für Linux, macOS und Windows (x64/ARM64) mit. Auf anderen Plattformen (z. B. 32-Bit-ARM) muss es mit `npm rebuild better-sqlite3 --ignore-scripts=false` kompiliert werden (braucht Python und C++-Compiler) |

---

## 10. Sicherheits-Checkliste

- [ ] Zugriff nur über **HTTPS**, `SECURE_COOKIES=true`
- [ ] Startpasswort des `admin` geändert, `ADMIN_PASSWORD` aus `.env` entfernt
- [ ] Mindestens zwei Administratoren, aber nicht mehr als nötig
- [ ] Firewall aktiv, nur 22/80/443 offen; SSH nur mit Schlüssel (`PasswordAuthentication no`)
- [ ] Automatische Sicherheitsupdates des Servers (`sudo apt install unattended-upgrades`)
- [ ] Backups werden regelmäßig **vom Server weg** kopiert, und eine Wiederherstellung wurde einmal ausprobiert
- [ ] Ausgeschiedene Mitarbeiter: Benutzer auf *inaktiv*, Mitarbeiter auf *inaktiv*
- [ ] Freigabe von Arbeitgeber, Betriebsrat und Datenschutz liegt vor ([Konzept, Kapitel 7](KONZEPT.md#7-wichtig-vor-einem-echten-einsatz))
