import {
  api, html, mount, on, can, state, toast, confirmDialog, levelBadge, riskBadge, flagChips, bar, empty,
  fmtDate, levelName, areaOptions, queryString, invalidateCaches, formDialog, levelOptions,
  STATUS_LABEL, FREQ_LABEL, RATING_LABEL, TRAINING_STATUS,
} from '../lib.js';
import { editPerson, editAssignment, editApprenticeship, logCheckin } from '../forms.js';

// ---------------------------------------------------------------------------
// People list
// ---------------------------------------------------------------------------

export async function peopleList({ root, query }) {
  const [people, areas] = await Promise.all([api(`/people${queryString(query)}`), areaOptions()]);
  const sel = (name, options) => html`<select name="${name}">${options.map(
    ([v, l]) => html`<option value="${v}"${String(query[name] || '') === String(v) ? html` selected` : ''}>${l}</option>`,
  )}</select>`;

  mount(
    root,
    html`<header class="page-head"><div><h1>People</h1>
        <p class="muted">${people.length} ${people.length === 1 ? 'person' : 'people'}${Object.keys(query).length ? ' matching filters' : ''}</p></div>
      ${can.edit() ? html`<button class="btn primary" id="add-person">Add person</button>` : ''}</header>
    <form class="filters" id="filters">
      <input type="search" name="q" placeholder="Search name, email, phone…" value="${query.q || ''}">
      ${sel('level', [['', 'All levels'], ...levelOptions()])}
      ${sel('status', [['', 'Any status'], ...Object.entries(STATUS_LABEL)])}
      ${sel('risk', [['', 'Any capacity'], ['high', 'At risk'], ['watch', 'Watch'], ['healthy', 'Healthy']])}
      ${sel('area', [['', 'All areas'], ...areas.map((a) => [String(a.id), a.path])])}
      <button class="btn" type="submit">Filter</button>
      ${Object.keys(query).length ? html`<a class="btn ghost" href="#/people">Clear</a>` : ''}
    </form>
    <section class="panel flush">
      ${people.length
        ? html`<div class="table-wrap"><table class="table hover">
          <thead><tr><th>Name</th><th>Level</th><th>Serves / leads</th><th class="num">Hrs / mo</th>
            <th class="num">Span</th><th>Capacity</th><th>Level progress</th></tr></thead>
          <tbody>${people.map((p) => html`<tr data-href="#/people/${p.id}">
            <td><a href="#/people/${p.id}"><strong>${p.name}</strong></a>
              ${p.status !== 'active' ? html` <span class="pill">${STATUS_LABEL[p.status]}</span>` : ''}
              <div class="muted small">${p.email}</div></td>
            <td>${levelBadge(p.level, { short: true })}</td>
            <td class="roles-cell">${p.roles.length
              ? p.roles.slice(0, 3).map((r) => html`<div class="${r.role_level >= 2 ? 'lead-role' : ''}">${r.role} · <span class="muted">${r.area}</span></div>`)
              : html`<span class="muted">Not serving</span>`}${p.roles.length > 3 ? html`<div class="muted small">+${p.roles.length - 3} more</div>` : ''}</td>
            <td class="num">${p.load.monthlyHours}</td>
            <td class="num">${p.load.spanOfCare || ''}</td>
            <td>${riskBadge(p.risk)}</td>
            <td class="progress-cell">${bar(p.readiness.percent, 100, 'thin')} <span class="small muted">${p.readiness.percent}%</span></td>
          </tr>`)}</tbody></table></div>`
        : empty('No people match. Add people or import a CSV from Import / Export.')}
    </section>`,
  );

  root.querySelector('#filters').addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `#/people${queryString(Object.fromEntries(new FormData(e.target)))}`;
  });
  root.querySelectorAll('#filters select').forEach((s) => s.addEventListener('change', () => s.form.requestSubmit()));
  on(root, 'click', 'tr[data-href]', (e, tr) => {
    if (!e.target.closest('a')) location.hash = tr.dataset.href;
  });
  root.querySelector('#add-person')?.addEventListener('click', async () => {
    const r = await editPerson();
    if (r?.id) location.hash = `#/people/${r.id}`;
  });
}

