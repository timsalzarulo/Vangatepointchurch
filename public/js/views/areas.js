import {
  api, html, mount, on, can, confirmDialog, levelBadge, riskBadge, flagChips, empty, fmtDate, stat,
  KIND_LABEL, FREQ_LABEL, invalidateCaches,
} from '../lib.js';
import { editArea, editAssignment, editApprenticeship } from '../forms.js';

const healthCells = (h) => html`
  <td class="num">${h.people}</td>
  <td class="num">${h.leaders}</td>
  <td class="num">${h.monthlyHours}</td>
  <td>${h.successionCoverage == null ? html`<span class="muted">—</span>` : html`<span class="pill ${h.successionCoverage >= 50 ? 'good' : h.successionCoverage > 0 ? 'warn' : 'danger'}">${h.successionCoverage}%</span>`}</td>
  <td>${h.atRisk ? html`<span class="risk risk-high">${h.atRisk} at risk</span>` : ''} ${h.watch ? html`<span class="risk risk-watch">${h.watch} watch</span>` : ''}</td>`;

// ---------------------------------------------------------------------------
// Tree of every campus / department / team
// ---------------------------------------------------------------------------

export async function areasView({ root, rerender }) {
  const areas = await api('/areas');
  const children = new Map();
  for (const a of areas) {
    const k = a.parent_id ?? 0;
    if (!children.has(k)) children.set(k, []);
    children.get(k).push(a);
  }
  const ids = new Set(areas.map((a) => a.id));
  const roots = areas.filter((a) => a.parent_id == null || !ids.has(a.parent_id));

  const rows = [];
  const walk = (a, depth) => {
    rows.push({ a, depth });
    for (const c of children.get(a.id) || []) walk(c, depth + 1);
  };
  roots.forEach((r) => walk(r, 0));

  mount(
    root,
    html`<header class="page-head"><div><h1>Ministries & Teams</h1>
      <p class="muted">Every campus, department, team and group — who leads it, how many serve, and how healthy it is.
      Numbers roll up from everything inside an area.</p></div>
      ${can.edit() ? html`<button class="btn primary" id="add-area">Add area</button>` : ''}</header>
    <section class="panel flush">
      <div class="table-wrap"><table class="table hover tree">
        <thead><tr><th>Area</th><th>Leader(s)</th><th class="num">People</th><th class="num">Leaders</th>
          <th class="num">Hrs / mo</th><th title="Leadership roles with an apprentice">Succession</th><th>Care</th></tr></thead>
        <tbody>${rows.map(({ a, depth }) => html`<tr data-href="#/areas/${a.id}" class="depth-${Math.min(depth, 4)}">
          <td><span class="indent" data-depth="${depth}"></span><a href="#/areas/${a.id}"><strong>${a.name}</strong></a>
            <span class="kind kind-${a.kind}">${KIND_LABEL[a.kind]}</span></td>
          <td>${a.leaders.length
            ? a.leaders.map((l, i) => html`${i ? ', ' : ''}<a href="#/people/${l.id}">${l.name}</a>`)
            : a.kind === 'church' || a.kind === 'group' ? '' : html`<span class="chip sev-medium">No leader</span>`}</td>
          ${healthCells(a.health)}
        </tr>`)}</tbody></table></div>
    </section>`,
  );
  root.querySelectorAll('.indent').forEach((el) => {
    el.style.paddingLeft = `${Number(el.dataset.depth) * 1.25}rem`;
  });
  on(root, 'click', 'tr[data-href]', (e, tr) => {
    if (!e.target.closest('a')) location.hash = tr.dataset.href;
  });
  root.querySelector('#add-area')?.addEventListener('click', async () => (await editArea()) && rerender());
}

// ---------------------------------------------------------------------------
// One area
// ---------------------------------------------------------------------------

