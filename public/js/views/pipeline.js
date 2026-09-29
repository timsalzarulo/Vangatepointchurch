import {
  api, html, mount, on, can, confirmDialog, formDialog, levelBadge, riskBadge, bar, empty, refreshLevels, levelOptions,
} from '../lib.js';

const CAT_HELP = {
  Be: 'Character — who a leader at this level is becoming.',
  Know: 'Knowledge — what they need to understand.',
  Do: 'Skills — what they consistently do.',
};

export default async function pipeline({ root, query, rerender }) {
  const levels = await api('/levels');
  const current = Number(query.level) || 1;
  const L = levels.find((l) => l.id === current) || levels[0];
  const edit = can.edit();
  const ready = L.people.filter((p) => p.readiness.readyForNext);

  mount(
    root,
    html`<header class="page-head"><div><h1>Pipeline & Standards</h1>
      <p class="muted">The five levels of leadership. Each level has clear standards (Be · Know · Do) and training,
      so every leader knows what’s expected and what’s next.</p></div></header>

    <nav class="pipeline-steps">${levels.map((l) => html`<a href="#/pipeline?level=${l.id}" class="step lvl-step-${l.id} ${l.id === current ? 'active' : ''}">
      <span class="step-num">${l.id}</span><span class="step-name">${l.name}</span>
      <span class="step-count">${l.people.length} people · ${l.positions} roles</span></a>`)}</nav>

    <section class="panel level-panel lvl-border-${L.id}">
      <div class="panel-head"><div><h2>${levelBadge(L.id, { short: true })} ${L.name}</h2>
        <p class="lead">${L.focus}</p></div>
        ${edit ? html`<button class="btn small" id="edit-level">Edit level</button>` : ''}</div>
      <p>${L.description}</p>
      <p class="muted small"><strong>Typical roles:</strong> ${L.typical_roles || '—'}</p>
    </section>

    <div class="cols wide-left">
      <section class="panel">
        <div class="panel-head"><h2>Standards</h2>${edit ? html`<button class="btn small" id="add-comp">Add standard</button>` : ''}</div>
        ${['Be', 'Know', 'Do'].map((cat) => {
          const list = L.competencies.filter((c) => c.category === cat);
          return html`<h3 class="cat">${cat} <span class="muted small">${CAT_HELP[cat]}</span></h3>
            ${list.length ? html`<ul class="standards">${list.map((c) => html`<li><div><strong>${c.name}</strong>
              <div class="muted small">${c.description}</div></div>
              ${edit ? html`<span class="row-actions"><button class="link" data-edit-comp="${c.id}">Edit</button>
                <button class="link danger" data-del-comp="${c.id}">Delete</button></span>` : ''}</li>`)}</ul>`
              : html`<p class="muted small">None yet.</p>`}`;
        })}
      </section>

      <div>
        <section class="panel">
          <div class="panel-head"><h2>Training</h2>${edit ? html`<button class="btn small" id="add-training">Add</button>` : ''}</div>
          ${L.trainings.length ? html`<ul class="list compact">${L.trainings.map((t) => html`<li><span><strong>${t.title}</strong>
            ${t.required ? html`<span class="pill">required</span>` : ''}
            <div class="muted small">${[t.format, t.description].filter(Boolean).join(' · ')}</div>
            ${t.url ? html`<a class="small" href="${/^https?:\/\//.test(t.url) ? t.url : '#'}" target="_blank" rel="noopener">Open resource ↗</a>` : ''}</span>
            ${edit ? html`<span class="row-actions"><button class="link" data-edit-training="${t.id}">Edit</button>
              <button class="link danger" data-del-training="${t.id}">Delete</button></span>` : ''}</li>`)}</ul>`
            : empty('No training for this level yet.')}
        </section>

        <section class="panel">
          <div class="panel-head"><h2>People at this level</h2><a class="muted" href="#/people?level=${L.id}">All →</a></div>
          <p class="muted small">${L.people.length} people · ${L.apprentices} apprentices developing toward this level
            ${L.id < 5 ? html` · <strong>${ready.length}</strong> ready for ${levelBadge(L.id + 1, { short: true })}` : ''}</p>
          ${L.people.length ? html`<ul class="list compact">${L.people.slice(0, 40).map((p) => html`<li>
            <a class="row-link" href="#/people/${p.id}"><span>${p.name} ${p.readiness.readyForNext ? html`<span class="pill good">ready</span>` : ''}</span>
            <span class="progress-cell">${riskBadge(p.risk)} ${bar(p.readiness.percent, 100, `thin lvl-bg-${L.id}`)} <span class="small muted">${p.readiness.percent}%</span></span></a></li>`)}</ul>
            ${L.people.length > 40 ? html`<p class="small"><a href="#/people?level=${L.id}">See all ${L.people.length} →</a></p>` : ''}`
            : empty('No one at this level yet.')}
        </section>
      </div>
    </div>`,
  );

  if (!edit) return;
  const click = (sel, fn) => root.querySelector(sel)?.addEventListener('click', fn);

  click('#edit-level', async () => {
    const r = await formDialog({
      title: `Edit level ${L.id}`,
      fields: [
        { name: 'name', label: 'Name', required: true },
        { name: 'focus', label: 'Focus (one line)', wide: true },
        { name: 'description', label: 'Description', type: 'textarea', wide: true, rows: 4 },
        { name: 'typical_roles', label: 'Typical roles', wide: true },
      ],
      values: L,
      onSubmit: (v) => api(`/levels/${L.id}`, { method: 'PUT', body: v }),
    });
    if (r) {
      await refreshLevels();
      rerender();
    }
  });

  const compForm = (c = null) => formDialog({
    title: c ? 'Edit standard' : `Add standard to ${L.name}`,
    fields: [
      { name: 'category', label: 'Category', type: 'select', options: [['Be', 'Be (character)'], ['Know', 'Know (knowledge)'], ['Do', 'Do (skill)']] },
      { name: 'level_id', label: 'Level', type: 'select', options: levelOptions() },
      { name: 'name', label: 'Standard', required: true, wide: true },
      { name: 'description', label: 'What it looks like', type: 'textarea', wide: true },
      { name: 'sort', label: 'Order', type: 'number', default: '0' },
    ],
    values: c || { level_id: String(L.id), category: 'Do' },
    onSubmit: (v) => (c ? api(`/competencies/${c.id}`, { method: 'PUT', body: v }) : api('/competencies', { method: 'POST', body: v })),
  });

  const trainingForm = (t = null) => formDialog({
    title: t ? 'Edit training' : `Add training to ${L.name}`,
    fields: [
      { name: 'title', label: 'Title', required: true, wide: true },
      { name: 'level_id', label: 'Level', type: 'select', options: levelOptions() },
      { name: 'format', label: 'Format', help: 'e.g. In person, Online, Cohort, Video, Book' },
      { name: 'url', label: 'Link (optional)', type: 'url', wide: true },
      { name: 'description', label: 'Description', type: 'textarea', wide: true },
      { name: 'required', label: '', type: 'checkbox', checkLabel: 'Required to complete this level' },
      { name: 'sort', label: 'Order', type: 'number', default: '0' },
    ],
    values: t || { level_id: String(L.id) },
    onSubmit: (v) => (t ? api(`/trainings/${t.id}`, { method: 'PUT', body: v }) : api('/trainings', { method: 'POST', body: v })),
  });

  click('#add-comp', async () => (await compForm()) && rerender());
  click('#add-training', async () => (await trainingForm()) && rerender());
  on(root, 'click', '[data-edit-comp]', async (_e, b) => (await compForm(L.competencies.find((c) => c.id === Number(b.dataset.editComp)))) && rerender());
  on(root, 'click', '[data-edit-training]', async (_e, b) => (await trainingForm(L.trainings.find((t) => t.id === Number(b.dataset.editTraining)))) && rerender());
  on(root, 'click', '[data-del-comp]', async (_e, b) => {
    if (!(await confirmDialog('Delete this standard? Ratings for it will also be removed.'))) return;
    await api(`/competencies/${b.dataset.delComp}`, { method: 'DELETE' });
    rerender();
  });
  on(root, 'click', '[data-del-training]', async (_e, b) => {
    if (!(await confirmDialog('Delete this training? Completion records for it will also be removed.'))) return;
    await api(`/trainings/${b.dataset.delTraining}`, { method: 'DELETE' });
    rerender();
  });
}
