'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Database } = require('../src/db');
const { createApp } = require('../src/server');
const { parseCsv } = require('../src/csv');

async function startServer() {
  const db = new Database(':memory:');
  const server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  const call = async (path, { method = 'GET', body, raw = false } = {}) => {
    const headers = { cookie };
    if (method !== 'GET') headers['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = raw ? await res.text() : await res.json();
    return { status: res.status, data };
  };
  return { db, server, base, call, setCookie: (c) => (cookie = c) };
}

test('auth: setup once, then require sign-in', async (t) => {
  const s = await startServer();
  t.after(() => s.server.close());
  assert.equal((await s.call('/people')).status, 401);
  assert.equal((await s.call('/auth/status')).data.needsSetup, true);
  const weak = await s.call('/auth/setup', { method: 'POST', body: { name: 'A', email: 'a@x.org', password: 'short' } });
  assert.equal(weak.status, 400);
  const ok = await s.call('/auth/setup', { method: 'POST', body: { name: 'A', email: 'a@x.org', password: 'longenough123' } });
  assert.equal(ok.status, 201);
  assert.equal((await s.call('/people')).status, 200);
  const again = await s.call('/auth/setup', { method: 'POST', body: { name: 'B', email: 'b@x.org', password: 'longenough123' } });
  assert.equal(again.status, 403);
  await s.call('/auth/logout', { method: 'POST' });
  assert.equal((await s.call('/people')).status, 401);
  const bad = await s.call('/auth/login', { method: 'POST', body: { email: 'a@x.org', password: 'wrongpassword' } });
  assert.equal(bad.status, 401);
  const good = await s.call('/auth/login', { method: 'POST', body: { email: 'A@x.org', password: 'longenough123' } });
  assert.equal(good.status, 200);
});

test('non-JSON writes are rejected (CSRF guard)', async (t) => {
  const s = await startServer();
  t.after(() => s.server.close());
  const res = await fetch(`${s.base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=a' });
  assert.equal(res.status, 415);
});

test('viewers cannot edit; editors can', async (t) => {
  const s = await startServer();
  t.after(() => s.server.close());
  await s.call('/auth/setup', { method: 'POST', body: { name: 'Admin', email: 'admin@x.org', password: 'longenough123' } });
  await s.call('/users', { method: 'POST', body: { name: 'V', email: 'v@x.org', password: 'longenough123', role: 'viewer' } });
  await s.call('/auth/login', { method: 'POST', body: { email: 'v@x.org', password: 'longenough123' } });
  assert.equal((await s.call('/people', { method: 'POST', body: { first_name: 'X' } })).status, 403);
  assert.equal((await s.call('/users')).status, 403);
  assert.equal((await s.call('/dashboard')).status, 200);
});

test('people, roles, level changes and capacity end to end', async (t) => {
  const s = await startServer();
  t.after(() => s.server.close());
  await s.call('/auth/setup', { method: 'POST', body: { name: 'Admin', email: 'admin@x.org', password: 'longenough123' } });
  const area = (await s.call('/areas', { method: 'POST', body: { name: 'Kids', kind: 'department' } })).data.id;
  const pid = (await s.call('/people', { method: 'POST', body: { first_name: 'Sam', last_name: 'Lee', level: 1 } })).data.id;
  const roleRes = await s.call('/assignments', { method: 'POST', body: { person_id: pid, area_id: area, role: 'Director', role_level: 4, frequency: 'weekly', hours: 8 } });
  assert.equal(roleRes.status, 201);
  const person = (await s.call(`/people/${pid}`)).data;
  assert.equal(person.load.activeRoles, 1);
  assert.ok(person.flags.some((f) => f.code === 'hours'));
  assert.ok(person.flags.some((f) => f.code === 'stretched'));
  await s.call(`/people/${pid}`, { method: 'PUT', body: { level: 4, level_note: 'Promoted' } });
  const after = (await s.call(`/people/${pid}`)).data;
  assert.equal(after.level, 4);
  assert.equal(after.history[0].to_level, 4);
  assert.equal(after.history[0].note, 'Promoted');
  const bad = await s.call('/assignments', { method: 'POST', body: { person_id: pid, area_id: area, role: 'X', role_level: 9 } });
  assert.equal(bad.status, 400);
  const cycle = await s.call(`/areas/${area}`, { method: 'PUT', body: { parent_id: area } });
  assert.equal(cycle.status, 400);
  const cap = (await s.call('/capacity')).data;
  assert.equal(cap.people[0].id, pid);
});

test('CSV import supports dry run, matching and area paths', async (t) => {
  const s = await startServer();
  t.after(() => s.server.close());
  await s.call('/auth/setup', { method: 'POST', body: { name: 'Admin', email: 'admin@x.org', password: 'longenough123' } });
  const people = 'First Name,Last Name,Email,Campus,Level\nAna,Diaz,ana@x.org,North,2\n"Bo, Jr",Kim,bo@x.org,North,Leading Self\n,Nobody,,,\n';
  const dry = (await s.call('/import/people', { method: 'POST', body: { csv: people, dryRun: true } })).data;
  assert.equal(dry.created, 2);
  assert.equal(dry.skipped, 1);
  assert.equal((await s.call('/people')).data.length, 0);
  const real = (await s.call('/import/people', { method: 'POST', body: { csv: people } })).data;
  assert.equal(real.created, 2);
  assert.equal(real.campusesCreated, 1);
  const again = (await s.call('/import/people', { method: 'POST', body: { csv: people } })).data;
  assert.equal(again.updated, 2);
  const list = (await s.call('/people')).data;
  assert.equal(list.length, 2);
  assert.equal(list.find((p) => p.email === 'ana@x.org').level, 2);

  const roles = 'email,area,role,role_level,frequency,hours\nana@x.org,North > Kids > Nursery,Team Leader,2,weekly,3\nbo@x.org,North > Kids > Nursery,Volunteer,1,biweekly,2\n';
  const r = (await s.call('/import/assignments', { method: 'POST', body: { csv: roles } })).data;
  assert.equal(r.created, 2);
  assert.equal(r.areasCreated, 2); // Kids + Nursery (North already exists)
  const areas = (await s.call('/areas')).data;
  const nursery = areas.find((a) => a.name === 'Nursery');
  assert.equal(nursery.kind, 'team');
  assert.equal(nursery.path, 'North › Kids › Nursery');
  assert.equal(nursery.leaders[0].name, 'Ana Diaz');

  const csv = (await s.call('/export/assignments.csv', { raw: true })).data;
  const rows = parseCsv(csv);
  assert.equal(rows.length, 3);
});

test('csv parser handles quotes, commas and newlines', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","he said ""hi""\nthere"\n'), [['a', 'b'], ['x, y', 'he said "hi"\nthere']]);
});
