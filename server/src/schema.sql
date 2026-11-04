-- Schichtplaner Datenbankschema (SQLite)
-- Struktur: Abteilung (department) -> Team -> Mitarbeiter (employee)
-- Benutzerkonten (users) sind optional 1:1 mit Mitarbeitern verknüpft.

CREATE TABLE IF NOT EXISTS departments (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS teams (
  id             INTEGER PRIMARY KEY,
  department_id  INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (department_id, name)
);

CREATE TABLE IF NOT EXISTS employees (
  id           INTEGER PRIMARY KEY,
  team_id      INTEGER NOT NULL REFERENCES teams(id),
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  short_name   TEXT,                       -- Kürzel, z.B. "MMU"
  personnel_no TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  vacation_days_per_year REAL NOT NULL DEFAULT 30,
  entry_date   TEXT,                       -- Eintritt (ISO), davor keine Einträge
  exit_date    TEXT                        -- Austritt (ISO), danach keine Einträge
);

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name   TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  employee_id    INTEGER UNIQUE REFERENCES employees(id) ON DELETE SET NULL,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  font_scale     REAL NOT NULL DEFAULT 1,      -- persönliche Schriftgröße (1 = 100 %)
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Granulare Berechtigungen. Geltungsbereich: ein Team, eine Abteilung oder alles.
--   level: 'view' (ansehen), 'edit' (Einträge bearbeiten), 'manage' (Mitarbeiter/Team verwalten)
-- Zusätzlich gilt: Wer einem Mitarbeiter zugeordnet ist, bekommt automatisch
-- die in settings.own_team_level hinterlegte Stufe für das eigene Team.
CREATE TABLE IF NOT EXISTS grants (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL CHECK (scope IN ('team','department','all')),
  scope_id      INTEGER,                   -- team.id / department.id, NULL bei 'all'
  level         TEXT NOT NULL CHECK (level IN ('view','edit','manage')),
  UNIQUE (user_id, scope, scope_id)
);

-- Vordefinierte An- und Abwesenheitsarten (Dienste, Urlaub, Krank, ...)
CREATE TABLE IF NOT EXISTS entry_types (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,        -- Kurzzeichen im Plan, z.B. "F", "U"
  name        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('shift','presence','absence')),
  color       TEXT NOT NULL DEFAULT '#cccccc',
  text_color  TEXT NOT NULL DEFAULT '#000000',
  start_time  TEXT,                        -- "06:00"
  end_time    TEXT,                        -- "14:00"
  counts_as_vacation INTEGER NOT NULL DEFAULT 0,
  sensitive   INTEGER NOT NULL DEFAULT 0,  -- z.B. Krank: nur mit 'edit'-Recht im Klartext sichtbar
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

-- Planeinträge. Pro Mitarbeiter und Tag sind mehrere Einträge möglich
-- (z.B. Dienst + Notiz). Entweder type_id oder text (Freitext) muss gesetzt sein.
CREATE TABLE IF NOT EXISTS entries (
  id           INTEGER PRIMARY KEY,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,              -- ISO "YYYY-MM-DD"
  type_id      INTEGER REFERENCES entry_types(id),
  text         TEXT,
  start_time   TEXT,
  end_time     TEXT,
  version      INTEGER NOT NULL DEFAULT 1, -- optimistische Sperre
  created_by   INTEGER REFERENCES users(id),
  updated_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (type_id IS NOT NULL OR (text IS NOT NULL AND length(text) > 0))
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE INDEX IF NOT EXISTS idx_entries_emp_date ON entries(employee_id, date);

-- Änderungsprotokoll: jede Änderung ist einem Benutzer zuordenbar.
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY,
  ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_id     INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,               -- create / update / delete
  entity      TEXT NOT NULL,               -- entry / employee / user / ...
  entity_id   INTEGER,
  employee_id INTEGER,                     -- für schnelle Historie pro Zelle
  date        TEXT,
  before_json TEXT,
  after_json  TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_cell ON audit_log(employee_id, date);

-- Gespeicherte Ansichten (Filter + Ansichtstyp), eine davon als Standardansicht.
CREATE TABLE IF NOT EXISTS saved_views (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  config_json TEXT NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  shared      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings(key, value) VALUES ('own_team_level', 'edit');
INSERT OR IGNORE INTO settings(key, value) VALUES ('holiday_state', 'NW');

-- Feiertage und betrieblich arbeitsfreie Tage (bearbeitbar).
-- from_source = 1: aus der eingebauten Quelle übernommen und seitdem nicht geändert.
CREATE TABLE IF NOT EXISTS holidays (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'public' CHECK (kind IN ('public','company')),
  from_source INTEGER NOT NULL DEFAULT 0
);
-- Jahre, die bereits eingerichtet sind (werden nicht erneut automatisch befüllt).
CREATE TABLE IF NOT EXISTS holiday_years (
  year INTEGER PRIMARY KEY
);

-- Einrichtungs- und Zurücksetz-Links für Passwörter (Token nur als Hash gespeichert).
-- secret_kind: welches bekannte Merkmal beim Öffnen abgefragt wird (Personalnummer oder Kürzel des verknüpften Mitarbeiters).
CREATE TABLE IF NOT EXISTS password_tokens (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('setup','reset')),
  secret_kind TEXT CHECK (secret_kind IN ('personnel_no','short_name')),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0
);
