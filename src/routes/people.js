'use strict';

const v = require('../validate');
const { requireRole } = require('../auth');
const A = require('../analytics');
const { areaPaths } = require('./helpers');

const STATUSES = ['active', 'on_break', 'inactive'];

function personFields(body, db) {
  const campusId = v.int(body.campus_id, 'Campus', { min: 1 });
  if (campusId && !db.get('SELECT id FROM areas WHERE id = :id', { id: campusId })) throw v.bad('Campus not found.');
  return {
    first_name: v.str(body.first_name, 'First name', { required: true, max: 100 }),
    last_name: v.str(body.last_name, 'Last name', { max: 100 }),
    email: v.str(body.email, 'Email', { max: 200 }).toLowerCase(),
    phone: v.str(body.phone, 'Phone', { max: 50 }),
    campus_id: campusId,
    level: v.int(body.level, 'Level', { min: 1, max: 5, fallback: 1 }),
    status: v.oneOf(body.status, 'Status', STATUSES, 'active'),
    break_until: v.date(body.break_until, 'Break until'),
    last_break_date: v.date(body.last_break_date, 'Last break'),
    joined_date: v.date(body.joined_date, 'Joined date'),
    external_id: v.str(body.external_id, 'External ID', { max: 100 }) || null,
    notes: v.str(body.notes, 'Notes', { max: 10000 }),
  };
}

function getPerson(db, id) {
  const p = db.get('SELECT * FROM people WHERE id = :id', { id });
  if (!p) throw new v.HttpError(404, 'Person not found.');
  return p;
}

