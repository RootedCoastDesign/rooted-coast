// api/pq/status.js
// POST /api/pq/status  { slug, id, status, key }  →  { ok }
//
// Called only by the status buttons on the lead page. The key is an HMAC over
// slug+id issued when that page was rendered, so holding one lead's link does
// not let you flip the status of another.

'use strict';

const { getTenant } = require('../../lib/pq/tenants');
const { body, verify, clientIp } = require('../../lib/pq/http');
const { setStatus, throttle } = require('../../lib/pq/store');

const ALLOWED = ['new', 'quoted', 'won', 'lost'];

module.exports = async (req, res) => {
  // Same-origin only; the lead page is served from this deployment.
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method' });

  const b = body(req);
  const slug = String(b.slug || '').trim();
  const id = String(b.id || '').trim();
  const status = String(b.status || '').trim();

  if (!getTenant(slug) || !/^[0-9a-f]{24}$/.test(id) || !ALLOWED.includes(status)) {
    return res.status(400).json({ ok: false, reason: 'bad-request' });
  }
  if (!verify('status|' + slug + '|' + id, b.key)) {
    return res.status(403).json({ ok: false, reason: 'bad-key' });
  }
  if (!throttle('st:' + clientIp(req), 60)) {
    return res.status(429).json({ ok: false, reason: 'slow-down' });
  }

  try {
    const lead = await setStatus(slug, id, status);
    if (!lead) return res.status(404).json({ ok: false, reason: 'not-found' });
    return res.status(200).json({ ok: true, status });
  } catch (e) {
    console.error('[pq] status update failed:', e.message);
    return res.status(500).json({ ok: false, reason: 'failed' });
  }
};
