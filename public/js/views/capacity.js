import { api, html, mount, on, riskBadge, levelBadge, flagChips, empty, queryString, stat, FREQ_LABEL, levelOptions } from '../lib.js';

const FLAG_OPTIONS = [
  ['low_capacity', 'Low capacity reported'],
  ['hours', 'High serving hours'],
  ['leader_roles', 'Leading too many areas'],
  ['roles', 'Too many roles'],
  ['weekly', 'Too many weekly commitments'],
  ['span', 'Span of care too wide'],
  ['no_break', 'No recent break'],
  ['on_break_scheduled', 'On break but still assigned'],
  ['checkin_overdue', 'Check-in overdue'],
  ['stretched', 'Serving above pipeline level'],
  ['no_apprentice', 'No apprentice'],
];

export default async function capacity({ root, query }) {
  const { thresholds: t, people: all } = await api('/capacity');
  let people = all;
  if (query.risk) people = people.filter((p) => p.risk === query.risk);
  if (query.flag) people = people.filter((p) => p.flags.some((f) => f.code === query.flag));
  if (query.level) people = people.filter((p) => p.level === Number(query.level));
  if (query.q) people = people.filter((p) => p.name.toLowerCase().includes(query.q.toLowerCase()));
  const count = (r) => all.filter((p) => p.risk === r).length;
  const sel = (name, options) => html`<select name="${name}">${options.map(
    ([v, l]) => html`<option value="${v}"${String(query[name] || '') === String(v) ? html` selected` : ''}>${l}</option>`,
  )}</select>`;

  mount(
    root,
    html`<header class="page-head"><div><h1>Capacity & Care</h1>
      <p class="muted">See everything each person serves in and leads, and catch overload before it becomes burnout.</p></div></header>

    <section class="stats">
      ${stat('At risk', html`<a href="#/capacity?risk=high">${count('high')}</a>`, 'act this week', 'danger')}
      ${stat('Watch', html`<a href="#/capacity?risk=watch">${count('watch')}</a>`, 'talk about it at the next check-in', 'warn')}
      ${stat('Healthy', count('healthy'), 'serving with margin')}
    </section>

    <details class="panel guidelines"><summary><strong>How flags are calculated</strong> <span class="muted small">(guidelines are adjustable in Settings)</span></summary>
      <ul class="small">
        <li><strong>High serving hours</strong> — more than ${t.maxMonthlyHours} hrs/month across all roles (frequency × hours each time).</li>
        <li><strong>Too many roles</strong> — more than ${t.maxActiveRoles} active roles; <strong>too many weekly commitments</strong> — more than ${t.maxWeeklyRoles} weekly roles.</li>
        <li><strong>Leading too many areas</strong> — leadership roles (level 2+) in more than ${t.maxLeaderRoles} areas.</li>
        <li><strong>Span of care</strong> — directly responsible for more than ${t.maxSpanOfCare} people (people under them in areas they lead + leaders of areas directly beneath).</li>
        <li><strong>Low capacity</strong> — most recent check-in capacity score ${t.lowCapacityScore}/5 or lower.</li>
        <li><strong>No recent break</strong> — leaders or heavy servers with more than ${t.maxMonthsWithoutBreak} months since a break.</li>
        <li><strong>Check-in overdue</strong> — leaders with no check-in in ${t.checkinIntervalDays} days.</li>
        <li><strong>Serving above level</strong> — a role requires a higher pipeline level than the person has; <strong>no apprentice</strong> — a leadership role with no one being developed.</li>
        <li><em>At risk</em> = any high-severity flag or 3+ medium flags. <em>Watch</em> = any medium flag or 3+ low flags.</li>
      </ul>
    </details>

    <form class="filters" id="filters">
      <input type="search" name="q" placeholder="Search name…" value="${query.q || ''}">
      ${sel('risk', [['', 'Any capacity'], ['high', 'At risk'], ['watch', 'Watch'], ['healthy', 'Healthy']])}
      ${sel('flag', [['', 'Any flag'], ...FLAG_OPTIONS])}
      ${sel('level', [['', 'All levels'], ...levelOptions()])}
      <button class="btn" type="submit">Filter</button>
      ${Object.keys(query).length ? html`<a class="btn ghost" href="#/capacity">Clear</a>` : ''}
    </form>

    <section class="panel flush">
      ${people.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Person</th><th>Capacity</th><th class="num">Hrs / mo</th><th class="num">Roles</th><th class="num">Leading</th>
          <th class="num">Span</th><th class="num">Last check-in</th><th>Flags</th></tr></thead>
        <tbody>${people.map((p) => html`<tr>
          <td><a href="#/people/${p.id}"><strong>${p.name}</strong></a> ${levelBadge(p.level, { short: true })}
            <details class="roles"><summary class="small muted">${p.roles.length} role${p.roles.length === 1 ? '' : 's'}</summary>
            <ul class="small">${p.roles.map((r) => html`<li>${r.role} · ${r.area_path} <span class="muted">(${FREQ_LABEL[r.frequency]}, ~${r.monthly_hours}h/mo)</span></li>`)}</ul></details></td>
          <td>${riskBadge(p.risk)}</td>
          <td class="num ${p.load.monthlyHours > t.maxMonthlyHours ? 'over' : ''}">${p.load.monthlyHours}</td>
          <td class="num ${p.load.activeRoles > t.maxActiveRoles ? 'over' : ''}">${p.load.activeRoles}</td>
          <td class="num ${p.load.leaderRoles > t.maxLeaderRoles ? 'over' : ''}">${p.load.leaderRoles}</td>
          <td class="num ${p.load.spanOfCare > t.maxSpanOfCare ? 'over' : ''}">${p.load.spanOfCare}</td>
          <td class="num">${p.load.lastCapacity != null ? html`<span class="pill cap-${p.load.lastCapacity}">${p.load.lastCapacity}/5</span>` : ''}
            <div class="muted tiny">${p.load.daysSinceCheckin != null ? `${p.load.daysSinceCheckin}d ago` : 'never'}</div></td>
          <td>${flagChips(p.flags)}</td>
        </tr>`)}</tbody></table></div>`
        : html`<div class="pad">${empty('No one matches these filters.')}</div>`}
    </section>`,
  );

  root.querySelector('#filters').addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `#/capacity${queryString(Object.fromEntries(new FormData(e.target)))}`;
  });
  on(root, 'change', '#filters select', (_e, s) => s.form.requestSubmit());
}
