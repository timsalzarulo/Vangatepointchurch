'use strict';

const v = require('../validate');
const auth = require('../auth');
const A = require('../analytics');
const { DEFAULT_SETTINGS } = require('../db');
const { parseCsvObjects, toCsv } = require('../csv');
const { areaPaths, CHILD_KIND } = require('./helpers');
const { FREQUENCIES } = require('./org');
const demo = require('../demo');

const ROLES = ['admin', 'editor', 'viewer'];

// Very small in-memory login throttle: 10 attempts per 15 minutes per IP.
const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(ip, list);
  return list.length >= 10;
}

function userFields(body, { passwordRequired }) {
  const password = v.str(body.password, 'Password', { required: passwordRequired, max: 200 });
  if (password && password.length < 10) throw v.bad('Password must be at least 10 characters.');
  const email = v.str(body.email, 'Email', { required: true, max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw v.bad('Enter a valid email address.');
  return {
    name: v.str(body.name, 'Name', { required: true, max: 100 }),
    email,
    password,
    role: v.oneOf(body.role, 'Role', ROLES, 'viewer'),
  };
}

function parseLevel(value, levels) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
  const s = String(value).toLowerCase().replace(/[^a-z]/g, '');
  const match = levels.find((l) => l.name.toLowerCase().replace(/[^a-z]/g, '') === s);
  return match ? match.id : null;
}

function splitName(full) {
  const [first, ...rest] = String(full).trim().split(/\s+/);
  return [first || '', rest.join(' ')];
}

function normDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Runs fn in a transaction; rolls back instead of committing for dry runs.
function importTransaction(db, dryRun, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec(dryRun ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function register(router, db) {
  const admin = auth.requireRole('admin');
  const editor = auth.requireRole('editor');
  const signedIn = auth.requireRole('viewer');

  // ---- Auth --------------------------------------------------------------
  router.get('/auth/status', (req, res) => {
    res.json({
      needsSetup: db.get('SELECT COUNT(*) AS n FROM users').n === 0,
      user: req.user || null,
      churchName: db.settings().church_name,
    });
  });

  router.post('/auth/setup', (req, res) => {
    if (db.get('SELECT COUNT(*) AS n FROM users').n > 0) throw new v.HttpError(403, 'Setup has already been completed.');
    const f = userFields({ ...req.body, role: 'admin' }, { passwordRequired: true });
    const r = db.run(
      "INSERT INTO users (name, email, password_hash, role) VALUES (:name, :email, :hash, 'admin')",
      { name: f.name, email: f.email, hash: auth.hashPassword(f.password) },
    );
    res.setHeader('Set-Cookie', auth.sessionCookie(auth.createSession(db, r.id), req));
    res.status(201).json({ ok: true });
  });

  router.post('/auth/login', (req, res) => {
    const ip = req.ip || 'unknown';
    if (throttled(ip)) throw new v.HttpError(429, 'Too many sign-in attempts. Try again in a few minutes.');
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = db.get('SELECT * FROM users WHERE email = :email', { email });
    if (!user || !auth.verifyPassword(String(req.body.password || ''), user.password_hash)) {
      attempts.get(ip).push(Date.now());
      throw new v.HttpError(401, 'Email or password is incorrect.');
    }
    res.setHeader('Set-Cookie', auth.sessionCookie(auth.createSession(db, user.id), req));
    res.json({ ok: true });
  });

  router.post('/auth/logout', (req, res) => {
    if (req.sessionToken) db.run('DELETE FROM sessions WHERE token = :t', { t: req.sessionToken });
    res.setHeader('Set-Cookie', auth.sessionCookie('', req, 0));
    res.json({ ok: true });
  });

  router.post('/auth/password', signedIn, (req, res) => {
    const user = db.get('SELECT * FROM users WHERE id = :id', { id: req.user.id });
    if (!auth.verifyPassword(String(req.body.current || ''), user.password_hash)) throw v.bad('Current password is incorrect.');
    const next = v.str(req.body.password, 'New password', { required: true, max: 200 });
    if (next.length < 10) throw v.bad('Password must be at least 10 characters.');
    db.run('UPDATE users SET password_hash = :h WHERE id = :id', { h: auth.hashPassword(next), id: user.id });
    db.run('DELETE FROM sessions WHERE user_id = :id AND token != :t', { id: user.id, t: req.sessionToken });
    res.json({ ok: true });
  });

  // Everything below requires a signed-in user.
  router.use(signedIn);

  // ---- Users -------------------------------------------------------------
  router.get('/users', admin, (_req, res) => {
    res.json(db.all('SELECT id, name, email, role, created_at FROM users ORDER BY name'));
  });

  router.post('/users', admin, (req, res) => {
    const f = userFields(req.body, { passwordRequired: true });
    if (db.get('SELECT id FROM users WHERE email = :email', { email: f.email })) throw v.bad('A user with that email already exists.');
    const r = db.run('INSERT INTO users (name, email, password_hash, role) VALUES (:name, :email, :hash, :role)', {
      name: f.name,
      email: f.email,
      role: f.role,
      hash: auth.hashPassword(f.password),
    });
    res.status(201).json({ id: r.id });
  });

  const adminCount = () => db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").n;

  router.put('/users/:id', admin, (req, res) => {
    const id = v.id(req.params.id);
    const existing = db.get('SELECT * FROM users WHERE id = :id', { id });
    if (!existing) throw new v.HttpError(404, 'User not found.');
    const f = userFields({ ...existing, password: '', ...req.body }, { passwordRequired: false });
    if (existing.role === 'admin' && f.role !== 'admin' && adminCount() <= 1) throw v.bad('There must be at least one admin.');
    const clash = db.get('SELECT id FROM users WHERE email = :email AND id != :id', { email: f.email, id });
    if (clash) throw v.bad('A user with that email already exists.');
    db.run('UPDATE users SET name = :name, email = :email, role = :role WHERE id = :id', { ...f, id });
    if (f.password) {
      db.run('UPDATE users SET password_hash = :h WHERE id = :id', { h: auth.hashPassword(f.password), id });
      db.run('DELETE FROM sessions WHERE user_id = :id', { id });
    }
    res.json({ ok: true });
  });

  router.delete('/users/:id', admin, (req, res) => {
    const id = v.id(req.params.id);
    const existing = db.get('SELECT * FROM users WHERE id = :id', { id });
    if (!existing) throw new v.HttpError(404, 'User not found.');
    if (existing.role === 'admin' && adminCount() <= 1) throw v.bad('There must be at least one admin.');
    db.run('DELETE FROM users WHERE id = :id', { id });
    res.json({ ok: true });
  });

  // ---- Settings ----------------------------------------------------------
  router.get('/settings', (_req, res) => res.json(db.settings()));

  router.put('/settings', admin, (req, res) => {
    const updates = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (!(key in req.body)) continue;
      updates[key] =
        key === 'church_name'
          ? v.str(req.body[key], 'Church name', { required: true, max: 150 })
          : String(v.num(req.body[key], key.replace(/_/g, ' '), { min: 0, max: 10000, fallback: Number(DEFAULT_SETTINGS[key]) }));
    }
    db.transaction(() => {
      for (const [key, value] of Object.entries(updates)) {
        db.run('INSERT INTO settings (key, value) VALUES (:key, :value) ON CONFLICT (key) DO UPDATE SET value = excluded.value', { key, value });
      }
      if (updates.church_name) {
        db.run("UPDATE areas SET name = :name WHERE kind = 'church' AND parent_id IS NULL", { name: updates.church_name });
      }
    });
    res.json(db.settings());
  });

  // ---- Example data ------------------------------------------------------
  router.post('/example-data', admin, (_req, res) => {
    if (db.get('SELECT COUNT(*) AS n FROM people').n > 0) {
      throw v.bad('Example data can only be loaded when there are no people yet. Clear people & teams first.');
    }
    res.json({ people: demo.loadDemo(db) });
  });

  router.post('/clear-people', admin, (req, res) => {
    if (req.body.confirm !== 'DELETE') throw v.bad('Type DELETE to confirm.');
    demo.clearPeopleAndOrg(db);
    res.json({ ok: true });
  });

  // ---- Insights ----------------------------------------------------------
  router.get('/dashboard', (_req, res) => res.json(A.dashboard(A.buildContext(db))));

  router.get('/capacity', (_req, res) => {
    const ctx = A.buildContext(db);
    const paths = areaPaths(ctx.areas);
    const list = A.summarizeAll(ctx)
      .filter((s) => s.status !== 'inactive' && (s.load.activeRoles > 0 || s.flags.length))
      .sort((a, b) => b.riskScore - a.riskScore || b.load.monthlyHours - a.load.monthlyHours)
      .map((s) => ({
        id: s.id,
        name: s.name,
        level: s.level,
        status: s.status,
        risk: s.risk,
        riskScore: s.riskScore,
        flags: s.flags,
        load: s.load,
        roles: (ctx.byPerson.get(s.id) || []).map((a) => ({
          area_path: paths.get(a.area_id),
          role: a.role,
          role_level: a.role_level,
          frequency: a.frequency,
          monthly_hours: Math.round(A.monthlyHours(a) * 10) / 10,
        })),
      }));
    res.json({ thresholds: ctx.thresholds, people: list });
  });

  // ---- Import ------------------------------------------------------------
  router.post('/import/people', editor, (req, res) => {
    const rows = parseCsvObjects(v.str(req.body.csv, 'CSV', { required: true, max: 5_000_000 }));
    const dryRun = Boolean(req.body.dryRun);
    const levels = db.all('SELECT id, name FROM levels');
    const result = { created: 0, updated: 0, skipped: 0, campusesCreated: 0, errors: [] };

    importTransaction(db, dryRun, () => {
      const root = db.get("SELECT id FROM areas WHERE kind = 'church' ORDER BY id LIMIT 1");
      rows.forEach((row, i) => {
        const line = i + 2;
        try {
          let first = row.first_name || row.first || row.given_name || '';
          let last = row.last_name || row.last || row.surname || row.family_name || '';
          if (!first && row.name) [first, last] = splitName(row.name);
          if (!first) {
            result.skipped++;
            result.errors.push({ line, message: 'Missing first name.' });
            return;
          }
          const email = (row.email || row.email_address || row.home_email || '').toLowerCase();
          const externalId = row.external_id || row.person_id || row.pco_id || '';
          let campusId = null;
          if (row.campus) {
            const campus = db.get("SELECT id FROM areas WHERE kind = 'campus' AND name = :n COLLATE NOCASE", { n: row.campus });
            if (campus) campusId = campus.id;
            else {
              campusId = db.run("INSERT INTO areas (name, kind, parent_id) VALUES (:n, 'campus', :p)", { n: row.campus, p: root?.id }).id;
              result.campusesCreated++;
            }
          }
          const level = parseLevel(row.level || row.pipeline_level, levels);
          const status = ['active', 'on_break', 'inactive'].includes(row.status) ? row.status : null;
          const existing =
            (externalId && db.get('SELECT * FROM people WHERE external_id = :x', { x: externalId })) ||
            (email && db.get('SELECT * FROM people WHERE email = :e', { e: email })) ||
            db.get('SELECT * FROM people WHERE first_name = :f COLLATE NOCASE AND last_name = :l COLLATE NOCASE', { f: first, l: last });
          const fields = {
            first_name: first,
            last_name: last,
            email,
            phone: row.phone || row.mobile_phone || row.phone_number || '',
            campus_id: campusId,
            level,
            status,
            joined_date: normDate(row.joined_date || row.start_date),
            external_id: externalId || null,
          };
          if (existing) {
            // Only overwrite with values that are present in the file.
            const merged = { ...existing };
            for (const [k, val] of Object.entries(fields)) if (val != null && val !== '') merged[k] = val;
            db.run(
              `UPDATE people SET first_name = :first_name, last_name = :last_name, email = :email, phone = :phone,
                 campus_id = :campus_id, level = :level, status = :status, joined_date = :joined_date,
                 external_id = :external_id, updated_at = CURRENT_TIMESTAMP WHERE id = :id`,
              merged,
            );
            if (merged.level !== existing.level) {
              db.run(
                "INSERT INTO level_history (person_id, from_level, to_level, date, note, changed_by) VALUES (:id, :f, :t, :d, 'CSV import', :by)",
                { id: existing.id, f: existing.level, t: merged.level, d: A.today(), by: req.user.name },
              );
            }
            result.updated++;
          } else {
            const { id } = db.run(
              `INSERT INTO people (first_name, last_name, email, phone, campus_id, level, status, joined_date, external_id)
               VALUES (:first_name, :last_name, :email, :phone, :campus_id, :level, :status, :joined_date, :external_id)`,
              { ...fields, level: fields.level || 1, status: fields.status || 'active' },
            );
            db.run(
              "INSERT INTO level_history (person_id, from_level, to_level, date, note, changed_by) VALUES (:id, NULL, :t, :d, 'CSV import', :by)",
              { id, t: fields.level || 1, d: A.today(), by: req.user.name },
            );
            result.created++;
          }
        } catch (err) {
          result.skipped++;
          result.errors.push({ line, message: err.message });
        }
      });
    });
    res.json({ ...result, dryRun, rows: rows.length });
  });

  router.post('/import/assignments', editor, (req, res) => {
    const rows = parseCsvObjects(v.str(req.body.csv, 'CSV', { required: true, max: 5_000_000 }));
    const dryRun = Boolean(req.body.dryRun);
    const levels = db.all('SELECT id, name FROM levels');
    const result = { created: 0, updated: 0, skipped: 0, peopleCreated: 0, areasCreated: 0, errors: [] };

    importTransaction(db, dryRun, () => {
      const root = db.get("SELECT * FROM areas WHERE kind = 'church' ORDER BY id LIMIT 1");

      const resolveArea = (pathText) => {
        const parts = pathText.split(/\s*[>›]\s*/).map((s) => s.trim()).filter(Boolean);
        if (!parts.length) return null;
        let parent = null;
        parts.forEach((name, i) => {
          let found = null;
          if (i === 0) {
            const anywhere = db.all('SELECT * FROM areas WHERE name = :n COLLATE NOCASE', { n: name });
            found = anywhere.length === 1 ? anywhere[0] : anywhere.find((a) => a.parent_id === root?.id) || null;
          } else {
            found = db.get('SELECT * FROM areas WHERE parent_id = :p AND name = :n COLLATE NOCASE', { p: parent.id, n: name });
          }
          if (!found) {
            const under = parent || root;
            const kind = under ? CHILD_KIND[under.kind] : 'department';
            const id = db.run('INSERT INTO areas (name, kind, parent_id) VALUES (:n, :k, :p)', {
              n: name,
              k: kind === 'campus' && i === parts.length - 1 ? 'department' : kind,
              p: under?.id,
            }).id;
            found = db.get('SELECT * FROM areas WHERE id = :id', { id });
            result.areasCreated++;
          }
          parent = found;
        });
        return parent;
      };

      rows.forEach((row, i) => {
        const line = i + 2;
        try {
          const email = (row.email || row.email_address || '').toLowerCase();
          const externalId = row.external_id || row.person_id || row.pco_id || '';
          let first = row.first_name || '';
          let last = row.last_name || '';
          if (!first && (row.person || row.name)) [first, last] = splitName(row.person || row.name);
          let person =
            (externalId && db.get('SELECT * FROM people WHERE external_id = :x', { x: externalId })) ||
            (email && db.get('SELECT * FROM people WHERE email = :e', { e: email })) ||
            (first && db.get('SELECT * FROM people WHERE first_name = :f COLLATE NOCASE AND last_name = :l COLLATE NOCASE', { f: first, l: last }));
          if (!person) {
            if (!first) throw new Error('Could not identify the person (need email, external_id or name).');
            const id = db.run(
              'INSERT INTO people (first_name, last_name, email, external_id) VALUES (:f, :l, :e, :x)',
              { f: first, l: last, e: email, x: externalId || null },
            ).id;
            person = { id };
            result.peopleCreated++;
          }
          const areaText = row.area || [row.ministry || row.department, row.team].filter(Boolean).join(' > ');
          if (!areaText) throw new Error('Missing area (or ministry/team).');
          const area = resolveArea(areaText);
          const role = row.role || row.position || 'Team member';
          const roleLevel = parseLevel(row.role_level || row.level, levels) || 1;
          const frequency = FREQUENCIES.includes((row.frequency || '').toLowerCase()) ? row.frequency.toLowerCase() : 'weekly';
          const hours = row.hours === '' || row.hours == null || Number.isNaN(Number(row.hours)) ? 2 : Number(row.hours);
          const existing = db.get(
            'SELECT id FROM assignments WHERE person_id = :p AND area_id = :a AND role = :r COLLATE NOCASE AND end_date IS NULL',
            { p: person.id, a: area.id, r: role },
          );
          const f = { p: person.id, a: area.id, r: role, l: roleLevel, fr: frequency, h: hours, s: normDate(row.start_date) };
          if (existing) {
            db.run('UPDATE assignments SET role_level = :l, frequency = :fr, hours = :h WHERE id = :id', { ...f, id: existing.id });
            result.updated++;
          } else {
            db.run(
              `INSERT INTO assignments (person_id, area_id, role, role_level, frequency, hours, start_date)
               VALUES (:p, :a, :r, :l, :fr, :h, :s)`,
              f,
            );
            result.created++;
          }
        } catch (err) {
          result.skipped++;
          result.errors.push({ line, message: err.message });
        }
      });
    });
    res.json({ ...result, dryRun, rows: rows.length });
  });

  // ---- Export ------------------------------------------------------------
  const sendCsv = (res, name, columns, rows) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(toCsv(columns, rows));
  };

  router.get('/export/people.csv', (_req, res) => {
    const ctx = A.buildContext(db);
    const levels = new Map(db.all('SELECT id, name FROM levels').map((l) => [l.id, l.name]));
    const rows = A.summarizeAll(ctx).map((s) => ({
      id: s.id,
      external_id: s.external_id,
      first_name: s.first_name,
      last_name: s.last_name,
      email: s.email,
      phone: s.phone,
      campus: ctx.areasById.get(s.campus_id)?.name || '',
      level: s.level,
      level_name: levels.get(s.level),
      status: s.status,
      joined_date: s.joined_date,
      last_break_date: s.last_break_date,
      active_roles: s.load.activeRoles,
      leader_roles: s.load.leaderRoles,
      monthly_hours: s.load.monthlyHours,
      span_of_care: s.load.spanOfCare,
      apprentices: s.load.apprentices,
      last_checkin: s.load.lastCheckinDate,
      last_capacity: s.load.lastCapacity,
      risk: s.risk,
      flags: s.flags.map((f) => f.label).join('; '),
      level_readiness_percent: s.readiness.percent,
    }));
    sendCsv(res, 'people.csv', Object.keys(rows[0] || { id: 1 }), rows);
  });

  router.get('/export/assignments.csv', (_req, res) => {
    const areas = db.all('SELECT * FROM areas');
    const paths = areaPaths(areas);
    const rows = db
      .all(
        `SELECT a.*, p.first_name, p.last_name, p.email, p.external_id FROM assignments a
         JOIN people p ON p.id = a.person_id ORDER BY p.last_name, p.first_name`,
      )
      .map((a) => ({ ...a, area: paths.get(a.area_id) }));
    sendCsv(
      res,
      'assignments.csv',
      ['person_id', 'external_id', 'first_name', 'last_name', 'email', 'area', 'role', 'role_level', 'frequency', 'hours', 'start_date', 'end_date'],
      rows,
    );
  });
}

module.exports = { register, parseLevel };
