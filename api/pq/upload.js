// api/pq/upload.js
// POST /api/pq/upload   { slug, index, dataUrl }  →  { url, sig }
//
// One photo per request. The widget compresses in the browser first (max 1600px
// on the long edge, JPEG ~0.8), which turns a 6 MB phone photo into roughly
// 300 KB — small enough to send as base64 inside JSON and stay far under
// Vercel's 4.5 MB request cap, and small enough to upload over one bar of LTE
// in a crawlspace.
//
// WHY THE SIGNATURE: photos land in Blob before the form is submitted, so the
// submit endpoint has to be told which URLs belong to this session. Without a
// signature anyone could POST arbitrary image URLs and have them rendered in a
// contractor's inbox. Each URL comes back HMAC-signed, and submit refuses any
// photo whose signature does not check out.
//
// Orphans: a homeowner who uploads two photos and closes the tab leaves those
// blobs behind. They are tiny and unreferenced.
// quarterly cleanup query.

'use strict';

const crypto = require('crypto');
const { getTenant } = require('../../lib/pq/tenants');
const { applyCors, preflight, body, clientIp, sign } = require('../../lib/pq/http');
const { savePhoto, throttle, MAX_PHOTO_BYTES } = require('../../lib/pq/store');

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp|heic));base64,([A-Za-z0-9+/=\s]+)$/;

module.exports = async (req, res) => {
  // Preflight first: it carries no body, so the slug lookup below would
  // 404 it and the browser would never send the real request.
  if (req.method === 'OPTIONS') return preflight(req, res);

  const b = body(req);
  const slug = String(b.slug || (req.query && req.query.slug) || '').trim();
  const tenant = getTenant(slug);

  if (!tenant) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(404).json({ ok: false, reason: 'unknown-site' });
  }
  if (applyCors(req, res, tenant)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method' });

  // 30 uploads/hour/IP: generous for a homeowner retaking shots, tight enough
  // that a script cannot fill the Blob store overnight.
  if (!throttle('up:' + clientIp(req), 30)) {
    return res.status(429).json({ ok: false, reason: 'slow-down' });
  }

  const m = DATA_URL_RE.exec(String(b.dataUrl || ''));
  if (!m) return res.status(400).json({ ok: false, reason: 'bad-image' });

  const contentType = m[1];
  let buf;
  try {
    buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  } catch {
    return res.status(400).json({ ok: false, reason: 'bad-image' });
  }
  if (!buf.length) return res.status(400).json({ ok: false, reason: 'empty-image' });
  if (buf.length > MAX_PHOTO_BYTES) return res.status(413).json({ ok: false, reason: 'too-large' });

  const index = Math.max(0, Math.min(11, parseInt(b.index, 10) || 0));
  const sessionId = crypto.randomBytes(9).toString('hex');

  try {
    const photo = await savePhoto(slug, 'u-' + sessionId, index, buf, contentType);
    return res.status(200).json({
      ok: true,
      url: photo.url,
      bytes: photo.bytes,
      sig: sign(slug + '|' + photo.url),
    });
  } catch (e) {
    console.error('[pq] upload failed:', e.message);
    // The storage library's messages ("No token found", "Access denied",
    // "store not found") name the misconfiguration without exposing anything
    // secret, and being able to read them in the browser's network tab saves a
    // trip through Vercel's log viewer every time this breaks.
    return res.status(500).json({
      ok: false,
      reason: 'upload-failed',
      detail: String(e && e.message || e).slice(0, 200),
    });
  }
};
