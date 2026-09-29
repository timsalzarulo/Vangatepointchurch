'use strict';

// Fills the database with fictional demo data so you can explore the app.
// Usage: npm run seed:demo            (refuses if people already exist)
//        npm run seed:demo -- --force (adds demo data anyway)

const { openDatabase } = require('../src/db');

const db = openDatabase();
if (db.get('SELECT COUNT(*) AS n FROM people').n > 0 && !process.argv.includes('--force')) {
  console.error('People already exist in this database. Re-run with --force to add demo data anyway.');
  process.exit(1);
}

// Deterministic pseudo-random numbers so the demo is the same every time.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const isoDaysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

const FIRST = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'David', 'Elizabeth',
  'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Chris', 'Karen', 'Daniel',
  'Lisa', 'Matthew', 'Nancy', 'Anthony', 'Betty', 'Mark', 'Sandra', 'Steven', 'Ashley', 'Andrew', 'Emily', 'Josh',
  'Michelle', 'Kevin', 'Amanda', 'Brian', 'Melissa', 'Tim', 'Rachel', 'Jason', 'Laura', 'Ryan', 'Megan', 'Eric',
  'Hannah', 'Jacob', 'Olivia', 'Nathan', 'Grace', 'Caleb', 'Abigail', 'Luis', 'Maria', 'Andre', 'Keisha', 'Wei', 'Priya'];
const LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Thompson',
  'White', 'Harris', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Green',
  'Baker', 'Adams', 'Nelson', 'Hill', 'Campbell', 'Mitchell', 'Roberts', 'Carter', 'Phillips', 'Evans', 'Turner', 'Nguyen', 'Patel', 'Chen'];

const STRUCTURE = {
  Kids: { teams: ['Nursery', 'Preschool', 'Elementary', 'Check-in'], role: 'Kids volunteer', freq: 'biweekly', hours: 2.5 },
  'Worship & Production': { teams: ['Band', 'Vocals', 'Production'], role: 'Musician / tech', freq: 'biweekly', hours: 5 },
  'Guest Experience': { teams: ['Greeters', 'Parking', 'Ushers', 'Café'], role: 'Guest team', freq: 'biweekly', hours: 2 },
  Students: { teams: ['Middle School', 'High School'], role: 'Student leader', freq: 'weekly', hours: 3 },
  Groups: { teams: ['Small Group Leaders'], role: 'Group host', freq: 'weekly', hours: 2.5 },
};

