'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const seed = require('./seed-content');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- The five levels of leadership (Mac Lake). Fixed ids 1-5, editable text.
CREATE TABLE IF NOT EXISTS levels (
  id            INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 5),
  name          TEXT NOT NULL,
  focus         TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  typical_roles TEXT NOT NULL DEFAULT ''
);

-- Standards for each level, grouped Be / Know / Do.
CREATE TABLE IF NOT EXISTS competencies (
  id          INTEGER PRIMARY KEY,
  level_id    INTEGER NOT NULL REFERENCES levels(id),
  category    TEXT NOT NULL CHECK (category IN ('Be', 'Know', 'Do')),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS trainings (
  id          INTEGER PRIMARY KEY,
  level_id    INTEGER REFERENCES levels(id),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  format      TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  required    INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0
);

-- Organization tree: church > campus > department > team > group.
CREATE TABLE IF NOT EXISTS areas (
  id          INTEGER PRIMARY KEY,
  parent_id   INTEGER REFERENCES areas(id),
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('church', 'campus', 'department', 'team', 'group')),
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS people (
  id              INTEGER PRIMARY KEY,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  campus_id       INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  level           INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_break', 'inactive')),
  break_until     TEXT,
  last_break_date TEXT,
  joined_date     TEXT,
  external_id     TEXT,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS people_email ON people(email);
CREATE INDEX IF NOT EXISTS people_external ON people(external_id);

-- Where someone serves or leads. role_level = the pipeline level the role requires.
CREATE TABLE IF NOT EXISTS assignments (
  id         INTEGER PRIMARY KEY,
  person_id  INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  area_id    INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  role_level INTEGER NOT NULL DEFAULT 1 CHECK (role_level BETWEEN 1 AND 5),
  frequency  TEXT NOT NULL DEFAULT 'weekly'
             CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'occasional')),
  hours      REAL NOT NULL DEFAULT 2 CHECK (hours >= 0),
  start_date TEXT,
  end_date   TEXT,
  notes      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS assignments_person ON assignments(person_id);
CREATE INDEX IF NOT EXISTS assignments_area ON assignments(area_id);

-- 0 = not yet, 1 = emerging, 2 = developing, 3 = consistent
CREATE TABLE IF NOT EXISTS person_competencies (
  person_id     INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  competency_id INTEGER NOT NULL REFERENCES competencies(id) ON DELETE CASCADE,
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 0 AND 3),
  notes         TEXT NOT NULL DEFAULT '',
  assessed_by   TEXT NOT NULL DEFAULT '',
  assessed_at   TEXT NOT NULL,
  PRIMARY KEY (person_id, competency_id)
);

CREATE TABLE IF NOT EXISTS person_trainings (
  person_id    INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  training_id  INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('assigned', 'in_progress', 'completed')),
  completed_at TEXT,
  PRIMARY KEY (person_id, training_id)
);

CREATE TABLE IF NOT EXISTS apprenticeships (
  id            INTEGER PRIMARY KEY,
  leader_id     INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  apprentice_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  area_id       INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  target_level  INTEGER NOT NULL CHECK (target_level BETWEEN 1 AND 5),
  start_date    TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'stopped')),
  notes         TEXT NOT NULL DEFAULT ''
);

-- capacity: 1 = running on empty ... 5 = plenty of margin
CREATE TABLE IF NOT EXISTS checkins (
  id               INTEGER PRIMARY KEY,
  person_id        INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  date             TEXT NOT NULL,
  conducted_by     TEXT NOT NULL DEFAULT '',
  capacity         INTEGER CHECK (capacity BETWEEN 1 AND 5),
  spiritual_health INTEGER CHECK (spiritual_health BETWEEN 1 AND 5),
  notes            TEXT NOT NULL DEFAULT '',
  next_steps       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS checkins_person ON checkins(person_id, date);

CREATE TABLE IF NOT EXISTS level_history (
  id         INTEGER PRIMARY KEY,
  person_id  INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  from_level INTEGER,
  to_level   INTEGER NOT NULL,
  date       TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL DEFAULT ''
);
`;

const DEFAULT_SETTINGS = {
  church_name: 'Vantage Point Church',
  max_active_roles: '3',
  max_leader_roles: '2',
  max_weekly_roles: '2',
  max_monthly_hours: '20',
  max_span_of_care: '10',
  checkin_interval_days: '90',
  low_capacity_score: '2',
  max_months_without_break: '12',
};

// node:sqlite cannot bind undefined or booleans and rejects unknown named
// parameters, so bind exactly the names each statement uses.
const paramNames = new Map();
function namesIn(sql) {
  if (!paramNames.has(sql)) {
    const stripped = sql.replace(/'(?:[^']|'')*'/g, '');
    paramNames.set(sql, [...new Set([...stripped.matchAll(/[:@$]([A-Za-z_]\w*)/g)].map((m) => m[1]))]);
  }
  return paramNames.get(sql);
}

function bind(sql, params) {
  if (params == null || typeof params !== 'object' || Array.isArray(params)) return [params];
  const names = namesIn(sql);
  if (!names.length) return [];
  const out = {};
  for (const k of names) {
    const v = params[k];
    out[k] = v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  return [out];
}

class Database {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
    this.seedDefaults();
  }

  all(sql, params = {}) {
    return this.db.prepare(sql).all(...bind(sql, params)).map((r) => ({ ...r }));
  }

  get(sql, params = {}) {
    const row = this.db.prepare(sql).get(...bind(sql, params));
    return row ? { ...row } : null;
  }

  run(sql, params = {}) {
    const r = this.db.prepare(sql).run(...bind(sql, params));
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  }

  exec(sql) {
    this.db.exec(sql);
  }

  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close() {
    this.db.close();
  }

  seedDefaults() {
    this.transaction(() => {
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        this.run('INSERT OR IGNORE INTO settings (key, value) VALUES (:key, :value)', { key, value });
      }
      const hasLevels = this.get('SELECT COUNT(*) AS n FROM levels').n > 0;
      if (hasLevels) return;
      for (const level of seed.levels) {
        this.run(
          `INSERT INTO levels (id, name, focus, description, typical_roles)
           VALUES (:id, :name, :focus, :description, :typical_roles)`,
          level,
        );
        level.competencies.forEach(([category, name, description], i) => {
          this.run(
            `INSERT INTO competencies (level_id, category, name, description, sort)
             VALUES (:level_id, :category, :name, :description, :sort)`,
            { level_id: level.id, category, name, description, sort: i },
          );
        });
        level.trainings.forEach(([title, description, format, required], i) => {
          this.run(
            `INSERT INTO trainings (level_id, title, description, format, required, sort)
             VALUES (:level_id, :title, :description, :format, :required, :sort)`,
            { level_id: level.id, title, description, format, required, sort: i },
          );
        });
      }
      if (this.get('SELECT COUNT(*) AS n FROM areas').n === 0) {
        this.run("INSERT INTO areas (name, kind) VALUES (:name, 'church')", {
          name: DEFAULT_SETTINGS.church_name,
        });
      }
    });
  }

  settings() {
    const out = {};
    for (const row of this.all('SELECT key, value FROM settings')) out[row.key] = row.value;
    return out;
  }
}

function openDatabase(file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'pipeline.db')) {
  return new Database(file);
}

module.exports = { openDatabase, Database, DEFAULT_SETTINGS };
