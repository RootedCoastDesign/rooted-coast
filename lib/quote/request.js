// DRAFT, with quote.js. The private page the notification email links to: one request, read from the
// site's own database. No login: the link carries a signature made with the site's signing secret, the same way
// the photo-quote lead page works. Not indexed, and never linked from a public page.
'use strict';
module.exports = d => async (req, res) => {
  const q = req.query || {}, id = String(q.id || '').replace(/[^a-f0-9]/g, '').slice(0, 40), sig = String(q.sig || '');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'private, no-store');
  if (!id || !d.verify('quote:' + id, sig)) return res.status(404).send('Not found');
  let r = null; try { r = await d.load(id); } catch (e) { r = null; }
  if (!r) return res.status(404).send('Not found');
  const { rowsFor, NEEDS } = require('./core'), e = d.esc;
  const answers = typeof r.answers === 'string' ? JSON.parse(r.answers || '{}') : (r.answers || {});
  const label = r.needLabel || (NEEDS[r.need] || {}).label || 'Request';
  const rows = rowsFor({ ...r, answers, needLabel: label }).filter(x => x[0] !== 'Email' && x[0] !== 'Phone')
    .concat(r.created_at ? [['Received', new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })]] : []);
  const tel = String(r.phone || '').replace(/[^\d+]/g, '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Request</title>'
    + '<style>body{margin:0;background:#040404;color:#B3BEC7;font:16px/1.55 system-ui,Segoe UI,Arial,sans-serif}main{max-width:640px;margin:0 auto;padding:28px 18px 60px}h1{margin:0 0 4px;color:#EEF3F6;font-size:1.5rem}p.s{margin:0 0 22px;color:#7C8892;font-size:.9rem}dl{margin:0;border-top:1px solid #2B3037}dl div{display:grid;grid-template-columns:9rem 1fr;gap:12px;padding:11px 0;border-bottom:1px solid #2B3037}dt{color:#7C8892}dd{margin:0;color:#EEF3F6;overflow-wrap:anywhere;white-space:pre-wrap}.a{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}.a a{padding:13px 18px;border-radius:999px;border:1px solid #4B545F;color:#EEF3F6;text-decoration:none}@media(max-width:520px){dl div{grid-template-columns:1fr;gap:2px}}</style></head><body><main>'
    + '<h1>' + e(label) + '</h1><p class="s">From the website, ' + e(r.business || r.name || '') + '</p>'
    + '<dl>' + rows.map(x => '<div><dt>' + e(x[0]) + '</dt><dd>' + e(x[1]) + '</dd></div>').join('') + '</dl>'
    + '<div class="a">' + (r.email ? '<a href="mailto:' + e(r.email) + '">Email ' + e(r.email) + '</a>' : '') + (tel ? '<a href="tel:' + e(tel) + '">Call ' + e(r.phone) + '</a>' : '') + '</div>'
    + '</main></body></html>');
};
