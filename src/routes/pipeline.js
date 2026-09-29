'use strict';

const v = require('../validate');
const { requireRole } = require('../auth');
const A = require('../analytics');

const CATEGORIES = ['Be', 'Know', 'Do'];

function register(router, db) {
  const editor = requireRole('editor');

  router.get('/levels', (_req, res) => {
    const ctx = A.buildContext(db);
    const summaries = A.summarizeAll(ctx).filter((s) => s.status !== 'inactive');
    const levels = db.all('SELECT * FROM levels ORDER BY id');
    const comps = db.all(
      "SELECT * FROM competencies ORDER BY CASE category WHEN 'Be' THEN 1 WHEN 'Know' THEN 2 ELSE 3 END, sort, id",
    );
    const trainings = db.all('SELECT * FROM trainings ORDER BY sort, id');
    res.json(
      levels.map((l) => {
        const atLevel = summaries.filter((s) => s.level === l.id);
        return {
          ...l,
          competencies: comps.filter((c) => c.level_id === l.id),
          trainings: trainings.filter((t) => t.level_id === l.id),
          people: atLevel
            .map((s) => ({ id: s.id, name: s.name, risk: s.risk, readiness: s.readiness }))
            .sort((a, b) => b.readiness.percent - a.readiness.percent || a.name.localeCompare(b.name)),
          positions: ctx.assignments.filter((a) => a.role_level === l.id).length,
          apprentices: ctx.apprenticeships.filter((a) => a.target_level === l.id).length,
        };
      }),
    );
  });

  router.put('/levels/:id', editor, (req, res) => {
    const id = v.int(req.params.id, 'Level', { min: 1, max: 5, required: true });
    const existing = db.get('SELECT * FROM levels WHERE id = :id', { id });
    const b = { ...existing, ...req.body };
    db.run(
      'UPDATE levels SET name = :name, focus = :focus, description = :description, typical_roles = :typical_roles WHERE id = :id',
      {
        id,
        name: v.str(b.name, 'Name', { required: true, max: 100 }),
        focus: v.str(b.focus, 'Focus', { max: 300 }),
        description: v.str(b.description, 'Description', { max: 5000 }),
        typical_roles: v.str(b.typical_roles, 'Typical roles', { max: 500 }),
      },
    );
    res.json({ ok: true });
  });

  const competencyFields = (b) => ({
    level_id: v.int(b.level_id, 'Level', { min: 1, max: 5, required: true }),
    category: v.oneOf(b.category, 'Category', CATEGORIES),
    name: v.str(b.name, 'Name', { required: true, max: 200 }),
    description: v.str(b.description, 'Description', { max: 2000 }),
    sort: v.int(b.sort, 'Sort', { fallback: 0 }),
  });

  router.post('/competencies', editor, (req, res) => {
    const r = db.run(
      'INSERT INTO competencies (level_id, category, name, description, sort) VALUES (:level_id, :category, :name, :description, :sort)',
      competencyFields(req.body),
    );
    res.status(201).json({ id: r.id });
  });

  router.put('/competencies/:id', editor, (req, res) => {
    const id = v.id(req.params.id);
    const existing = db.get('SELECT * FROM competencies WHERE id = :id', { id });
    if (!existing) throw new v.HttpError(404, 'Standard not found.');
    db.run(
      'UPDATE competencies SET level_id = :level_id, category = :category, name = :name, description = :description, sort = :sort WHERE id = :id',
      { ...competencyFields({ ...existing, ...req.body }), id },
    );
    res.json({ ok: true });
  });

  router.delete('/competencies/:id', editor, (req, res) => {
    db.run('DELETE FROM competencies WHERE id = :id', { id: v.id(req.params.id) });
    res.json({ ok: true });
  });

  const trainingFields = (b) => ({
    level_id: v.int(b.level_id, 'Level', { min: 1, max: 5 }),
    title: v.str(b.title, 'Title', { required: true, max: 200 }),
    description: v.str(b.description, 'Description', { max: 2000 }),
    format: v.str(b.format, 'Format', { max: 100 }),
    url: v.str(b.url, 'Link', { max: 1000 }),
    required: v.bool(b.required),
    sort: v.int(b.sort, 'Sort', { fallback: 0 }),
  });

  router.get('/trainings', (_req, res) => {
    const active = db.get("SELECT COUNT(*) AS n FROM people WHERE status != 'inactive'").n;
    const rows = db.all(
      `SELECT t.*,
         SUM(CASE WHEN pt.status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN pt.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
         SUM(CASE WHEN pt.status = 'assigned' THEN 1 ELSE 0 END) AS assigned,
         (SELECT COUNT(*) FROM people p WHERE p.status != 'inactive' AND p.level >= COALESCE(t.level_id, 1)) AS expected
       FROM trainings t LEFT JOIN person_trainings pt ON pt.training_id = t.id
       GROUP BY t.id ORDER BY COALESCE(t.level_id, 0), t.sort, t.id`,
    );
    res.json({ activePeople: active, trainings: rows });
  });

  router.get('/trainings/:id/people', (req, res) => {
    const id = v.id(req.params.id);
    const t = db.get('SELECT * FROM trainings WHERE id = :id', { id });
    if (!t) throw new v.HttpError(404, 'Training not found.');
    // Everyone at or above the training's level, with their status.
    const rows = db.all(
      `SELECT p.id, p.first_name, p.last_name, p.level, p.status AS person_status, pt.status, pt.completed_at
       FROM people p LEFT JOIN person_trainings pt ON pt.person_id = p.id AND pt.training_id = :id
       WHERE p.status != 'inactive' AND (p.level >= :lvl OR pt.status IS NOT NULL)
       ORDER BY CASE pt.status WHEN 'completed' THEN 3 WHEN 'in_progress' THEN 1 WHEN 'assigned' THEN 2 ELSE 0 END,
         p.last_name, p.first_name`,
      { id, lvl: t.level_id || 1 },
    );
    res.json({ training: t, people: rows });
  });

  // Assign a training to everyone at its level who does not have it yet.
  router.post('/trainings/:id/assign-level', editor, (req, res) => {
    const id = v.id(req.params.id);
    const t = db.get('SELECT * FROM trainings WHERE id = :id', { id });
    if (!t) throw new v.HttpError(404, 'Training not found.');
    const r = db.run(
      `INSERT INTO person_trainings (person_id, training_id, status)
       SELECT p.id, :id, 'assigned' FROM people p
       WHERE p.status != 'inactive' AND p.level = :lvl
         AND NOT EXISTS (SELECT 1 FROM person_trainings x WHERE x.person_id = p.id AND x.training_id = :id)`,
      { id, lvl: t.level_id || 1 },
    );
    res.json({ assigned: r.changes });
  });

  router.post('/trainings', editor, (req, res) => {
    const r = db.run(
      `INSERT INTO trainings (level_id, title, description, format, url, required, sort)
       VALUES (:level_id, :title, :description, :format, :url, :required, :sort)`,
      trainingFields(req.body),
    );
    res.status(201).json({ id: r.id });
  });

  router.put('/trainings/:id', editor, (req, res) => {
    const id = v.id(req.params.id);
    const existing = db.get('SELECT * FROM trainings WHERE id = :id', { id });
    if (!existing) throw new v.HttpError(404, 'Training not found.');
    db.run(
      `UPDATE trainings SET level_id = :level_id, title = :title, description = :description, format = :format,
         url = :url, required = :required, sort = :sort WHERE id = :id`,
      { ...trainingFields({ ...existing, ...req.body }), id },
    );
    res.json({ ok: true });
  });

  router.delete('/trainings/:id', editor, (req, res) => {
    db.run('DELETE FROM trainings WHERE id = :id', { id: v.id(req.params.id) });
    res.json({ ok: true });
  });
}

module.exports = { register };
