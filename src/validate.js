'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (msg) => new HttpError(400, msg);

function str(v, label, { required = false, max = 2000 } = {}) {
  if (v == null || v === '') {
    if (required) throw bad(`${label} is required.`);
    return '';
  }
  const s = String(v).trim();
  if (required && !s) throw bad(`${label} is required.`);
  if (s.length > max) throw bad(`${label} is too long (max ${max} characters).`);
  return s;
}

function int(v, label, { min = -Infinity, max = Infinity, required = false, fallback = null } = {}) {
  if (v == null || v === '') {
    if (required) throw bad(`${label} is required.`);
    return fallback;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number between ${min} and ${max}.`);
  return n;
}

function num(v, label, { min = -Infinity, max = Infinity, fallback = null } = {}) {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${label} must be a number between ${min} and ${max}.`);
  return n;
}

function date(v, label, { required = false } = {}) {
  if (v == null || v === '') {
    if (required) throw bad(`${label} is required.`);
    return null;
  }
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw bad(`${label} must be a date (YYYY-MM-DD).`);
  return s;
}

function oneOf(v, label, options, fallback) {
  if (v == null || v === '') {
    if (fallback !== undefined) return fallback;
    throw bad(`${label} is required.`);
  }
  if (!options.includes(v)) throw bad(`${label} must be one of: ${options.join(', ')}.`);
  return v;
}

function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0;
}

function id(v, label = 'id') {
  return int(v, label, { min: 1, required: true });
}

module.exports = { HttpError, bad, str, int, num, date, oneOf, bool, id };
