'use strict';

// Capacity (burnout) and pipeline analytics. Pure functions over plain data so
// they are easy to test; buildContext() loads the data from the database.

const FREQUENCY_PER_MONTH = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  occasional: 0.25,
};

const SEVERITY_WEIGHT = { high: 3, medium: 2, low: 1 };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isActiveAssignment(a, onDate) {
  return !a.end_date || a.end_date > onDate;
}

function monthlyHours(a) {
  return (FREQUENCY_PER_MONTH[a.frequency] ?? 1) * Number(a.hours || 0);
}

function daysBetween(from, to) {
  return Math.floor((Date.parse(to) - Date.parse(from)) / 86400000);
}

function monthsBetween(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

function thresholdsFrom(settings) {
  const n = (k, d) => {
    const v = Number(settings[k]);
    return Number.isFinite(v) ? v : d;
  };
  return {
    maxActiveRoles: n('max_active_roles', 3),
    maxLeaderRoles: n('max_leader_roles', 2),
    maxWeeklyRoles: n('max_weekly_roles', 2),
    maxMonthlyHours: n('max_monthly_hours', 20),
    maxSpanOfCare: n('max_span_of_care', 10),
    checkinIntervalDays: n('checkin_interval_days', 90),
    lowCapacityScore: n('low_capacity_score', 2),
    maxMonthsWithoutBreak: n('max_months_without_break', 12),
  };
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

// Load everything the analytics need in a handful of queries.
function buildContext(db, onDate = today()) {
  const people = db.all('SELECT * FROM people');
  const areas = db.all('SELECT * FROM areas');
  const assignments = db
    .all('SELECT * FROM assignments')
    .filter((a) => isActiveAssignment(a, onDate));
  const apprenticeships = db.all("SELECT * FROM apprenticeships WHERE status = 'active'");
  const checkins = db.all('SELECT * FROM checkins ORDER BY date DESC, id DESC');
  const competencies = db.all('SELECT * FROM competencies');
  const trainings = db.all('SELECT * FROM trainings');
  const ratings = db.all('SELECT person_id, competency_id, rating FROM person_competencies');
  const completions = db.all(
    "SELECT person_id, training_id FROM person_trainings WHERE status = 'completed'",
  );

  const latestCheckin = new Map();
  for (const c of checkins) if (!latestCheckin.has(c.person_id)) latestCheckin.set(c.person_id, c);

  const ratingMap = new Map();
  for (const r of ratings) {
    if (!ratingMap.has(r.person_id)) ratingMap.set(r.person_id, new Map());
    ratingMap.get(r.person_id).set(r.competency_id, r.rating);
  }
  const completedMap = new Map();
  for (const c of completions) {
    if (!completedMap.has(c.person_id)) completedMap.set(c.person_id, new Set());
    completedMap.get(c.person_id).add(c.training_id);
  }

  return {
    onDate,
    thresholds: thresholdsFrom(db.settings()),
    people,
    peopleById: new Map(people.map((p) => [p.id, p])),
    areas,
    areasById: new Map(areas.map((a) => [a.id, a])),
    areaChildren: groupBy(areas, 'parent_id'),
    assignments,
    byPerson: groupBy(assignments, 'person_id'),
    byArea: groupBy(assignments, 'area_id'),
    apprenticeships,
    apprenticeshipsByLeader: groupBy(apprenticeships, 'leader_id'),
    apprenticeshipsByApprentice: groupBy(apprenticeships, 'apprentice_id'),
    latestCheckin,
    competenciesByLevel: groupBy(competencies, 'level_id'),
    requiredTrainingsByLevel: groupBy(trainings.filter((t) => t.required), 'level_id'),
    ratingMap,
    completedMap,
  };
}

// People this person is directly responsible for: the people under them in the
// areas they lead, plus the leaders of the areas directly beneath those areas.
function spanOfCare(personId, ctx) {
  const cared = new Set();
  const led = (ctx.byPerson.get(personId) || []).filter((a) => a.role_level >= 2);
  for (const a of led) {
    for (const b of ctx.byArea.get(a.area_id) || []) {
      if (b.person_id !== personId && b.role_level < a.role_level) cared.add(b.person_id);
    }
    for (const child of ctx.areaChildren.get(a.area_id) || []) {
      for (const b of ctx.byArea.get(child.id) || []) {
        if (b.person_id !== personId && b.role_level >= 2) cared.add(b.person_id);
      }
    }
  }
  return cared.size;
}

function hasApprenticeFor(assignment, ctx) {
  return (ctx.apprenticeshipsByLeader.get(assignment.person_id) || []).some(
    (ap) => ap.area_id == null || ap.area_id === assignment.area_id,
  );
}

function computeLoad(person, ctx) {
  const roles = ctx.byPerson.get(person.id) || [];
  const leaderRoles = roles.filter((a) => a.role_level >= 2);
  const checkin = ctx.latestCheckin.get(person.id) || null;
  const breakRef = person.last_break_date || person.joined_date || null;
  return {
    activeRoles: roles.length,
    leaderRoles: leaderRoles.length,
    weeklyRoles: roles.filter((a) => a.frequency === 'weekly').length,
    monthlyHours: Math.round(roles.reduce((s, a) => s + monthlyHours(a), 0) * 10) / 10,
    highestRoleLevel: roles.reduce((m, a) => Math.max(m, a.role_level), 0),
    spanOfCare: spanOfCare(person.id, ctx),
    apprentices: (ctx.apprenticeshipsByLeader.get(person.id) || []).length,
    leaderRolesWithoutApprentice: leaderRoles.filter((a) => !hasApprenticeFor(a, ctx)).length,
    stretchedRoles: roles.filter((a) => a.role_level > person.level).length,
    lastCheckinDate: checkin ? checkin.date : null,
    lastCapacity: checkin ? checkin.capacity : null,
    daysSinceCheckin: checkin ? daysBetween(checkin.date, ctx.onDate) : null,
    monthsSinceBreak: breakRef ? monthsBetween(breakRef, ctx.onDate) : null,
  };
}

function evaluateFlags(person, load, t) {
  const flags = [];
  const add = (code, severity, label, detail) => flags.push({ code, severity, label, detail });
  if (person.status === 'inactive') return flags;

  if (person.status === 'on_break' && load.activeRoles > 0) {
    add('on_break_scheduled', 'medium', 'On break but still assigned',
      `Marked on break with ${load.activeRoles} active role(s).`);
  }
  if (load.lastCapacity != null && load.lastCapacity <= t.lowCapacityScore) {
    add('low_capacity', 'high', 'Low capacity reported',
      `Last check-in (${load.lastCheckinDate}) capacity ${load.lastCapacity}/5.`);
  }
  if (load.monthlyHours > t.maxMonthlyHours) {
    add('hours', load.monthlyHours > t.maxMonthlyHours * 1.5 ? 'high' : 'medium', 'High serving hours',
      `~${load.monthlyHours} hrs/month (guideline ${t.maxMonthlyHours}).`);
  }
  if (load.leaderRoles > t.maxLeaderRoles) {
    add('leader_roles', load.leaderRoles > t.maxLeaderRoles + 1 ? 'high' : 'medium', 'Leading too many areas',
      `Leads in ${load.leaderRoles} areas (guideline ${t.maxLeaderRoles}).`);
  }
  if (load.activeRoles > t.maxActiveRoles) {
    add('roles', 'medium', 'Too many roles',
      `Serving in ${load.activeRoles} roles (guideline ${t.maxActiveRoles}).`);
  }
  if (load.weeklyRoles > t.maxWeeklyRoles) {
    add('weekly', 'medium', 'Too many weekly commitments',
      `${load.weeklyRoles} weekly roles (guideline ${t.maxWeeklyRoles}).`);
  }
  if (load.spanOfCare > t.maxSpanOfCare) {
    add('span', load.spanOfCare > t.maxSpanOfCare * 1.5 ? 'high' : 'medium', 'Span of care too wide',
      `Directly responsible for ${load.spanOfCare} people (guideline ${t.maxSpanOfCare}).`);
  }
  // Long stretches without rest matter most for people carrying real load.
  const carriesLoad = load.leaderRoles > 0 || load.monthlyHours >= t.maxMonthlyHours / 2;
  if (carriesLoad && load.monthsSinceBreak != null && load.monthsSinceBreak > t.maxMonthsWithoutBreak) {
    const inferred = !person.last_break_date;
    add('no_break', inferred ? 'low' : 'medium', 'No recent break',
      inferred
        ? `No break recorded since joining ${load.monthsSinceBreak} months ago (guideline ${t.maxMonthsWithoutBreak}).`
        : `${load.monthsSinceBreak} months since last break (guideline ${t.maxMonthsWithoutBreak}).`);
  }
  if (load.leaderRoles > 0 && (load.daysSinceCheckin == null || load.daysSinceCheckin > t.checkinIntervalDays)) {
    add('checkin_overdue', 'low', 'Check-in overdue',
      load.daysSinceCheckin == null ? 'No check-in recorded.' : `Last check-in ${load.daysSinceCheckin} days ago.`);
  }
  if (load.stretchedRoles > 0) {
    add('stretched', 'low', 'Serving above pipeline level',
      `${load.stretchedRoles} role(s) require a higher level than their current level — prioritize development.`);
  }
  if (load.leaderRolesWithoutApprentice > 0) {
    add('no_apprentice', 'low', 'No apprentice',
      `${load.leaderRolesWithoutApprentice} leadership role(s) without an apprentice (succession risk).`);
  }
  return flags;
}

function riskFromFlags(flags) {
  const count = (s) => flags.filter((f) => f.severity === s).length;
  const score = flags.reduce((s, f) => s + SEVERITY_WEIGHT[f.severity], 0);
  let risk = 'healthy';
  if (count('high') > 0 || count('medium') >= 3) risk = 'high';
  else if (count('medium') > 0 || count('low') >= 3) risk = 'watch';
  return { risk, score };
}

// How much of their current level has this person demonstrated?
function readiness(person, ctx) {
  const comps = ctx.competenciesByLevel.get(person.level) || [];
  const reqTrainings = ctx.requiredTrainingsByLevel.get(person.level) || [];
  const ratings = ctx.ratingMap.get(person.id) || new Map();
  const done = ctx.completedMap.get(person.id) || new Set();
  const compsMet = comps.filter((c) => (ratings.get(c.id) ?? 0) >= 3).length;
  const trainingsMet = reqTrainings.filter((t) => done.has(t.id)).length;
  const total = comps.length + reqTrainings.length;
  const percent = total ? Math.round(((compsMet + trainingsMet) / total) * 100) : 0;
  return {
    competenciesMet: compsMet,
    competenciesTotal: comps.length,
    trainingsMet,
    trainingsTotal: reqTrainings.length,
    percent,
    readyForNext: person.level < 5 && total > 0 && percent === 100,
  };
}

function personSummary(person, ctx) {
  const load = computeLoad(person, ctx);
  const flags = evaluateFlags(person, load, ctx.thresholds);
  const { risk, score } = riskFromFlags(flags);
  return {
    ...person,
    name: `${person.first_name} ${person.last_name}`.trim(),
    load,
    flags,
    risk,
    riskScore: score,
    readiness: readiness(person, ctx),
    hasApprenticeship: (ctx.apprenticeshipsByApprentice.get(person.id) || []).length > 0,
  };
}

function summarizeAll(ctx) {
  return ctx.people.map((p) => personSummary(p, ctx));
}

function descendantIds(areaId, ctx) {
  const out = [areaId];
  for (let i = 0; i < out.length; i++) {
    for (const child of ctx.areaChildren.get(out[i]) || []) out.push(child.id);
  }
  return out;
}

function areaHealth(areaId, ctx, summariesById) {
  const ids = descendantIds(areaId, ctx);
  const direct = ctx.byArea.get(areaId) || [];
  const all = ids.flatMap((id) => ctx.byArea.get(id) || []);
  const people = new Set(all.map((a) => a.person_id));
  const leaderAssignments = all.filter((a) => a.role_level >= 2);
  const covered = leaderAssignments.filter((a) => hasApprenticeFor(a, ctx)).length;
  let atRisk = 0;
  let watch = 0;
  for (const pid of people) {
    const s = summariesById.get(pid);
    if (s?.risk === 'high') atRisk++;
    else if (s?.risk === 'watch') watch++;
  }
  return {
    directMembers: new Set(direct.map((a) => a.person_id)).size,
    hasLeader: direct.some((a) => a.role_level >= 2),
    people: people.size,
    leaders: new Set(leaderAssignments.map((a) => a.person_id)).size,
    monthlyHours: Math.round(all.reduce((s, a) => s + monthlyHours(a), 0)),
    successionCoverage: leaderAssignments.length
      ? Math.round((covered / leaderAssignments.length) * 100)
      : null,
    atRisk,
    watch,
  };
}

function dashboard(ctx) {
  const summaries = summarizeAll(ctx);
  const active = summaries.filter((s) => s.status !== 'inactive');
  const serving = active.filter((s) => s.load.activeRoles > 0);

  const byLevel = [1, 2, 3, 4, 5].map((level) => ({
    level,
    people: active.filter((s) => s.level === level).length,
    positions: ctx.assignments.filter((a) => a.role_level === level).length,
    leadersInRole: new Set(ctx.assignments.filter((a) => a.role_level === level).map((a) => a.person_id)).size,
    apprentices: ctx.apprenticeships.filter((a) => a.target_level === level).length,
    readyFromBelow: active.filter((s) => s.level === level - 1 && s.readiness.readyForNext).length,
  }));

  const leaderAssignments = ctx.assignments.filter((a) => a.role_level >= 2);
  const covered = leaderAssignments.filter((a) => hasApprenticeFor(a, ctx)).length;

  const hours = serving.map((s) => s.load.monthlyHours).sort((a, b) => b - a);
  const totalHours = hours.reduce((a, b) => a + b, 0);
  const topN = Math.max(1, Math.ceil(hours.length * 0.1));
  const topShare = totalHours ? Math.round((hours.slice(0, topN).reduce((a, b) => a + b, 0) / totalHours) * 100) : 0;

  const leaderKinds = new Set(['campus', 'department', 'team']);
  const areasWithoutLeader = ctx.areas
    .filter((a) => leaderKinds.has(a.kind))
    .filter((a) => !(ctx.byArea.get(a.id) || []).some((x) => x.role_level >= 2))
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind, members: new Set((ctx.byArea.get(a.id) || []).map((x) => x.person_id)).size }));

  const flagCounts = {};
  for (const s of active) for (const f of s.flags) flagCounts[f.code] = (flagCounts[f.code] || 0) + 1;

  const brief = (s) => ({
    id: s.id, name: s.name, level: s.level, risk: s.risk, riskScore: s.riskScore,
    flags: s.flags, load: s.load, readiness: s.readiness,
  });

  return {
    totals: {
      people: summaries.length,
      active: summaries.filter((s) => s.status === 'active').length,
      onBreak: summaries.filter((s) => s.status === 'on_break').length,
      inactive: summaries.filter((s) => s.status === 'inactive').length,
      serving: serving.length,
      leaders: active.filter((s) => s.load.leaderRoles > 0).length,
      positions: ctx.assignments.length,
      monthlyHours: Math.round(totalHours),
      apprenticeships: ctx.apprenticeships.length,
    },
    risk: {
      high: active.filter((s) => s.risk === 'high').length,
      watch: active.filter((s) => s.risk === 'watch').length,
      healthy: active.filter((s) => s.risk === 'healthy').length,
    },
    flagCounts,
    byLevel,
    successionCoverage: leaderAssignments.length ? Math.round((covered / leaderAssignments.length) * 100) : null,
    leaderPositions: leaderAssignments.length,
    hoursConcentration: { topPercent: 10, share: topShare, people: topN },
    areasWithoutLeader,
    watchlist: active
      .filter((s) => s.risk !== 'healthy')
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 12)
      .map(brief),
    readyForNext: active
      .filter((s) => s.readiness.readyForNext)
      .slice(0, 12)
      .map(brief),
    thresholds: ctx.thresholds,
  };
}

module.exports = {
  FREQUENCY_PER_MONTH,
  today,
  isActiveAssignment,
  monthlyHours,
  thresholdsFrom,
  buildContext,
  spanOfCare,
  computeLoad,
  evaluateFlags,
  riskFromFlags,
  readiness,
  personSummary,
  summarizeAll,
  descendantIds,
  areaHealth,
  dashboard,
};