function register(router, db) {
  const editor = requireRole('editor');

  router.get('/people', (req, res) => {
    const ctx = A.buildContext(db);
    let list = A.summarizeAll(ctx);
    const { q, level, status, risk, area } = req.query;
    if (q) {
      const needle = String(q).toLowerCase();
      list = list.filter((p) => `${p.name} ${p.email} ${p.phone}`.toLowerCase().includes(needle));
    }
    if (level) list = list.filter((p) => p.level === Number(level));
    if (status) list = list.filter((p) => p.status === status);
    if (risk) list = list.filter((p) => p.risk === risk);
    if (area) {
      const ids = new Set(A.descendantIds(Number(area), ctx));
      const inArea = new Set(ctx.assignments.filter((a) => ids.has(a.area_id)).map((a) => a.person_id));
      list = list.filter((p) => inArea.has(p.id));
    }
    const paths = areaPaths(ctx.areas);
    const roles = (pid) =>
      (ctx.byPerson.get(pid) || []).map((a) => ({
        area: ctx.areasById.get(a.area_id)?.name,
        area_path: paths.get(a.area_id),
        role: a.role,
        role_level: a.role_level,
      }));
    list.sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
    res.json(
      list.map((p) => ({
        id: p.id,
        name: p.name,
        first_name: p.first_name,
        last_name: p.last_name,
        email: p.email,
        phone: p.phone,
        level: p.level,
        status: p.status,
        campus: ctx.areasById.get(p.campus_id)?.name || '',
        load: p.load,
        flags: p.flags,
        risk: p.risk,
        riskScore: p.riskScore,
        readiness: p.readiness,
        roles: roles(p.id),
      })),
    );
  });

  router.post('/people', editor, (req, res) => {
    const f = personFields(req.body, db);
    const { id } = db.run(
      `INSERT INTO people (first_name, last_name, email, phone, campus_id, level, status, break_until,
         last_break_date, joined_date, external_id, notes)
       VALUES (:first_name, :last_name, :email, :phone, :campus_id, :level, :status, :break_until,
         :last_break_date, :joined_date, :external_id, :notes)`,
      f,
    );
    db.run(
      'INSERT INTO level_history (person_id, from_level, to_level, date, note, changed_by) VALUES (:id, NULL, :level, :date, :note, :by)',
      { id, level: f.level, date: A.today(), note: 'Added to pipeline', by: req.user.name },
    );
    res.status(201).json({ id });
  });

  router.get('/people/:id', (req, res) => {
    const id = v.id(req.params.id);
    getPerson(db, id);
    const ctx = A.buildContext(db);
    const summary = A.personSummary(ctx.peopleById.get(id), ctx);
    const paths = areaPaths(ctx.areas);
    const assignments = db
      .all('SELECT * FROM assignments WHERE person_id = :id ORDER BY end_date IS NOT NULL, role_level DESC, id', { id })
      .map((a) => ({
        ...a,
        active: A.isActiveAssignment(a, ctx.onDate),
        area_name: ctx.areasById.get(a.area_id)?.name,
        area_path: paths.get(a.area_id),
        monthly_hours: Math.round(A.monthlyHours(a) * 10) / 10,
      }));
    const competencies = db.all(
      `SELECT c.*, pc.rating, pc.notes AS rating_notes, pc.assessed_by, pc.assessed_at
       FROM competencies c LEFT JOIN person_competencies pc ON pc.competency_id = c.id AND pc.person_id = :id
       ORDER BY c.level_id, CASE c.category WHEN 'Be' THEN 1 WHEN 'Know' THEN 2 ELSE 3 END, c.sort, c.id`,
      { id },
    );
    const trainings = db.all(
      `SELECT t.*, pt.status, pt.completed_at FROM trainings t
       LEFT JOIN person_trainings pt ON pt.training_id = t.id AND pt.person_id = :id
       ORDER BY t.level_id, t.sort, t.id`,
      { id },
    );
    const nameOf = (pid) => {
      const p = ctx.peopleById.get(pid);
      return p ? `${p.first_name} ${p.last_name}`.trim() : '';
    };
    const apprenticeships = db
      .all('SELECT * FROM apprenticeships WHERE leader_id = :id OR apprentice_id = :id ORDER BY status, id DESC', { id })
      .map((ap) => ({
        ...ap,
        leader_name: nameOf(ap.leader_id),
        apprentice_name: nameOf(ap.apprentice_id),
        area_path: ap.area_id ? paths.get(ap.area_id) : null,
      }));
    const checkins = db.all('SELECT * FROM checkins WHERE person_id = :id ORDER BY date DESC, id DESC', { id });
    const history = db.all('SELECT * FROM level_history WHERE person_id = :id ORDER BY date DESC, id DESC', { id });
    // Who leads the areas this person serves in (their "coaches").
    const leaders = new Map();
    for (const a of ctx.byPerson.get(id) || []) {
      const candidates = [
        ...(ctx.byArea.get(a.area_id) || []).filter((b) => b.role_level > a.role_level),
        ...(ctx.byArea.get(ctx.areasById.get(a.area_id)?.parent_id) || []).filter(
          (b) => b.role_level >= 2 && b.role_level > a.role_level,
        ),
      ];
      for (const b of candidates) {
        if (b.person_id !== id) leaders.set(b.person_id, { id: b.person_id, name: nameOf(b.person_id), role: b.role });
      }
    }
    res.json({
      ...summary,
      campus: ctx.areasById.get(summary.campus_id)?.name || '',
      assignments,
      competencies,
      trainings,
      apprenticeships,
      checkins,
      history,
      leaders: [...leaders.values()],
    });
  });

  router.put('/people/:id', editor, (req, res) => {
    const id = v.id(req.params.id);
    const existing = getPerson(db, id);
    const f = personFields({ ...existing, ...req.body }, db);
    db.transaction(() => {
      db.run(
        `UPDATE people SET first_name = :first_name, last_name = :last_name, email = :email, phone = :phone,
           campus_id = :campus_id, level = :level, status = :status, break_until = :break_until,
           last_break_date = :last_break_date, joined_date = :joined_date, external_id = :external_id,
           notes = :notes, updated_at = CURRENT_TIMESTAMP
         WHERE id = :id`,
        { ...f, id },
      );
      if (f.level !== existing.level) {
        db.run(
          `INSERT INTO level_history (person_id, from_level, to_level, date, note, changed_by)
           VALUES (:id, :from, :to, :date, :note, :by)`,
          {
            id,
            from: existing.level,
            to: f.level,
            date: A.today(),
            note: v.str(req.body.level_note, 'Note', { max: 1000 }),
            by: req.user.name,
          },
        );
      }
      // Coming back from a break resets the "months since break" clock.
      if (existing.status === 'on_break' && f.status === 'active' && !req.body.last_break_date) {
        db.run('UPDATE people SET last_break_date = :d WHERE id = :id', { d: A.today(), id });
      }
    });
    res.json({ ok: true });
  });

  router.delete('/people/:id', editor, (req, res) => {
    const id = v.id(req.params.id);
    getPerson(db, id);
    db.run('DELETE FROM people WHERE id = :id', { id });
    res.json({ ok: true });
  });

  router.put('/people/:id/competencies/:cid', editor, (req, res) => {
    const id = v.id(req.params.id);
    const cid = v.id(req.params.cid);
    getPerson(db, id);
    if (!db.get('SELECT id FROM competencies WHERE id = :cid', { cid })) throw new v.HttpError(404, 'Standard not found.');
    if (req.body.rating == null || req.body.rating === '') {
      db.run('DELETE FROM person_competencies WHERE person_id = :id AND competency_id = :cid', { id, cid });
      return res.json({ ok: true });
    }
    db.run(
      `INSERT INTO person_competencies (person_id, competency_id, rating, notes, assessed_by, assessed_at)
       VALUES (:id, :cid, :rating, :notes, :by, :at)
       ON CONFLICT (person_id, competency_id) DO UPDATE SET rating = excluded.rating, notes = excluded.notes,
         assessed_by = excluded.assessed_by, assessed_at = excluded.assessed_at`,
      {
        id,
        cid,
        rating: v.int(req.body.rating, 'Rating', { min: 0, max: 3, required: true }),
        notes: v.str(req.body.notes, 'Notes', { max: 2000 }),
        by: req.user.name,
        at: A.today(),
      },
    );
    res.json({ ok: true });
  });

  router.put('/people/:id/trainings/:tid', editor, (req, res) => {
    const id = v.id(req.params.id);
    const tid = v.id(req.params.tid);
    getPerson(db, id);
    if (!db.get('SELECT id FROM trainings WHERE id = :tid', { tid })) throw new v.HttpError(404, 'Training not found.');
    const status = v.oneOf(req.body.status, 'Status', ['none', 'assigned', 'in_progress', 'completed']);
    if (status === 'none') {
      db.run('DELETE FROM person_trainings WHERE person_id = :id AND training_id = :tid', { id, tid });
    } else {
      db.run(
        `INSERT INTO person_trainings (person_id, training_id, status, completed_at) VALUES (:id, :tid, :status, :at)
         ON CONFLICT (person_id, training_id) DO UPDATE SET status = excluded.status, completed_at = excluded.completed_at`,
        {
          id,
          tid,
          status,
          at: status === 'completed' ? v.date(req.body.completed_at, 'Completed date') || A.today() : null,
        },
      );
    }
    res.json({ ok: true });
  });

  router.post('/people/:id/checkins', editor, (req, res) => {
    const id = v.id(req.params.id);
    getPerson(db, id);
    const r = db.run(
      `INSERT INTO checkins (person_id, date, conducted_by, capacity, spiritual_health, notes, next_steps)
       VALUES (:id, :date, :by, :capacity, :spiritual, :notes, :next)`,
      {
        id,
        date: v.date(req.body.date, 'Date') || A.today(),
        by: v.str(req.body.conducted_by, 'Conducted by', { max: 200 }) || req.user.name,
        capacity: v.int(req.body.capacity, 'Capacity', { min: 1, max: 5 }),
        spiritual: v.int(req.body.spiritual_health, 'Spiritual health', { min: 1, max: 5 }),
        notes: v.str(req.body.notes, 'Notes', { max: 10000 }),
        next: v.str(req.body.next_steps, 'Next steps', { max: 5000 }),
      },
    );
    res.status(201).json({ id: r.id });
  });

  router.delete('/checkins/:id', editor, (req, res) => {
    db.run('DELETE FROM checkins WHERE id = :id', { id: v.id(req.params.id) });
    res.json({ ok: true });
  });

  function apprenticeshipFields(body) {
    const f = {
      leader_id: v.id(body.leader_id, 'Leader'),
      apprentice_id: v.id(body.apprentice_id, 'Apprentice'),
      area_id: v.int(body.area_id, 'Area', { min: 1 }),
      target_level: v.int(body.target_level, 'Target level', { min: 1, max: 5, required: true }),
      start_date: v.date(body.start_date, 'Start date') || A.today(),
      status: v.oneOf(body.status, 'Status', ['active', 'completed', 'stopped'], 'active'),
      notes: v.str(body.notes, 'Notes', { max: 5000 }),
    };
    if (f.leader_id === f.apprentice_id) throw v.bad('A person cannot apprentice themselves.');
    getPerson(db, f.leader_id);
    getPerson(db, f.apprentice_id);
    if (f.area_id && !db.get('SELECT id FROM areas WHERE id = :id', { id: f.area_id })) throw v.bad('Area not found.');
    return f;
  }

  router.post('/apprenticeships', editor, (req, res) => {
    const f = apprenticeshipFields(req.body);
    const r = db.run(
      `INSERT INTO apprenticeships (leader_id, apprentice_id, area_id, target_level, start_date, status, notes)
       VALUES (:leader_id, :apprentice_id, :area_id, :target_level, :start_date, :status, :notes)`,
      f,
    );
    res.status(201).json({ id: r.id });
  });

  router.put('/apprenticeships/:id', editor, (req, res) => {
    const id = v.id(req.params.id);
    const existing = db.get('SELECT * FROM apprenticeships WHERE id = :id', { id });
    if (!existing) throw new v.HttpError(404, 'Apprenticeship not found.');
    const f = apprenticeshipFields({ ...existing, ...req.body });
    db.run(
      `UPDATE apprenticeships SET leader_id = :leader_id, apprentice_id = :apprentice_id, area_id = :area_id,
         target_level = :target_level, start_date = :start_date, status = :status, notes = :notes WHERE id = :id`,
      { ...f, id },
    );
    res.json({ ok: true });
  });

  router.delete('/apprenticeships/:id', editor, (req, res) => {
    db.run('DELETE FROM apprenticeships WHERE id = :id', { id: v.id(req.params.id) });
    res.json({ ok: true });
  });
}

module.exports = { register, personFields, STATUSES };
