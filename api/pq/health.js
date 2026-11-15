// api/pq/health.js
// GET /api/pq/health?k=<key>
//
// Answers "is the photo-quote backend wired up?" without guessing. Reports
// which settings are present (true/false only — never the values) and does a
// real round trip against Blob: writes a tiny file, lists it back, deletes it.
//
// Gated by a key derived from PQ_SIGN_SECRET so the world cannot use it to
// probe the deployment. Compute it with:
//   node -e "console.log(require('./lib/pq/http').sign('health'))"
// (run from the repo with PQ_SIGN_SECRET set to the production value).

'use strict';

const { sign, verify } = require('../../lib/pq/http');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verify('health', (req.query && req.query.k) || '')) {
    return res.status(404).json({ ok: false });
  }

  const env = {
    BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN,
    RESEND_API_KEY: !!process.env.RESEND_API_KEY,
    PQ_SIGN_SECRET: !!process.env.PQ_SIGN_SECRET,
    PQ_BASE_URL: process.env.PQ_BASE_URL || null,
    PQ_FROM_EMAIL: process.env.PQ_FROM_EMAIL || null,
    DATABASE_URL: !!(process.env.DATABASE_URL || process.env.POSTGRES_URL),
    node: process.version,
  };

  let blob = { ok: false };
  try {
    const { put, list, del } = require('@vercel/blob');
    const path = 'quotes/_health/' + Date.now() + '.txt';
    const written = await put(path, 'ok', { access: 'public', addRandomSuffix: false, contentType: 'text/plain' });
    const found = await list({ prefix: path, limit: 1 });
    await del(written.url);
    blob = {
      ok: !!(found && found.blobs && found.blobs.length),
      host: (() => { try { return new URL(written.url).host; } catch { return null; } })(),
    };
  } catch (e) {
    blob = { ok: false, error: String(e && e.message || e).slice(0, 300) };
  }

  return res.status(200).json({ ok: blob.ok, env, blob, signKeyPreview: sign('health').slice(0, 6) + '…' });
};
