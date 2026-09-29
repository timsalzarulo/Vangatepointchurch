'use strict';

const crypto = require('node:crypto');

const SESSION_COOKIE = 'lp_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.run('DELETE FROM sessions WHERE expires_at < :now', { now: Date.now() });
  db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (:token, :userId, :exp)', {
    token,
    userId,
    exp: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function sessionCookie(token, req, maxAgeMs = SESSION_TTL_MS) {
  const secure = req.secure || process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
}

// Attaches req.user when a valid session cookie is present.
function loadUser(db) {
  return (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    req.sessionToken = token;
    if (token) {
      const row = db.get(
        `SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = :token AND s.expires_at > :now`,
        { token, now: Date.now() },
      );
      if (row) req.user = row;
    }
    next();
  };
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (ROLE_RANK[req.user.role] < ROLE_RANK[role]) {
      return res.status(403).json({ error: 'You do not have permission to do that.' });
    }
    next();
  };
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  parseCookies,
  createSession,
  sessionCookie,
  loadUser,
  requireRole,
};
