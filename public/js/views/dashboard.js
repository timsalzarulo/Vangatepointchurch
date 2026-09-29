import { api, html, mount, stat, riskBadge, levelBadge, flagChips, bar, empty, state, KIND_LABEL } from '../lib.js';

const FLAG_NAMES = {
  low_capacity: 'Low capacity reported',
  hours: 'High serving hours',
  leader_roles: 'Leading too many areas',
  roles: 'Too many roles',
  weekly: 'Too many weekly commitments',
  span: 'Span of care too wide',
  no_break: 'No recent break',
  on_break_scheduled: 'On break but still assigned',
  checkin_overdue: 'Leader check-in overdue',
  stretched: 'Serving above pipeline level',
  no_apprentice: 'Leader without an apprentice',
};

export default async function dashboard({ root }) {
  const d = await api('/dashboard');
  const t = d.totals;
  const maxPeople = Math.max(...d.byLevel.map((l) => Math.max(l.people, l.positions)), 1);

  const personRow = (p, extra) => html`<li><a href="#/people/${p.id}" class="row-link">
    <span class="row-main"><strong>${p.name}</strong> ${levelBadge(p.level, { short: true })}</span>
    <span class="row-extra">${extra(p)}</span></a></li>`;

  mount(
    root,
    html`<header class="page-head"><div><h1>Pipeline health</h1>
      <p class="muted">${state.settings.church_name} · across every ministry, team and leader</p></div></header>

    <section class="stats">
      ${stat('People in the pipeline', t.active + t.onBreak, `${t.onBreak} on break · ${t.inactive} inactive`)}
      ${stat('Serving', t.serving, `${t.positions} active roles`)}
      ${stat('Leading', t.leaders, `${d.leaderPositions} leadership roles`)}
      ${stat('Serving hours / month', t.monthlyHours.toLocaleString(), `Top ${d.hoursConcentration.topPercent}% carry ${d.hoursConcentration.share}%`)}
      ${stat('Succession coverage', d.successionCoverage == null ? '—' : `${d.successionCoverage}%`, 'leadership roles with an apprentice', d.successionCoverage != null && d.successionCoverage < 50 ? 'warn' : '')}
      ${stat('Care needed', html`<a href="#/capacity?risk=high">${d.risk.high}</a>`, html`at risk · <a href="#/capacity?risk=watch">${d.risk.watch} to watch</a>`, d.risk.high ? 'danger' : '')}
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Leadership bench by level</h2>
        <a href="#/pipeline" class="muted">Standards & training →</a></div>
      <p class="muted small">For each level: how many people are there, how many roles need that level,
        and who is coming up behind them (active apprentices + people who have demonstrated the level below).</p>
      <div class="table-wrap"><table class="table bench">
        <thead><tr><th>Level</th><th>People at level</th><th>Roles requiring it</th><th>Apprentices</th><th>Ready from level below</th><th>Bench</th></tr></thead>
        <tbody>${d.byLevel.map((l) => {
          const bench = l.apprentices + l.readyFromBelow;
          const benchCls = l.level === 1 ? '' : bench >= l.positions * 0.5 ? 'good' : bench > 0 ? 'warn' : 'danger';
          return html`<tr>
            <td>${levelBadge(l.level)}</td>
            <td><a href="#/people?level=${l.level}">${l.people}</a> ${bar(l.people, maxPeople, `lvl-bg-${l.level}`)}</td>
            <td>${l.positions}</td>
            <td>${l.level === 1 ? '—' : l.apprentices}</td>
            <td>${l.level === 1 ? '—' : l.readyFromBelow}</td>
            <td>${l.level === 1 ? '—' : html`<span class="pill ${benchCls}">${bench} for ${l.positions} role${l.positions === 1 ? '' : 's'}</span>`}</td>
          </tr>`;
        })}</tbody>
      </table></div>
    </section>

    <div class="cols">
      <section class="panel">
        <div class="panel-head"><h2>Capacity watchlist</h2><a href="#/capacity" class="muted">All →</a></div>
        ${d.watchlist.length
          ? html`<ul class="list">${d.watchlist.map((p) => personRow(p, (x) => html`${riskBadge(x.risk)} ${flagChips(x.flags.filter((f) => f.severity !== 'low'), { max: 2 })}`))}</ul>`
          : empty('No one is currently flagged. 🎉')}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Ready for the next level</h2><a href="#/pipeline" class="muted">Pipeline →</a></div>
        <p class="muted small">Consistent in every standard and required training at their current level.</p>
        ${d.readyForNext.length
          ? html`<ul class="list">${d.readyForNext.map((p) => personRow(p, (x) => html`<span class="muted small">ready for</span> ${levelBadge(x.level + 1, { short: true })}`))}</ul>`
          : empty('No one has completed their current level yet. Rate standards on each person’s page.')}
      </section>
    </div>

    <div class="cols">
      <section class="panel">
        <h2>What’s driving risk</h2>
        ${Object.keys(d.flagCounts).length
          ? html`<ul class="list compact">${Object.entries(d.flagCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([code, n]) => html`<li><a class="row-link" href="#/capacity?flag=${code}"><span>${FLAG_NAMES[code] || code}</span><strong>${n}</strong></a></li>`)}</ul>`
          : empty('No flags.')}
      </section>
      <section class="panel">
        <h2>Areas without a leader</h2>
        ${d.areasWithoutLeader.length
          ? html`<ul class="list compact">${d.areasWithoutLeader.map((a) => html`<li><a class="row-link" href="#/areas/${a.id}">
              <span>${a.name} <span class="muted small">${KIND_LABEL[a.kind]}</span></span><span class="muted small">${a.members} serving</span></a></li>`)}</ul>`
          : empty('Every campus, department and team has a leader.')}
      </section>
    </div>`,
  );
}
