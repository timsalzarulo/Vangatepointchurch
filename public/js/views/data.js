import { api, html, mount, can, toast, invalidateCaches } from '../lib.js';

const TEMPLATES = {
  people: {
    file: 'people-template.csv',
    csv: 'first_name,last_name,email,phone,campus,level,status,joined_date,external_id\r\nJane,Doe,jane@example.com,555-0100,North Campus,1,active,2023-09-01,\r\n',
  },
  assignments: {
    file: 'roles-template.csv',
    csv: 'email,first_name,last_name,area,role,role_level,frequency,hours,start_date\r\njane@example.com,Jane,Doe,North Campus > Kids > Check-in,Team Leader,2,weekly,3,2024-01-07\r\n',
  },
};

export default async function dataView({ root }) {
  const edit = can.edit();
  const importCard = (kind, title, help) => html`<section class="panel">
    <h2>${title}</h2>
    <div class="small">${help}</div>
    <p><button class="link" data-template="${kind}">Download a template CSV</button></p>
    ${edit ? html`<div class="import" data-kind="${kind}">
      <input type="file" accept=".csv,text/csv" aria-label="${title} file">
      <div class="actions"><button class="btn" data-preview disabled>Preview</button>
        <button class="btn primary" data-import disabled>Import</button></div>
      <div class="result"></div></div>` : html`<p class="muted">You need editor access to import.</p>`}
  </section>`;

  mount(
    root,
    html`<header class="page-head"><div><h1>Import / Export</h1>
      <p class="muted">Bring in your volunteers and their roles from a spreadsheet or a Planning Center export,
      and export everything for reporting.</p></div></header>

    <section class="panel">
      <h2>Export</h2>
      <p><a class="btn" href="/api/export/people.csv" download>People + capacity (CSV)</a>
        <a class="btn" href="/api/export/assignments.csv" download>Roles & assignments (CSV)</a></p>
    </section>

    <div class="cols">
      ${importCard('people', '1. Import people', html`<p>One row per person. Recognized columns: <code>first_name</code>, <code>last_name</code>
        (or <code>name</code>), <code>email</code>, <code>phone</code>, <code>campus</code>, <code>level</code> (1–5 or the level name),
        <code>status</code> (active / on_break / inactive), <code>joined_date</code>, <code>external_id</code> (or <code>person_id</code>).</p>
        <p>Existing people are matched by external ID, then email, then name, and updated — blank cells never erase data.</p>`)}
      ${importCard('assignments', '2. Import roles', html`<p>One row per person per role. Identify the person with <code>email</code>,
        <code>external_id</code> or <code>first_name</code>/<code>last_name</code>. Put the area as a path, e.g.
        <code>North Campus &gt; Kids &gt; Check-in</code> (or use <code>ministry</code> + <code>team</code> columns).
        Also: <code>role</code> (or <code>position</code>), <code>role_level</code> (1 = serving, 2 = team leader, 3 = coach…),
        <code>frequency</code> (weekly, biweekly, monthly, quarterly, occasional), <code>hours</code> each time.</p>
        <p>Missing areas and people are created automatically. Preview first to check.</p>`)}
    </div>`,
  );

  root.querySelectorAll('[data-template]').forEach((b) =>
    b.addEventListener('click', () => {
      const t = TEMPLATES[b.dataset.template];
      const url = URL.createObjectURL(new Blob([t.csv], { type: 'text/csv' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: t.file });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }),
  );

  root.querySelectorAll('.import').forEach((box) => {
    const kind = box.dataset.kind;
    const file = box.querySelector('input[type=file]');
    const preview = box.querySelector('[data-preview]');
    const go = box.querySelector('[data-import]');
    const out = box.querySelector('.result');
    let csv = '';
    file.addEventListener('change', async () => {
      csv = file.files[0] ? await file.files[0].text() : '';
      preview.disabled = go.disabled = !csv;
      out.innerHTML = '';
    });
    const run = async (dryRun) => {
      preview.disabled = go.disabled = true;
      try {
        const r = await api(`/import/${kind}`, { method: 'POST', body: { csv, dryRun } });
        const created = kind === 'people'
          ? `${r.created} new, ${r.updated} updated${r.campusesCreated ? `, ${r.campusesCreated} campuses created` : ''}`
          : `${r.created} new roles, ${r.updated} updated${r.peopleCreated ? `, ${r.peopleCreated} people created` : ''}${r.areasCreated ? `, ${r.areasCreated} areas created` : ''}`;
        mount(out, html`<div class="import-result ${dryRun ? 'preview' : 'done'}">
          <strong>${dryRun ? 'Preview' : 'Imported'}:</strong> ${r.rows} rows — ${created}${r.skipped ? `, ${r.skipped} skipped` : ''}.
          ${dryRun ? html`<div class="muted small">Nothing has been saved yet. Click Import to save.</div>` : ''}
          ${r.errors.length ? html`<ul class="small errors">${r.errors.slice(0, 50).map((e) => html`<li>Row ${e.line}: ${e.message}</li>`)}</ul>` : ''}
        </div>`);
        if (!dryRun) {
          invalidateCaches();
          toast('Import complete');
        }
      } catch (err) {
        mount(out, html`<p class="form-error">${err.message}</p>`);
      } finally {
        preview.disabled = go.disabled = !csv;
      }
    };
    preview.addEventListener('click', () => run(true));
    go.addEventListener('click', () => run(false));
  });
}
