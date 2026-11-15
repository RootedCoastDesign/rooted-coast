// lib/pq/http.js
// Shared request plumbing for the quote endpoints: CORS against the tenant's
// own allowlist, HMAC signing, and body reading.
//
// CORS here is a real gate, not a formality. The widget runs on the client's
// domain and posts cross-origin to this deployment, so `*` would mean anyone
// can point a script at a contractor's inbox. Every endpoint echoes back only
// an origin that appears in that tenant's allowedOrigins.

'use strict';

const crypto = require('crypto');
const { originAllowed, TENANTS } = require('./tenants');

const SIGN_KEY =
  process.env.PQ_SIGN_SECRET ||
  process.env.BLOB_READ_WRITE_TOKEN ||
  'rcd-pq-dev-key-set-PQ_SIGN_SECRET-in-production';

function sign(value) {
  return crypto.createHmac('sha256', SIGN_KEY).update(String(value)).digest('hex').slice(0, 32);
}

function verify(value, sig) {
  const expected = sign(value);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Applies CORS for a tenant and answers the preflight. Returns true when the
// caller should stop (preflight handled, or origin rejected).
function applyCors(req, res, tenant) {
  const origin = req.headers.origin;
  const allowed = originAllowed(tenant, origin);

  if (allowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', tenant.allowedOrigins.includes('*') ? '*' : origin);
    res.setHeader('Vary', 'Origin');
  } else if (tenant && (tenant.allowedOrigins || []).includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }

  // A same-origin request (our own hosted /quote page) sends no Origin header
  // on GET, which is fine. A cross-origin POST always sends one, so a POST from
  // an origin we do not know is refused.
  if (req.method === 'POST' && origin && !allowed) {
    res.status(403).json({ ok: false, reason: 'origin-not-allowed' });
    return true;
  }
  return false;
}

// A CORS preflight (OPTIONS) arrives with NO body, so the tenant slug is not
// known yet. Answer it if the origin belongs to ANY tenant; the real POST that
// follows is still checked against its own tenant's list by applyCors. This
// is the difference between "works from the client's site" and "Failed to
// fetch" with nothing in the console — a preflight that 404s is silent.
function originKnown(origin) {
  if (!origin) return false;
  const o = String(origin).replace(/\/$/, '');
  for (const t of Object.values(TENANTS)) {
    const list = t.allowedOrigins || [];
    if (list.includes('*') || list.includes(o)) return true;
  }
  return false;
}

function preflight(req, res) {
  const origin = req.headers.origin;
  if (!originKnown(origin)) { res.status(403).end(); return; }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).end();
}

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  if (Buffer.isBuffer(req.body)) {
    try { return JSON.parse(req.body.toString('utf8')); } catch { return {}; }
  }
  return req.body;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

// Absolute base URL of this deployment, for building links we put in emails.
function baseUrl(req) {
  if (process.env.PQ_BASE_URL) return process.env.PQ_BASE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

module.exports = { sign, verify, applyCors, preflight, originKnown, body, clientIp, baseUrl };
