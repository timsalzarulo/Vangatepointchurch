import { api, html, mount, on, can, state, toast, formDialog, confirmDialog, empty, invalidateCaches } from '../lib.js';

const THRESHOLDS = [
  ['max_monthly_hours', 'Max serving hours per month', 'Across all roles. Includes prep and meetings.'],
  ['max_active_roles', 'Max active roles per person', ''],
  ['max_weekly_roles', 'Max weekly roles per person', ''],
  ['max_leader_roles', 'Max leadership roles per person', 'Areas someone leads (level 2+ roles).'],
  ['max_span_of_care', 'Max span of care', 'People a leader is directly responsible for. Many churches use 1:10 or less.'],
  ['checkin_interval_days', 'Leader check-in every (days)', ''],
  ['low_capacity_score', 'Flag check-in capacity at or below (1–5)', ''],
  ['max_months_without_break', 'Months without a break before flagging', ''],
];

export default async function settings({ root, rerender }) {
  const s = await api('/settings');
  const users = can.admin() ? await api('/users') : [];
  const peopleCount = (await api('/people')).length;
  const admin = can.admin();

  mount(
    root,
    html`<header class="page-head"><div><h1>Settings</h1></div></header>
    <section class="panel">
      <h2>Capacity guidelines</h2>
      <p class="muted small">These drive the burnout flags. Set them to match your church’s culture${admin ? '' : ' (admins only)'}.</p>
      <form id="settings-form" class="grid-form">
        <div class="field wide"><label for="church_name">Church name</label>
          <input id="church_name" name="church_name" value="${s.church_name}" ${admin ? '' : html`disabled`} required></div>
        ${THRESHOLDS.map(([key, label, help]) => html`<div class="field"><label for="${key}">${label}</label>
          <input id="${key}" name="${key}" type="number" min="0" step="1" value="${s[key]}" ${admin ? '' : html`disabled`}>
          ${help ? html`<small>${help}</small>` : ''}</div>`)}
        ${admin ? html`<div class="field wide"><button class="btn primary" type="submit">Save guidelines</button></div>` : ''}
      </form>
    </section>

    ${admin ? html`<section class="panel">
      <div class="panel-head"><h2>Users</h2><button class="btn small" id="add-user">Add user</button></div>
      <p class="muted small"><strong>Viewer</strong> can see everything · <strong>Editor</strong> can update people, roles, development and check-ins ·
        <strong>Admin</strong> can also manage users and guidelines.</p>
      ${users.length ? html`<ul class="list compact">${users.map((u) => html`<li><span><strong>${u.name}</strong> <span class="muted small">${u.email}</span></span>
        <span><span class="pill">${u.role}</span> <button class="link" data-edit-user="${u.id}">Edit</button>
        ${u.id !== state.user.id ? html`<button class="link danger" data-del-user="${u.id}">Remove</button>` : ''}</span></li>`)}</ul>` : empty('No users.')}
    </section>` : ''}

    ${admin ? html`<section class="panel">
      <h2>Example data</h2>
      <p class="muted small">Load a fictional church (two campuses, five ministries, about 300 made-up volunteers with roles,
        apprentices, check-ins and ratings) to explore the app and tune standards and guidelines. When you are ready for
        real names, clear it. Clearing removes all people, ministries and teams, but keeps users, settings, levels,
        standards and training.</p>
      <p class="small">There ${peopleCount === 1 ? 'is 1 person' : `are ${peopleCount} people`} in the app right now.</p>
      <div class="actions">
        <button class="btn" id="load-examples" ${peopleCount ? html`disabled title="Clear people & teams first"` : ''}>Load example data</button>
        <button class="btn danger ghost" id="clear-people" ${peopleCount ? '' : html`disabled`}>Clear all people & teams…</button>
      </div>
    </section>` : ''}

    <section class="panel">
      <h2>My account</h2>
      <p>${state.user.name} · ${state.user.email} · <span class="pill">${state.user.role}</span></p>
      <button class="btn" id="change-password">Change password</button>
    </section>`,
  );

  root.querySelector('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      state.settings = await api('/settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      const el = document.getElementById('church-name');
      if (el) el.textContent = state.settings.church_name;
      toast('Guidelines saved');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  root.querySelector('#change-password').addEventListener('click', () =>
    formDialog({
      title: 'Change password',
      fields: [
        { name: 'current', label: 'Current password', type: 'password', required: true },
        { name: 'password', label: 'New password', type: 'password', required: true, help: 'At least 10 characters.' },
      ],
      onSubmit: (v) => api('/auth/password', { method: 'POST', body: v }),
    }).then((r) => r && toast('Password changed')),
  );

  if (!admin) return;
  const userForm = (u = null) =>
    formDialog({
      title: u ? `Edit ${u.name}` : 'Add user',
      fields: [
        { name: 'name', label: 'Name', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'role', label: 'Access', type: 'select', options: [['viewer', 'Viewer'], ['editor', 'Editor'], ['admin', 'Admin']] },
        { name: 'password', label: u ? 'New password (leave blank to keep)' : 'Temporary password', type: 'password', required: !u, help: 'At least 10 characters.' },
      ],
      values: u || { role: 'editor' },
      onSubmit: (v) => (u ? api(`/users/${u.id}`, { method: 'PUT', body: v }) : api('/users', { method: 'POST', body: v })),
    });
  root.querySelector('#load-examples').addEventListener('click', async () => {
    const r = await api('/example-data', { method: 'POST' });
    invalidateCaches();
    toast(`Loaded ${r.people} example people`);
    location.hash = '#/';
  });
  root.querySelector('#clear-people').addEventListener('click', async () => {
    const r = await formDialog({
      title: 'Clear all people & teams',
      intro: `This permanently deletes all ${peopleCount} people, every ministry and team, and all roles, ratings, check-ins and apprenticeships. Users, settings, levels, standards and training are kept. Export first if you want a copy.`,
      fields: [{ name: 'confirm', label: 'Type DELETE to confirm', required: true, wide: true }],
      submitLabel: 'Delete everything',
      onSubmit: (v) => api('/clear-people', { method: 'POST', body: v }),
    });
    if (r) {
      invalidateCaches();
      toast('People and teams cleared');
      rerender();
    }
  });
  root.querySelector('#add-user').addEventListener('click', async () => (await userForm()) && rerender());
  on(root, 'click', '[data-edit-user]', async (_e, b) => (await userForm(users.find((u) => u.id === Number(b.dataset.editUser)))) && rerender());
  on(root, 'click', '[data-del-user]', async (_e, b) => {
    const u = users.find((x) => x.id === Number(b.dataset.delUser));
    if (!(await confirmDialog(`Remove ${u.name}'s access?`, { confirmLabel: 'Remove' }))) return;
    await api(`/users/${u.id}`, { method: 'DELETE' });
    rerender();
  });
}
