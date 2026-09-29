import { api, html, mount, state, toast, refreshLevels, esc } from './lib.js';
import dashboard from './views/dashboard.js';
import { peopleList, personDetail } from './views/people.js';
import { areasView, areaDetail } from './views/areas.js';
import pipeline from './views/pipeline.js';
import capacity from './views/capacity.js';
import training from './views/training.js';
import dataView from './views/data.js';
import settings from './views/settings.js';

const NAV = [
  ['#/', 'Dashboard', 'dashboard'],
  ['#/people', 'People', 'people'],
  ['#/areas', 'Ministries & Teams', 'areas'],
  ['#/pipeline', 'Pipeline & Standards', 'pipeline'],
  ['#/capacity', 'Capacity & Care', 'capacity'],
  ['#/training', 'Training', 'training'],
  ['#/data', 'Import / Export', 'data'],
  ['#/settings', 'Settings', 'settings'],
];

const ROUTES = [
  [/^\/?$/, dashboard, 'dashboard'],
  [/^\/people$/, peopleList, 'people'],
  [/^\/people\/(\d+)$/, personDetail, 'people'],
  [/^\/areas$/, areasView, 'areas'],
  [/^\/areas\/(\d+)$/, areaDetail, 'areas'],
  [/^\/pipeline$/, pipeline, 'pipeline'],
  [/^\/capacity$/, capacity, 'capacity'],
  [/^\/training$/, training, 'training'],
  [/^\/data$/, dataView, 'data'],
  [/^\/settings$/, settings, 'settings'],
];

const app = document.getElementById('app');

function renderShell(active) {
  if (!app.querySelector('.shell')) {
    mount(
      app,
      html`<div class="shell">
        <aside class="sidebar">
          <div class="brand"><span class="brand-mark">▲</span><div><strong>Leadership Pipeline</strong>
            <small id="church-name">${state.settings.church_name || ''}</small></div></div>
          <button class="btn nav-toggle" id="nav-toggle" aria-expanded="false">Menu</button>
          <nav id="nav">${NAV.map(([href, label, key]) => html`<a href="${href}" data-key="${key}">${label}</a>`)}</nav>
          <div class="user-box"><span>${state.user.name}</span><small>${state.user.role}</small>
            <button class="btn small" id="logout">Sign out</button></div>
        </aside>
        <main id="main" tabindex="-1"></main>
      </div>`,
    );
    document.getElementById('logout').addEventListener('click', async () => {
      await api('/auth/logout', { method: 'POST' });
      state.user = null;
      location.hash = '#/login';
      start();
    });
    const toggle = document.getElementById('nav-toggle');
    toggle.addEventListener('click', () => {
      const open = app.querySelector('.sidebar').classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }
  app.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.key === active));
  app.querySelector('.sidebar').classList.remove('open');
}

async function route() {
  if (!state.user) return;
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = hash.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const match = ROUTES.map(([re, view, key]) => [re.exec(path), view, key]).find(([m]) => m);
  if (!match) {
    location.hash = '#/';
    return;
  }
  const [m, view, key] = match;
  renderShell(key);
  // Fresh element per page so old event listeners are dropped.
  const old = document.getElementById('main');
  const main = old.cloneNode(false);
  old.replaceWith(main);
  main.innerHTML = '<div class="loading">Loading…</div>';
  const ctx = { params: m.slice(1), query, root: main, rerender: route };
  try {
    await view(ctx);
  } catch (err) {
    console.error(err);
    mount(main, html`<div class="panel error-panel"><h2>Something went wrong</h2><p>${err.message}</p></div>`);
  }
  main.focus({ preventScroll: true });
}

function authPage({ setup }) {
  mount(
    app,
    html`<div class="auth-wrap"><form class="auth-card form" id="auth-form">
      <div class="brand"><span class="brand-mark">▲</span><div><strong>Leadership Pipeline</strong>
        <small>${state.settings.church_name || ''}</small></div></div>
      <h1>${setup ? 'Create the first admin account' : 'Sign in'}</h1>
      ${setup ? html`<p class="muted">This account will manage users and settings.</p>` : ''}
      ${setup ? html`<div class="field"><label for="name">Your name</label><input id="name" name="name" required></div>` : ''}
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password"
        autocomplete="${setup ? 'new-password' : 'current-password'}" minlength="${setup ? 10 : 1}" required>
        ${setup ? html`<small>At least 10 characters.</small>` : ''}</div>
      <p class="form-error" hidden></p>
      <button class="btn primary" type="submit">${setup ? 'Create account' : 'Sign in'}</button>
    </form></div>`,
  );
  const form = document.getElementById('auth-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      await api(setup ? '/auth/setup' : '/auth/login', { method: 'POST', body });
      if (location.hash.startsWith('#/login')) location.hash = '#/';
      await start();
    } catch (err) {
      const el = form.querySelector('.form-error');
      el.textContent = err.message;
      el.hidden = false;
    }
  });
}

async function start() {
  const status = await api('/auth/status');
  state.settings.church_name = status.churchName;
  document.title = `Leadership Pipeline · ${status.churchName}`;
  if (!status.user) {
    state.user = null;
    return authPage({ setup: status.needsSetup });
  }
  state.user = status.user;
  const [settingsData] = await Promise.all([api('/settings'), refreshLevels()]);
  state.settings = settingsData;
  if (location.hash.startsWith('#/login')) location.hash = '#/';
  app.innerHTML = '';
  await route();
}

window.addEventListener('hashchange', route);
window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || 'Something went wrong', 'error'));
start().catch((err) => {
  app.innerHTML = `<div class="auth-wrap"><div class="auth-card">Could not load: ${esc(err.message)}</div></div>`;
});