export async function areaDetail({ root, params, rerender }) {
  const id = Number(params[0]);
  const a = await api(`/areas/${id}`);
  const edit = can.edit();
  const h = a.health;
  const leaders = a.members.filter((m) => m.assignment.role_level >= 2);
  const members = a.members.filter((m) => m.assignment.role_level < 2);

  const memberRow = (m) => html`<tr>
    <td><a href="#/people/${m.person.id}"><strong>${m.person.name}</strong></a> ${levelBadge(m.person.level, { short: true })}</td>
    <td>${m.assignment.role}</td>
    <td>${levelBadge(m.assignment.role_level, { short: true })}</td>
    <td>${FREQ_LABEL[m.assignment.frequency]}</td>
    <td class="num">${m.monthly_hours}</td>
    <td>${riskBadge(m.person.risk)} ${flagChips(m.person.flags.filter((f) => f.severity !== 'low'), { max: 2 })}</td>
    <td class="row-actions">${edit ? html`<button class="link" data-edit="${m.assignment.id}">Edit</button>` : ''}</td>
  </tr>`;
  const table = (list) => html`<div class="table-wrap"><table class="table">
    <thead><tr><th>Person</th><th>Role</th><th>Requires</th><th>How often</th><th class="num">Hrs / mo</th><th>Capacity</th><th></th></tr></thead>
    <tbody>${list.map(memberRow)}</tbody></table></div>`;

  mount(
    root,
    html`<nav class="crumbs"><a href="#/areas">Ministries & Teams</a>${a.ancestors.map((x) => html` › <a href="#/areas/${x.id}">${x.name}</a>`)} › ${a.name}</nav>
    <header class="page-head"><div><h1>${a.name} <span class="kind kind-${a.kind}">${KIND_LABEL[a.kind]}</span></h1>
      ${a.description ? html`<p class="muted">${a.description}</p>` : ''}</div>
      ${edit ? html`<div class="actions"><button class="btn primary" id="add-member">Add person</button>
        <button class="btn" id="add-sub">Add area inside</button><button class="btn" id="edit">Edit</button>
        <button class="btn danger ghost" id="delete">Delete</button></div>` : ''}</header>

    <section class="stats">
      ${stat('People (incl. inside)', h.people, `${h.directMembers} directly here`)}
      ${stat('Leaders', h.leaders, h.hasLeader || a.kind === 'church' ? '' : 'No leader directly over this area', h.hasLeader || a.kind === 'church' || a.kind === 'group' ? '' : 'warn')}
      ${stat('Serving hours / month', h.monthlyHours)}
      ${stat('Succession coverage', h.successionCoverage == null ? '—' : `${h.successionCoverage}%`, 'leadership roles with an apprentice', h.successionCoverage != null && h.successionCoverage < 50 ? 'warn' : '')}
      ${stat('At risk', h.atRisk, `${h.watch} to watch`, h.atRisk ? 'danger' : '')}
    </section>

    ${a.children.length ? html`<section class="panel flush"><div class="panel-head pad"><h2>Inside ${a.name}</h2></div>
      <div class="table-wrap"><table class="table hover"><thead><tr><th>Area</th><th class="num">People</th><th class="num">Leaders</th><th class="num">Hrs / mo</th><th>Succession</th><th>Care</th></tr></thead>
      <tbody>${a.children.map((c) => html`<tr data-href="#/areas/${c.id}"><td><a href="#/areas/${c.id}"><strong>${c.name}</strong></a>
        <span class="kind kind-${c.kind}">${KIND_LABEL[c.kind]}</span>
        ${!c.health.hasLeader && c.kind !== 'group' ? html` <span class="chip sev-medium">No leader</span>` : ''}</td>${healthCells(c.health)}</tr>`)}</tbody></table></div></section>` : ''}

    <section class="panel flush"><div class="panel-head pad"><h2>Leaders</h2></div>
      ${leaders.length ? table(leaders) : html`<div class="pad">${empty('No one leads this area directly yet.')}</div>`}</section>

    <section class="panel flush"><div class="panel-head pad"><h2>Serving here</h2><span class="muted">${members.length}</span></div>
      ${members.length ? table(members) : html`<div class="pad">${empty('No one serves directly in this area.')}</div>`}</section>

    <section class="panel"><div class="panel-head"><h2>Apprenticeships</h2>
      ${edit ? html`<button class="btn small" id="add-ap">Add apprenticeship</button>` : ''}</div>
      ${a.apprenticeships.length ? html`<ul class="list compact">${a.apprenticeships.map((ap) => html`<li>
        <span><a href="#/people/${ap.leader_id}">${ap.leader_name}</a> is developing <a href="#/people/${ap.apprentice_id}">${ap.apprentice_name}</a>
          → ${levelBadge(ap.target_level, { short: true })} <span class="muted small">${ap.area_path}</span></span>
        <span class="muted small">since ${fmtDate(ap.start_date)}</span></li>`)}</ul>`
        : empty('No apprenticeships in this area. Who is being prepared to lead next?')}
    </section>`,
  );

  on(root, 'click', 'tr[data-href]', (e, tr) => {
    if (!e.target.closest('a')) location.hash = tr.dataset.href;
  });
  if (!edit) return;
  const click = (sel, fn) => root.querySelector(sel)?.addEventListener('click', fn);
  click('#add-member', async () => (await editAssignment({ areaId: id })) && rerender());
  click('#add-sub', async () => (await editArea({ parentId: id })) && rerender());
  click('#edit', async () => (await editArea({ area: a })) && rerender());
  click('#add-ap', async () => (await editApprenticeship({ areaId: id })) && rerender());
  click('#delete', async () => {
    const msg = a.children.length
      ? 'This area has areas inside it. Move or delete those first.'
      : `Delete ${a.name}? The ${a.members.length} role(s) in it will be removed.`;
    if (a.children.length) return confirmDialog(msg, { confirmLabel: 'OK', danger: false });
    if (!(await confirmDialog(msg))) return;
    await api(`/areas/${id}`, { method: 'DELETE' });
    invalidateCaches();
    location.hash = a.parent_id ? `#/areas/${a.parent_id}` : '#/areas';
  });
  on(root, 'click', '[data-edit]', async (_e, b) => {
    const m = a.members.find((x) => x.assignment.id === Number(b.dataset.edit));
    if (await editAssignment({ assignment: m.assignment, areaId: id })) rerender();
  });
}
