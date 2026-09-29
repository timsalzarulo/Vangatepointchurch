'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Database } = require('../src/db');
const A = require('../src/analytics');

function setup() {
  const db = new Database(':memory:');
  const root = db.get("SELECT id FROM areas WHERE kind = 'church'").id;
  const area = (name, kind, parent_id) => db.run('INSERT INTO areas (name, kind, parent_id) VALUES (:name, :kind, :parent_id)', { name, kind, parent_id }).id;
  const person = (first, level = 1, extra = {}) =>
    db.run(
      'INSERT INTO people (first_name, last_name, level, status, last_break_date, joined_date) VALUES (:first, :last, :level, :status, :brk, :joined)',
      { first, last: 'Test', level, status: extra.status || 'active', brk: extra.brk || null, joined: extra.joined || null },
    ).id;
  const assign = (person_id, area_id, role_level = 1, frequency = 'weekly', hours = 2) =>
    db.run(
      "INSERT INTO assignments (person_id, area_id, role, role_level, frequency, hours) VALUES (:person_id, :area_id, 'Role', :role_level, :frequency, :hours)",
      { person_id, area_id, role_level, frequency, hours },
    ).id;
  return { db, root, area, person, assign };
}

test('monthly hours are weighted by frequency', () => {
  assert.equal(A.monthlyHours({ frequency: 'monthly', hours: 3 }), 3);
  assert.equal(Math.round(A.monthlyHours({ frequency: 'weekly', hours: 3 }) * 100) / 100, 13);
  assert.equal(A.monthlyHours({ frequency: 'quarterly', hours: 3 }), 1);
});

test('span of care counts people under a leader and leaders of child areas', () => {
  const { db, root, area, person, assign } = setup();
  const dept = area('Kids', 'department', root);
  const teamA = area('Nursery', 'team', dept);
  const teamB = area('Preschool', 'team', dept);
  const director = person('Director', 4);
  assign(director, dept, 4);
  const leadA = person('LeadA', 2);
  const leadB = person('LeadB', 2);
  assign(leadA, teamA, 2);
  assign(leadB, teamB, 2);
  for (let i = 0; i < 3; i++) assign(person(`M${i}`), teamA, 1);
  const ctx = A.buildContext(db);
  assert.equal(A.spanOfCare(director, ctx), 2); // the two team leaders
  assert.equal(A.spanOfCare(leadA, ctx), 3); // three team members
  assert.equal(A.spanOfCare(leadB, ctx), 0);
});

test('overloaded leaders are flagged at risk; light servers are healthy', () => {
  const { db, root, area, person, assign } = setup();
  const t1 = area('T1', 'team', root);
  const t2 = area('T2', 'team', root);
  const t3 = area('T3', 'team', root);
  const busy = person('Busy', 2);
  assign(busy, t1, 2, 'weekly', 5);
  assign(busy, t2, 2, 'weekly', 5);
  assign(busy, t3, 2, 'weekly', 5);
  const light = person('Light', 1);
  assign(light, t1, 1, 'monthly', 2);
  const ctx = A.buildContext(db);
  const b = A.personSummary(ctx.peopleById.get(busy), ctx);
  const codes = b.flags.map((f) => f.code);
  assert.ok(codes.includes('hours'));
  assert.ok(codes.includes('leader_roles'));
  assert.ok(codes.includes('weekly'));
  assert.ok(codes.includes('no_apprentice'));
  assert.equal(b.risk, 'high');
  const l = A.personSummary(ctx.peopleById.get(light), ctx);
  assert.deepEqual(l.flags, []);
  assert.equal(l.risk, 'healthy');
});

test('low capacity check-in is a high-severity flag; apprentice clears succession flag', () => {
  const { db, root, area, person, assign } = setup();
  const team = area('Team', 'team', root);
  const lead = person('Lead', 2);
  const app = person('App', 1);
  assign(lead, team, 2, 'weekly', 2);
  assign(app, team, 1, 'biweekly', 2);
  db.run("INSERT INTO checkins (person_id, date, capacity) VALUES (:id, :d, 1)", { id: lead, d: A.today() });
  db.run("INSERT INTO apprenticeships (leader_id, apprentice_id, area_id, target_level) VALUES (:l, :a, :t, 2)", { l: lead, a: app, t: team });
  const ctx = A.buildContext(db);
  const s = A.personSummary(ctx.peopleById.get(lead), ctx);
  const codes = s.flags.map((f) => f.code);
  assert.ok(codes.includes('low_capacity'));
  assert.ok(!codes.includes('no_apprentice'));
  assert.ok(!codes.includes('checkin_overdue'));
  assert.equal(s.risk, 'high');
});

test('ended assignments do not count toward load', () => {
  const { db, root, area, person } = setup();
  const team = area('Team', 'team', root);
  const p = person('Past', 1);
  db.run("INSERT INTO assignments (person_id, area_id, role, frequency, hours, end_date) VALUES (:p, :a, 'Old', 'weekly', 10, '2020-01-01')", { p, a: team });
  const ctx = A.buildContext(db);
  assert.equal(A.computeLoad(ctx.peopleById.get(p), ctx).activeRoles, 0);
});

test('readiness reaches 100% when every standard is consistent and required training complete', () => {
  const { db, person } = setup();
  const p = person('Ready', 1);
  for (const c of db.all('SELECT id FROM competencies WHERE level_id = 1')) {
    db.run("INSERT INTO person_competencies (person_id, competency_id, rating, assessed_at) VALUES (:p, :c, 3, '2026-01-01')", { p, c: c.id });
  }
  let ctx = A.buildContext(db);
  assert.equal(A.readiness(ctx.peopleById.get(p), ctx).readyForNext, false);
  for (const t of db.all('SELECT id FROM trainings WHERE level_id = 1 AND required = 1')) {
    db.run("INSERT INTO person_trainings (person_id, training_id, status) VALUES (:p, :t, 'completed')", { p, t: t.id });
  }
  ctx = A.buildContext(db);
  const r = A.readiness(ctx.peopleById.get(p), ctx);
  assert.equal(r.percent, 100);
  assert.equal(r.readyForNext, true);
});

test('dashboard reports areas without a leader and succession coverage', () => {
  const { db, root, area, person, assign } = setup();
  const team = area('Leaderless', 'team', root);
  assign(person('Member'), team, 1);
  const led = area('Led', 'team', root);
  assign(person('Leader', 2), led, 2);
  const d = A.dashboard(A.buildContext(db));
  assert.ok(d.areasWithoutLeader.some((a) => a.name === 'Leaderless'));
  assert.ok(!d.areasWithoutLeader.some((a) => a.name === 'Led'));
  assert.equal(d.successionCoverage, 0);
});