// ---------------------------------------------------------------------------
// Person detail
// ---------------------------------------------------------------------------

export async function personDetail({ root, params, query, rerender }) {
  const id = Number(params[0]);
  const p = await api(`/people/${id}`);
  const edit = can.edit();
  const activeRoles = p.assignments.filter((a) => a.active);
  const pastRoles = p.assignments.filter((a) => !a.active);
  const devLevel = Number(query.level) || p.level;
  const comps = p.competencies.filter((c) => c.level_id === devLevel);
  const trainings = p.trainings.filter((t) => t.level_id == null || t.level_id <= Math.min(5, p.level + 1));
  const asLeader = p.apprenticeships.filter((a) => a.leader_id === id);
  const asApprentice = p.apprenticeships.filter((a) => a.apprentice_id === id);
  const L = p.load;
  const T = state.settings;

  const metric = (label, value, limit, suffix = '') => {
    const over = limit != null && Number(value) > Number(limit);
    return html`<div class="metric ${over ? 'over' : ''}"><span class="metric-value">${value ?? '—'}${suffix}</span>
      <span class="metric-label">${label}${limit != null ? html` <span class="muted">/ ${limit}</span>` : ''}</span></div>`;
  };

  const ratingControl = (c) => html`<div class="rating" role="group" aria-label="Rating for ${c.name}">
    ${RATING_LABEL.map((label, i) => html`<button type="button" class="rate r${i} ${c.rating === i ? 'on' : ''}"
      data-comp="${c.id}" data-rating="${i}" ${edit ? '' : html`disabled`} title="${label}">${label}</button>`)}
  </div>`;

  const byCat = (cat) => comps.filter((c) => c.category === cat);

  mount(
    root,
    html`<nav class="crumbs"><a href="#/people">People</a> › ${p.name}</nav>
    <header class="page-head person-head">
      <div>
        <h1>${p.name} ${riskBadge(p.risk)}</h1>
        <p>${levelBadge(p.level)} <span class="pill">${STATUS_LABEL[p.status]}${p.status === 'on_break' && p.break_until ? ` until ${fmtDate(p.break_until)}` : ''}</span>
          ${p.campus ? html`<span class="muted">· ${p.campus}</span>` : ''}</p>
        <p class="muted small">${[p.email, p.phone].filter(Boolean).join(' · ')}${p.joined_date ? ` · serving since ${fmtDate(p.joined_date)}` : ''}</p>
        ${p.leaders.length ? html`<p class="small">Led / coached by ${p.leaders.map((l, i) => html`${i ? ', ' : ''}<a href="#/people/${l.id}">${l.name}</a> <span class="muted">(${l.role})</span>`)}</p>` : ''}
      </div>
      ${edit ? html`<div class="actions">
        <button class="btn primary" id="checkin">Log check-in</button>
        <button class="btn" id="edit">Edit</button>
        <button class="btn" id="level">Change level</button>
        <button class="btn danger ghost" id="delete">Delete</button></div>` : ''}
    </header>

    <section class="panel">
      <div class="panel-head"><h2>Capacity & care</h2>${riskBadge(p.risk)}</div>
      <div class="metrics">
        ${metric('Active roles', L.activeRoles, T.max_active_roles)}
        ${metric('Leadership roles', L.leaderRoles, T.max_leader_roles)}
        ${metric('Weekly roles', L.weeklyRoles, T.max_weekly_roles)}
        ${metric('Hours / month', L.monthlyHours, T.max_monthly_hours)}
        ${metric('Span of care', L.spanOfCare, T.max_span_of_care)}
        ${metric('Apprentices', L.apprentices)}
        ${metric('Last capacity', L.lastCapacity != null ? `${L.lastCapacity}/5` : '—')}
        ${metric('Last check-in', L.lastCheckinDate ? `${L.daysSinceCheckin}d ago` : 'never')}
      </div>
      ${p.flags.length
        ? html`<ul class="flag-list">${p.flags.map((f) => html`<li class="sev-${f.severity}"><strong>${f.label}</strong> — ${f.detail}</li>`)}</ul>`
        : html`<p class="good-text">No capacity concerns right now.</p>`}
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Where ${p.first_name} serves & leads</h2>
        ${edit ? html`<button class="btn small" id="add-role">Add role</button>` : ''}</div>
      ${activeRoles.length
        ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>Area</th><th>Role</th><th>Requires</th><th>How often</th><th class="num">Hrs / mo</th><th></th></tr></thead>
          <tbody>${activeRoles.map((a) => html`<tr class="${a.role_level > p.level ? 'stretched' : ''}">
            <td><a href="#/areas/${a.area_id}">${a.area_path}</a></td>
            <td>${a.role_level >= 2 ? html`<strong>${a.role}</strong>` : a.role}</td>
            <td>${levelBadge(a.role_level, { short: true })}${a.role_level > p.level ? html` <span class="chip sev-low" title="This role requires a higher level than ${p.first_name}'s current level">stretch</span>` : ''}</td>
            <td>${FREQ_LABEL[a.frequency]} · ${a.hours}h</td>
            <td class="num">${a.monthly_hours}</td>
            <td class="row-actions">${edit ? html`<button class="link" data-edit-role="${a.id}">Edit</button>
              <button class="link" data-end-role="${a.id}">Step off</button>` : ''}</td>
          </tr>`)}</tbody></table></div>`
        : empty(`${p.first_name} isn’t currently serving in any area.`)}
      ${pastRoles.length ? html`<details class="past"><summary>${pastRoles.length} past role${pastRoles.length === 1 ? '' : 's'}</summary>
        <ul class="list compact">${pastRoles.map((a) => html`<li><span>${a.role} · ${a.area_path}</span>
          <span class="muted small">${fmtDate(a.start_date)} – ${fmtDate(a.end_date)}
          ${edit ? html` <button class="link" data-edit-role="${a.id}">Edit</button> <button class="link danger" data-del-role="${a.id}">Delete</button>` : ''}</span></li>`)}</ul></details>` : ''}
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Apprenticeship</h2>
        ${edit ? html`<div><button class="btn small" id="add-apprentice">Add apprentice</button>
          <button class="btn small" id="add-mentor">Add leader developing ${p.first_name}</button></div>` : ''}</div>
      <div class="cols tight">
        <div><h3>Developing</h3>${asLeader.length
          ? html`<ul class="list compact">${asLeader.map((a) => apprenticeRow(a, a.apprentice_id, a.apprentice_name, edit))}</ul>`
          : html`<p class="muted small">${L.leaderRoles ? `${p.first_name} leads but has no apprentice yet.` : 'No apprentices.'}</p>`}</div>
        <div><h3>Being developed by</h3>${asApprentice.length
          ? html`<ul class="list compact">${asApprentice.map((a) => apprenticeRow(a, a.leader_id, a.leader_name, edit))}</ul>`
          : html`<p class="muted small">No one is apprenticing ${p.first_name} right now.</p>`}</div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Development</h2>
        <div class="tabs">${[1, 2, 3, 4, 5].map((n) => html`<a class="tab ${n === devLevel ? 'active' : ''}" href="#/people/${id}?level=${n}">L${n}${n === p.level ? ' •' : ''}</a>`)}</div></div>
      <p><strong>${levelName(devLevel)}</strong>${devLevel === p.level
        ? html` — current level · <strong>${p.readiness.percent}%</strong> demonstrated
            (${p.readiness.competenciesMet}/${p.readiness.competenciesTotal} standards consistent,
            ${p.readiness.trainingsMet}/${p.readiness.trainingsTotal} required trainings)
            ${p.readiness.readyForNext ? html` <span class="pill good">Ready for ${levelName(p.level + 1)}</span>` : ''}`
        : devLevel > p.level ? html` <span class="muted">— next steps ahead</span>` : html` <span class="muted">— foundation</span>`}</p>
      ${devLevel === p.level ? bar(p.readiness.percent, 100, `lvl-bg-${p.level}`) : ''}
      ${['Be', 'Know', 'Do'].map((cat) => byCat(cat).length ? html`<h3 class="cat">${cat}</h3>
        <ul class="standards">${byCat(cat).map((c) => html`<li><div><strong>${c.name}</strong>
          <div class="muted small">${c.description}</div>
          ${c.assessed_at ? html`<div class="muted tiny">Rated by ${c.assessed_by} · ${fmtDate(c.assessed_at)}</div>` : ''}</div>
          ${ratingControl(c)}</li>`)}</ul>` : '')}
      ${!comps.length ? empty('No standards defined for this level yet. Add them on the Pipeline page.') : ''}
    </section>

    <div class="cols">
      <section class="panel">
        <h2>Training</h2>
        ${trainings.length ? html`<ul class="list compact">${trainings.map((t) => html`<li>
          <span>${levelBadge(t.level_id, { short: true })} ${t.title}${t.required ? html` <span class="muted small">required</span>` : ''}
            ${t.completed_at ? html`<span class="muted tiny"> · ${fmtDate(t.completed_at)}</span>` : ''}</span>
          <select data-training="${t.id}" ${edit ? '' : html`disabled`} class="status-${t.status || 'none'}">
            ${Object.entries(TRAINING_STATUS).map(([v, l]) => html`<option value="${v}"${(t.status || 'none') === v ? html` selected` : ''}>${l}</option>`)}
          </select></li>`)}</ul>` : empty('No trainings defined yet.')}
      </section>
      <section class="panel">
        <h2>Level history</h2>
        ${p.history.length ? html`<ul class="timeline">${p.history.map((h) => html`<li>
          <span class="muted small">${fmtDate(h.date)}</span>
          <span>${h.from_level ? html`${levelBadge(h.from_level, { short: true })} → ` : ''}${levelBadge(h.to_level, { short: true })}
            ${h.note ? html`<span class="muted small">${h.note}</span>` : ''}${h.changed_by ? html`<span class="muted tiny"> · ${h.changed_by}</span>` : ''}</span></li>`)}</ul>`
          : empty('No history yet.')}
      </section>
    </div>

    <section class="panel">
      <div class="panel-head"><h2>Check-ins</h2>${edit ? html`<button class="btn small" id="checkin2">Log check-in</button>` : ''}</div>
      ${p.checkins.length ? html`<ul class="checkins">${p.checkins.map((c) => html`<li>
        <div class="checkin-head"><strong>${fmtDate(c.date)}</strong>
          ${c.capacity ? html`<span class="pill cap-${c.capacity}">Capacity ${c.capacity}/5</span>` : ''}
          ${c.spiritual_health ? html`<span class="pill">Spiritual health ${c.spiritual_health}/5</span>` : ''}
          <span class="muted small">with ${c.conducted_by}</span>
          ${edit ? html`<button class="link danger" data-del-checkin="${c.id}">Delete</button>` : ''}</div>
        ${c.notes ? html`<p class="pre">${c.notes}</p>` : ''}
        ${c.next_steps ? html`<p class="pre"><strong>Next steps:</strong> ${c.next_steps}</p>` : ''}</li>`)}</ul>`
        : empty('No check-ins yet. Regular check-ins are the best early warning for burnout.')}
    </section>

    ${p.notes ? html`<section class="panel"><h2>Notes</h2><p class="pre">${p.notes}</p></section>` : ''}`,
  );

  if (!edit) return;
  const refresh = () => rerender();
  const click = (sel, fn) => root.querySelector(sel)?.addEventListener('click', fn);

  click('#edit', async () => (await editPerson(p)) && refresh());
  click('#checkin', async () => (await logCheckin(p)) && refresh());
  click('#checkin2', async () => (await logCheckin(p)) && refresh());
  click('#add-role', async () => (await editAssignment({ personId: id })) && refresh());
  click('#add-apprentice', async () => (await editApprenticeship({ leaderId: id, areaId: activeRoles.find((a) => a.role_level >= 2)?.area_id })) && refresh());
  click('#add-mentor', async () => (await editApprenticeship({ apprenticeId: id })) && refresh());
  click('#level', async () => {
    const r = await formDialog({
      title: `Change ${p.first_name}'s level`,
      intro: p.readiness.readyForNext
        ? `${p.first_name} has demonstrated every standard at ${levelName(p.level)}.`
        : `${p.first_name} has demonstrated ${p.readiness.percent}% of ${levelName(p.level)}.`,
      fields: [
        { name: 'level', label: 'New level', type: 'select', options: levelOptions() },
        { name: 'level_note', label: 'Note', wide: true, help: 'Why now? e.g. “Completed apprenticeship, now leads Parking team.”' },
      ],
      values: { level: String(Math.min(5, p.level + (p.readiness.readyForNext ? 1 : 0))) },
      onSubmit: (v) => api(`/people/${id}`, { method: 'PUT', body: v }),
    });
    if (r) {
      toast('Level updated');
      refresh();
    }
  });
  click('#delete', async () => {
    if (!(await confirmDialog(`Delete ${p.name} and all of their roles, ratings and check-ins? This cannot be undone.`))) return;
    await api(`/people/${id}`, { method: 'DELETE' });
    invalidateCaches();
    location.hash = '#/people';
  });

  on(root, 'click', '[data-comp]', async (_e, btn) => {
    const current = p.competencies.find((c) => c.id === Number(btn.dataset.comp));
    const rating = Number(btn.dataset.rating);
    await api(`/people/${id}/competencies/${btn.dataset.comp}`, {
      method: 'PUT',
      body: { rating: current.rating === rating ? null : rating },
    });
    refresh();
  });
  on(root, 'change', '[data-training]', async (_e, sel) => {
    await api(`/people/${id}/trainings/${sel.dataset.training}`, { method: 'PUT', body: { status: sel.value } });
    refresh();
  });
  on(root, 'click', '[data-edit-role]', async (_e, b) => {
    const a = p.assignments.find((x) => x.id === Number(b.dataset.editRole));
    if (await editAssignment({ assignment: a, personId: id })) refresh();
  });
  on(root, 'click', '[data-end-role]', async (_e, b) => {
    const a = p.assignments.find((x) => x.id === Number(b.dataset.endRole));
    if (!(await confirmDialog(`Record that ${p.first_name} stepped off “${a.role}” today? It stays in their history.`, { confirmLabel: 'Step off', danger: false }))) return;
    await api(`/assignments/${a.id}`, { method: 'PUT', body: { end_date: new Date().toISOString().slice(0, 10) } });
    refresh();
  });
  on(root, 'click', '[data-del-role]', async (_e, b) => {
    if (!(await confirmDialog('Delete this role from history entirely?'))) return;
    await api(`/assignments/${b.dataset.delRole}`, { method: 'DELETE' });
    refresh();
  });
  on(root, 'click', '[data-del-checkin]', async (_e, b) => {
    if (!(await confirmDialog('Delete this check-in?'))) return;
    await api(`/checkins/${b.dataset.delCheckin}`, { method: 'DELETE' });
    refresh();
  });
  on(root, 'click', '[data-edit-ap]', async (_e, b) => {
    const ap = p.apprenticeships.find((x) => x.id === Number(b.dataset.editAp));
    if (await editApprenticeship({ apprenticeship: ap })) refresh();
  });
}

function apprenticeRow(a, otherId, otherName, edit) {
  return html`<li><span><a href="#/people/${otherId}">${otherName}</a> → ${levelBadge(a.target_level, { short: true })}
    ${a.area_path ? html`<span class="muted small">${a.area_path}</span>` : ''}
    ${a.status !== 'active' ? html`<span class="pill">${a.status}</span>` : ''}</span>
    <span class="muted small">since ${fmtDate(a.start_date)} ${edit ? html`<button class="link" data-edit-ap="${a.id}">Edit</button>` : ''}</span></li>`;
}

