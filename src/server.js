'use strict';

// Friendly message instead of a crash on Node versions without node:sqlite.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\nThis app needs Node.js 22.13 or newer (you have ${process.versions.node}).`);
  console.error('Download the LTS version from https://nodejs.org and try again.\n');
  process.exit(1);
}

const path = require('node:path');
const express = require('express');
const { openDatabase } = require('./db');
const auth = require('./auth');
const { HttpError } = require('./validate');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    );
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '6mb' }));
  // CSRF protection: state-changing requests must be JSON, which a
  // cross-site form cannot send without a CORS preflight.
  api.use((req, _res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
      return next(new HttpError(415, 'Requests must be sent as JSON.'));
    }
    next();
  });
  api.use(auth.loadUser(db));
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // admin registers the public auth routes, then requires sign-in for the rest.
  require('./routes/admin').register(api, db);
  require('./routes/people').register(api, db);
  require('./routes/org').register(api, db);
  require('./routes/pipeline').register(api, db);

  api.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));
  // eslint-disable-next-line no-unused-vars
  api.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong.' : err.message });
  });

  app.use('/api', api);
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
  return app;
}

if (require.main === module) {
  const db = openDatabase();
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  const server = createApp(db).listen(port, host, () => {
    console.log(`\nLeadership pipeline is running. Open http://${host}:${port} in your browser.`);
    console.log('Keep this window open while you use the app. Close it (or press Ctrl+C) to stop.\n');
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nPort ${port} is already in use — the app may already be running.`);
      console.error(`Try opening http://${host}:${port}, or close the other window first.\n`);
    } else console.error(err);
    process.exit(1);
  });
}

module.exports = { createApp };
