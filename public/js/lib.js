// Shared helpers: safe HTML templating, API client, dialogs and small components.

export class Safe {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => new Safe(s);

function fmt(v) {
  if (v == null || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(fmt).join('');
  return esc(v);
}

// Tagged template that escapes every interpolated value unless it is Safe.
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += fmt(vals[i]) + strings[i + 1];
  return new Safe(out);
}

export const state = { user: null, settings: {}, levels: [] };

export const can = {
  edit: () => ['editor', 'admin'].includes(state.user?.role),
  admin: () => state.user?.role === 'admin',
};

export async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(`/api${path}`, opts);
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (res.status === 401 && !path.startsWith('/auth')) {
    state.user = null;
    location.hash = '#/login';
  }
  if (!res.ok) throw new Error((isJson && data.error) || `Request failed (${res.status})`);
  return data;
}

// Render into an element, then apply bar widths (CSP forbids inline styles).
export function mount(el, content) {
  el.innerHTML = String(content);
  applyWidths(el);
}

export function applyWidths(el) {
  el.querySelectorAll('[data-w]').forEach((n) => {
    n.style.width = `${Math.max(0, Math.min(100, Number(n.dataset.w) || 0))}%`;
  });
}

// Delegated event listener.
export function on(root, type, selector, handler) {
  root.addEventListener(type, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

export function toast(message, kind = 'ok') {
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

// ---- Formatting -----------------------------------------------------------

export const levelName = (n) => state.levels.find((l) => l.id === Number(n))?.name || `Level ${n}`;

export function levelBadge(n, { short = false } = {}) {
  if (!n) return '';
  return html`<span class="lvl lvl-${Number(n)}" title="${levelName(n)}">L${Number(n)}${short ? '' : html` · ${levelName(n)}`}</span>`;
}

const RISK_LABEL = { high: 'At risk', watch: 'Watch', healthy: 'Healthy' };
export const riskBadge = (risk) => html`<span class="risk risk-${risk}">${RISK_LABEL[risk] || risk}</span>`;

export const STATUS_LABEL = { active: 'Active', on_break: 'On break', inactive: 'Inactive' };
export const FREQ_LABEL = {
  weekly: 'Weekly',
  biweekly: 'Every other week',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  occasional: 'Occasionally',
};
export const KIND_LABEL = { church: 'Church', campus: 'Campus', department: 'Department', team: 'Team', group: 'Group' };
export const RATING_LABEL = ['Not yet', 'Emerging', 'Developing', 'Consistent'];
export const TRAINING_STATUS = { none: '—', assigned: 'Assigned', in_progress: 'In progress', completed: 'Completed' };

export function flagChips(flags, { max = 99 } = {}) {
  if (!flags?.length) return '';
  const shown = flags.slice(0, max);
  return html`<span class="chips">${shown.map(
    (f) => html`<span class="chip sev-${f.severity}" title="${f.detail}">${f.label}</span>`,
  )}${flags.length > max ? html`<span class="chip">+${flags.length - max}</span>` : ''}</span>`;
}

export function bar(value, max, cls = '') {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return html`<span class="bar ${cls}"><span class="bar-fill" data-w="${pct}"></span></span>`;
}

export const stat = (label, value, sub = '', cls = '') =>
  html`<div class="stat ${cls}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div>${
    sub ? html`<div class="stat-sub">${sub}</div>` : ''
  }</div>`;

export const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(`${d.slice(0, 10)}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export const today = () => new Date().toISOString().slice(0, 10);

export const empty = (msg) => html`<div class="empty">${msg}</div>`;

export const levelOptions = () => state.levels.map((l) => [String(l.id), `${l.id} · ${l.name}`]);

// ---- Dialogs --------------------------------------------------------------

function fieldHtml(f, value) {
  const id = `f-${f.name}`;
  const req = f.required ? raw(' required') : '';
  const v = value ?? f.default ?? '';
  let input;
  switch (f.type) {
    case 'textarea':
      input = html`<textarea id="${id}" name="${f.name}" rows="${f.rows || 3}"${req}>${v}</textarea>`;
      break;
    case 'select':
      input = html`<select id="${id}" name="${f.name}"${req}>${f.options.map(
        ([ov, label]) => html`<option value="${ov}"${String(ov) === String(v) ? raw(' selected') : ''}>${label}</option>`,
      )}</select>`;
      break;
    case 'checkbox':
      input = html`<label class="check"><input type="checkbox" id="${id}" name="${f.name}"${
        v && v !== '0' ? raw(' checked') : ''
      }> ${f.checkLabel || ''}</label>`;
      break;
    case 'person': {
      const current = f.people.find((p) => String(p.id) === String(v));
      input = html`<input id="${id}" name="${f.name}" list="${id}-list" autocomplete="off" placeholder="Start typing a name…"
        value="${current ? `${current.name} #${current.id}` : ''}"${req}>
        <datalist id="${id}-list">${f.people.map((p) => html`<option value="${p.name} #${p.id}"></option>`)}</datalist>`;
      break;
    }
    default:
      input = html`<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${v}"${
        f.step ? html` step="${f.step}"` : ''
      }${f.min != null ? html` min="${f.min}"` : ''}${f.max != null ? html` max="${f.max}"` : ''}${req}>`;
  }
  if (f.type === 'checkbox') return html`<div class="field">${input}${f.help ? html`<small>${f.help}</small>` : ''}</div>`;
  return html`<div class="field ${f.wide ? 'wide' : ''}"><label for="${id}">${f.label}</label>${input}${
    f.help ? html`<small>${f.help}</small>` : ''
  }</div>`;
}

export function formDialog({ title, intro, fields, values = {}, submitLabel = 'Save', onSubmit }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    mount(
      dlg,
      html`<form method="dialog" class="form">
        <header><h2>${title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">×</button></header>
        ${intro ? html`<p class="muted">${intro}</p>` : ''}
        <div class="grid-form">${fields.map((f) => fieldHtml(f, values[f.name]))}</div>
        <p class="form-error" hidden></p>
        <footer><button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${submitLabel}</button></footer>
      </form>`,
    );
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    const errorEl = dlg.querySelector('.form-error');
    const close = (result) => {
      dlg.close();
      dlg.remove();
      resolve(result);
    };
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(null)));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        if (f.type === 'checkbox') out[f.name] = el.checked;
        else if (f.type === 'person') {
          const m = /#(\d+)\s*$/.exec(el.value);
          out[f.name] = m ? Number(m[1]) : null;
          if (f.required && !m) {
            errorEl.textContent = `Choose a person from the list for “${f.label}”.`;
            errorEl.hidden = false;
            return;
          }
        } else out[f.name] = el.value;
      }
      const submit = form.querySelector('[type=submit]');
      submit.disabled = true;
      try {
        const result = onSubmit ? await onSubmit(out) : out;
        close(result ?? out);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
        submit.disabled = false;
      }
    });
    dlg.showModal();
    form.querySelector('input:not([type=hidden]), select, textarea')?.focus();
  });
}

export function confirmDialog(message, { confirmLabel = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog small';
    mount(
      dlg,
      html`<form method="dialog" class="form"><p>${message}</p><footer>
        <button type="button" class="btn" data-no>Cancel</button>
        <button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${confirmLabel}</button></footer></form>`,
    );
    document.body.appendChild(dlg);
    const done = (v) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    dlg.querySelector('[data-no]').addEventListener('click', () => done(false));
    dlg.addEventListener('cancel', () => done(false));
    dlg.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      done(true);
    });
    dlg.showModal();
  });
}

// Cached lightweight lists used by pickers.
let peopleCache = null;
let areasCache = null;
export async function peopleOptions(force = false) {
  if (!peopleCache || force) peopleCache = (await api('/people')).map((p) => ({ id: p.id, name: p.name, level: p.level }));
  return peopleCache;
}
export async function areaOptions(force = false) {
  if (!areasCache || force) areasCache = (await api('/areas')).sort((a, b) => a.path.localeCompare(b.path));
  return areasCache;
}
export function invalidateCaches() {
  peopleCache = null;
  areasCache = null;
}

export async function refreshLevels() {
  state.levels = (await api('/levels')).map((l) => ({ id: l.id, name: l.name, focus: l.focus }));
}

export function queryString(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== '' && v != null) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}