db.transaction(() => {
  const root = db.get("SELECT id FROM areas WHERE kind = 'church' ORDER BY id LIMIT 1");
  const newArea = (name, kind, parent_id) => db.run('INSERT INTO areas (name, kind, parent_id) VALUES (:name, :kind, :parent_id)', { name, kind, parent_id }).id;
  const usedNames = new Set();
  const newPerson = (level, campus_id) => {
    let first;
    let last;
    do {
      first = pick(FIRST);
      last = pick(LAST);
    } while (usedNames.has(`${first} ${last}`));
    usedNames.add(`${first} ${last}`);
    const status = chance(0.04) ? 'on_break' : 'active';
    const id = db.run(
      `INSERT INTO people (first_name, last_name, email, phone, campus_id, level, status, joined_date, last_break_date)
       VALUES (:first, :last, :email, :phone, :campus_id, :level, :status, :joined, :brk)`,
      {
        first,
        last,
        email: `${first}.${last}@example.com`.toLowerCase(),
        phone: `555-01${String(Math.floor(rand() * 100)).padStart(2, '0')}`,
        campus_id,
        level,
        status,
        joined: isoDaysAgo(200 + Math.floor(rand() * 2500)),
        brk: chance(0.5) ? isoDaysAgo(Math.floor(rand() * 700)) : null,
      },
    ).id;
    db.run("INSERT INTO level_history (person_id, from_level, to_level, date, note, changed_by) VALUES (:id, NULL, :level, :d, 'Demo data', 'Demo')", { id, level, d: isoDaysAgo(365) });
    return id;
  };
  const assign = (person_id, area_id, role, role_level, frequency, hours) =>
    db.run(
      `INSERT INTO assignments (person_id, area_id, role, role_level, frequency, hours, start_date)
       VALUES (:person_id, :area_id, :role, :role_level, :frequency, :hours, :start)`,
      { person_id, area_id, role, role_level, frequency, hours, start: isoDaysAgo(Math.floor(rand() * 900)) },
    );

  const leadersForApprenticeship = [];
  const allTeamIds = [];
  for (const campusName of ['North Campus', 'South Campus']) {
    const campusId = newArea(campusName, 'campus', root.id);
    const pastor = newPerson(5, campusId);
    assign(pastor, campusId, 'Campus Pastor', 5, 'weekly', 12);
    for (const [deptName, cfg] of Object.entries(STRUCTURE)) {
      const deptId = newArea(deptName, 'department', campusId);
      const director = newPerson(4, campusId);
      assign(director, deptId, `${deptName} Director`, 4, 'weekly', 6);
      const coach = cfg.teams.length > 2 ? newPerson(3, campusId) : null;
      if (coach) assign(coach, deptId, 'Coach', 3, 'weekly', 3);
      for (const team of cfg.teams) {
        const teamId = newArea(team, 'team', deptId);
        allTeamIds.push(teamId);
        if (chance(0.9)) {
          const lead = newPerson(chance(0.8) ? 2 : 1, campusId);
          assign(lead, teamId, 'Team Leader', 2, cfg.freq === 'weekly' ? 'weekly' : 'weekly', 3);
          leadersForApprenticeship.push([lead, teamId]);
        }
        const size = 5 + Math.floor(rand() * 10);
        for (let i = 0; i < size; i++) {
          const member = newPerson(1, campusId);
          assign(member, teamId, cfg.role, 1, cfg.freq, cfg.hours);
        }
      }
    }
  }

  // Everyone who serves more than once: pile extra roles on a few people.
  const people = db.all('SELECT id, level FROM people');
  for (let i = 0; i < 45; i++) {
    const p = pick(people);
    assign(p.id, pick(allTeamIds), 'Team member', 1, pick(['weekly', 'biweekly', 'monthly']), 2 + Math.floor(rand() * 3));
  }
  for (let i = 0; i < 6; i++) {
    const p = pick(people.filter((x) => x.level >= 2));
    assign(p.id, pick(allTeamIds), 'Team Leader', 2, 'weekly', 4);
  }

  // Apprenticeships for about half the team leaders.
  for (const [leader, teamId] of leadersForApprenticeship) {
    if (!chance(0.5)) continue;
    const members = db.all('SELECT person_id FROM assignments WHERE area_id = :a AND role_level = 1', { a: teamId });
    if (!members.length) continue;
    db.run(
      `INSERT INTO apprenticeships (leader_id, apprentice_id, area_id, target_level, start_date, status)
       VALUES (:l, :a, :t, 2, :d, 'active')`,
      { l: leader, a: pick(members).person_id, t: teamId, d: isoDaysAgo(Math.floor(rand() * 300)) },
    );
  }

  // Check-ins for most leaders; a few report low capacity.
  const leaders = db.all('SELECT DISTINCT person_id FROM assignments WHERE role_level >= 2');
  for (const { person_id } of leaders) {
    if (!chance(0.75)) continue;
    db.run(
      `INSERT INTO checkins (person_id, date, conducted_by, capacity, spiritual_health, notes, next_steps)
       VALUES (:p, :d, 'Demo coach', :c, :s, 'Demo check-in notes.', 'Follow up next month.')`,
      { p: person_id, d: isoDaysAgo(Math.floor(rand() * 160)), c: chance(0.15) ? 2 : 3 + Math.floor(rand() * 3), s: 2 + Math.floor(rand() * 4) },
    );
  }

  // Competency ratings and training completions.
  const comps = db.all('SELECT id, level_id FROM competencies');
  const trainings = db.all('SELECT id, level_id FROM trainings');
  for (const p of people) {
    const strong = chance(0.12);
    for (const c of comps.filter((c) => c.level_id <= p.level)) {
      if (!strong && !chance(0.6)) continue;
      const rating = strong || c.level_id < p.level ? 3 : Math.floor(rand() * 4);
      db.run(
        `INSERT INTO person_competencies (person_id, competency_id, rating, assessed_by, assessed_at)
         VALUES (:p, :c, :r, 'Demo coach', :d)`,
        { p: p.id, c: c.id, r: rating, d: isoDaysAgo(Math.floor(rand() * 200)) },
      );
    }
    for (const t of trainings.filter((t) => t.level_id <= p.level)) {
      if (!strong && !chance(0.55)) continue;
      const status = strong || t.level_id < p.level ? 'completed' : pick(['assigned', 'in_progress', 'completed']);
      db.run(
        'INSERT INTO person_trainings (person_id, training_id, status, completed_at) VALUES (:p, :t, :s, :d)',
        { p: p.id, t: t.id, s: status, d: status === 'completed' ? isoDaysAgo(Math.floor(rand() * 600)) : null },
      );
    }
  }
});

const n = db.get('SELECT COUNT(*) AS n FROM people').n;
console.log(`Demo data loaded: ${n} people.`);
db.close();
