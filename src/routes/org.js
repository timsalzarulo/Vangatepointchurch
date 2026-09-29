'use strict';

const v = require('../validate');
const { requireRole } = require('../auth');
const A = require('../analytics');
const { areaPaths } = require('./helpers');

const KINDS = ['church', 'campus', 'department', 'team', 'group'];
const FREQUENCIES = Object.keys(A.FREQUENCY_PER_MONTH);

function register(router, db) {
  const editor = requireRole('editor');

  function areaFields(body, existingId = null) {
    const f = {
      name: v.str(body.name, 'Name', { required: true, max: 150 }),
      kind: v.oneOf(body.kind, 'Kind', KINDS),
      parent_id: v.int(body.parent_id, 'Parent', { min: 1 }),
      description: v.str(body.description, 'Description', { max: 5000 }),
    };
    if (f.parent_id) {
      if (!db.get('SELECT id FROM areas WHERE id = :id', { id: f.parent_id })) throw v.bad('Parent area not found.');
      // Prevent cycles: the new parent must not be this area or one of its descendants.
      let cur = f.parent_id;
      while (cur && existingId) {
        if (cur === existingId) throw v.bad('An area cannot be placed inside itself.');
        cur = db.get('SELECT parent_id FROM areas WHERE id = :id', { id: cur })?.parent_id;
      }
    }
    return f;
  }

  router.get('/areas', (_req, res) => {
    const ctx = A.buildContext(db);
    const summaries = new Map(A.summarizeAll(ctx).map((s) => [s.id, s]));
    const paths = areaPaths(ctx.areas);
    res.json(
      ctx.areas
        .map((a) => ({
          ...a,
          path: paths.get(a.id),
          health: A.areaHealth(a.id, ctx, summaries),
          leaders: (ctx.byArea.get(a.id) || [])
            .filter((x) => x.role_level >= 2)
            .map((x) => {
              const p = ctx.peopleById.get(x.person_id);
              return { id: x.person_id, name: `${p.first_name} ${p.last_name}`.trim(), role: x.role };
            }),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  });

  router.get('/areas/:id', (req, res) => {
    const id = v.id(req.params.id);
    const ctx = A.buildContext(db);
    const area = ctx.areasById.get(id);
    if (!area) throw new v.HttpError(404, 'Area not found.');
    const summaries = new Map(A.summarizeAll(ctx).map((s) => [s.id, s]));
    const paths = areaPaths(ctx.areas);
    const brief = (pid) => {
      const s = summaries.get(pid);
      return { id: s.id, name: s.name, level: s.level, status: s.status, risk: s.risk, flags: s.flags, load: s.load };
    };
    const ancestors = [];
    for (let p = ctx.areasById.get(area.parent_id); p; p = ctx.areasById.get(p.parent_id)) ancestors.unshift({ id: p.id, name: p.name });
    const descendantIds = new Set(A.descendantIds(id, ctx));
    res.json({
      ...area,
      path: paths.get(id),
      ancestors,
      health: A.areaHealth(id, ctx, summaries),
      children: (ctx.areaChildren.get(id) || [])
        .map((c) => ({ ...c, health: A.areaHealth(c.id, ctx, summaries) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      members: (ctx.byArea.get(id) || [])
        .map((a) => ({ assignment: a, monthly_hours: Math.round(A.monthlyHours(a) * 10) / 10, person: brief(a.person_id) }))
        .sort((a, b) => b.assignment.role_level - a.assignment.role_level || a.person.name.localeCompare(b.person.name)),
      apprenticeships: ctx.apprenticeships
        .filter((ap) => ap.area_id != null && descendantIds.has(ap.area_id))
        .map((ap) => ({
          ...ap,
          leader_name: summaries.get(ap.leader_id)?.name,
          apprentice_name: summaries.get(ap.apprentice_id)?.name,
          area_path: paths.get(ap.area_id),
        })),
    });
  });

  router.post('/areas', editor, (req, res) => {
    const f = areaFields(req.body);
    const r = db.run(
      'INSERT INTO areas (name, kind, parent_id, description) VALUES (:name, :kind, :parent_id, :description)',
      f,
    );
    res.status(201).json({ id: r.id });
  });

  router.put('/areas/:id', editor, (req, res) => {
    const id = v.id(req.params.id);
    const existing = db.get('SELECT * FROM areas WHERE id = :id', { id });
    if (!existing) throw new v.HttpError(404, 'Area not found.');
    const f = areaFields({ ...existing, ...req.body }, id);
    db.run(
      'UPDATE areas SET name = :name, kind = :kind, parent_id = :parent_id, description = :description WHERE id = :id',
      { ...f, id },
    );
    res.json({ ok: true });
  });

  router.delete('/areas/:id', editor, (req, res) => {
    const id = v.id(req.params.id);
    if (db.get('SELECT COUNT(*) AS n FROM areas WHERE parent_id = :id', { id }).n > 0) {
      throw v.bad('Move or delete the areas inside this one first.');
    }
    db.run('DELETE FROM areas WHERE id = :id', { id });
    res.json({ ok: true });
  });

  function assignmentFields(body) {
    const f = {
      person_id: v.id(body.person_id, 'Person'),
      area_id: v.id(body.area_id, 'Area'),
      role: v.str(body.role, 'Role', { required: true, max: 150 }),
      role_level: v.int(body.role_level, 'Role level', { min: 1, max: 5, fallback: 1 }),
      frequency: v.oneOf(body.frequency, 'Frequency', FREQUENCIES, 'weekly'),
      hours: v.num(body.hours, 'Hours per occurrence', { min: 0, max: 80, fallback: 2 }),
      start_date: v.date(body.start_date, 'Start date'),
      end_date: v.date(body.end_date, 'End date'),
      notes: v.str(body.notes, 'Notes', { max: 5000 }),
    };
    if (!db.get('SELECT id FROM people WHERE id = :id', { id: f.person_id })) throw v.bad('Person not found.');
    if (!db.get('SELECT id FROM areas WHERE id = :id', { id: f.area_id })) throw v.bad('Area not found.');
    return f;
  }

  router.post('/assignments', editor, (req, res) => {
    const f = assignmentFields(req.body);
    const r = db.run(
      `INSERT INTO assignments (person_id, area_id, role, role_level, frequency, hours, start_date, end_date, notes)
       VALUES (:person_id, :area_id, :role, :role_level, :frequency, :hours, :start_date, :end_date, :notes)`,
      f,
    );
    res.status(201).json({ id: r.id });
  });

  router.put('/assignments/:id', editor, (req, res) => {
    const id = v.id(req.params.id);
    const existing = db.get('SELECT * FROM assignments WHERE id = :id', { id });
    if (!existing) throw new v.HttpError(404, 'Assignment not found.');
    const f = assignmentFields({ ...existing, ...req.body });
    db.run(
      `UPDATE assignments SET person_id = :person_id, area_id = :area_id, role = :role, role_level = :role_level,
         frequency = :frequency, hours = :hours, start_date = :start_date, end_date = :end_date, notes = :notes
       WHERE id = :id`,
      { ...f, id },
    );
    res.json({ ok: true });
  });

  router.delete('/assignments/:id', editor, (req, res) => {
    db.run('DELETE FROM assignments WHERE id = :id', { id: v.id(req.params.id) });
    res.json({ ok: true });
  });
}

module.exports = { register, KINDS, FREQUENCIES };
