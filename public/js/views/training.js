import { api, html, mount, on, can, toast, levelBadge, bar, empty, fmtDate, TRAINING_STATUS, applyWidths } from '../lib.js';

export default async function training({ root, query, rerender }) {
  const { trainings } = await api('/trainings');
  const selected = Number(query.id) || null;
  const detail = selected ? await api(`/trainings/${selected}/people`) : null;
  const edit = can.edit();

  mount(
    root,
    html`<header class="page-head"><div><h1>Training</h1>
      <p class="muted">Completion across the church. “Expected” counts everyone active at or above the training’s level.
      Add or edit trainings on the Pipeline page.</p></div></header>
    <div class="cols wide-left">
      <section class="panel flush">
        ${trainings.length ? html`<div class="table-wrap"><table class="table hover">
          <thead><tr><th>Training</th><th>Level</th><th class="num">Done</th><th class="num">In progress</th><th class="num">Assigned</th><th>Completion</th></tr></thead>
          <tbody>${trainings.map((t) => {
            const pct = t.expected ? Math.round((t.completed / t.expected) * 100) : 0;
            return html`<tr data-href="#/training?id=${t.id}" class="${t.id === selected ? 'selected' : ''}">
              <td><a href="#/training?id=${t.id}"><strong>${t.title}</strong></a> ${t.required ? html`<span class="pill">required</span>` : ''}
                <div class="muted small">${t.format}</div></td>
              <td>${levelBadge(t.level_id, { short: true })}</td>
              <td class="num">${t.completed}</td><td class="num">${t.in_progress}</td><td class="num">${t.assigned}</td>
              <td class="progress-cell">${bar(Math.min(pct, 100), 100, `thin lvl-bg-${t.level_id || 1}`)} <span class="small muted">${pct}% of ${t.expected}</span></td>
            </tr>`;
          })}</tbody></table></div>` : html`<div class="pad">${empty('No trainings yet.')}</div>`}
      </section>
      <section class="panel" id="detail">
        ${detail ? html`<div class="panel-head"><h2>${detail.training.title}</h2></div>
          ${edit ? html`<p><button class="btn small" id="assign-level">Assign to everyone at ${levelBadge(detail.training.level_id || 1, { short: true })} who doesn’t have it</button></p>` : ''}
          <ul class="list compact">${detail.people.map((p) => html`<li>
            <span><a href="#/people/${p.id}">${p.first_name} ${p.last_name}</a> ${levelBadge(p.level, { short: true })}
              ${p.completed_at ? html`<span class="muted tiny">${fmtDate(p.completed_at)}</span>` : ''}</span>
            <select data-person="${p.id}" ${edit ? '' : html`disabled`} class="status-${p.status || 'none'}">
              ${Object.entries(TRAINING_STATUS).map(([v, l]) => html`<option value="${v}"${(p.status || 'none') === v ? html` selected` : ''}>${l}</option>`)}
            </select></li>`)}</ul>
          ${!detail.people.length ? empty('No one at this level yet.') : ''}`
          : empty('Select a training to see who has completed it.')}
      </section>
    </div>`,
  );
  applyWidths(root);
  on(root, 'click', 'tr[data-href]', (e, tr) => {
    if (!e.target.closest('a')) location.hash = tr.dataset.href;
  });
  if (!edit || !detail) return;
  root.querySelector('#assign-level')?.addEventListener('click', async () => {
    const r = await api(`/trainings/${selected}/assign-level`, { method: 'POST' });
    toast(`Assigned to ${r.assigned} ${r.assigned === 1 ? 'person' : 'people'}`);
    rerender();
  });
  on(root, 'change', '[data-person]', async (_e, sel) => {
    await api(`/people/${sel.dataset.person}/trainings/${selected}`, { method: 'PUT', body: { status: sel.value } });
    rerender();
  });
}
