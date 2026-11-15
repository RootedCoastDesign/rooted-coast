// The quote form function.
// The site build copies it to lib/quote/core.js, served by api/quote.js. It follows the photo-quote system in this
// repo (lib/pq): the site's own function, each request saved in the site's file storage, and email through Resend.
//
// POST /api/quote   { need, answers, name, business, email, phone, reach, town, details, page, _hp, startedAt }
//   -> 200 { ok: true, id }            saved, and the email to hello@ was attempted
//   -> 400 { ok: false, reason }       what to fix ('missing:<question id>' names the first unanswered question)
//   -> 429 { ok: false, reason }       too many from one place
// GET /api/quote?id=<id>&sig=<sig>     the private page the email links to (see request.js)
//
// Two emails, both in the site's look (email.js): the request, to hello@; and a short confirmation with a copy of
// their answers, to the visitor, when they gave an email address.
//
// Needs, in Vercel: BLOB_READ_WRITE_TOKEN and RESEND_API_KEY (both already used by photo quotes),
// and optionally QUOTE_TO (defaults to hello@rootedcoastdesign.com) and QUOTE_FROM.
// Nothing here throws at the visitor: if the email fails the request is still saved and the response says so.
'use strict';
const { brandEmail } = require('./email');

// The questions. This list is the single source: the form page is drawn from it and the function checks against it,
// so the two cannot drift. Every offering on the site has a way in. `pages` is the order the form walks through
// them, a few at a time. A required question always has a "not sure" answer where one makes sense.
// type: single (pick one), multi (pick any), text, url, range (a slider; the top of the range means "that or more").
const DEVICE = { id: 'device', short: 'Device', label: 'What is it?', type: 'single', required: true, options: ['Desktop', 'Laptop', 'Printer, Wi-Fi or network', 'Something else'] };
const FILES = { id: 'files', short: 'Files to keep', label: 'Are there files on it you need to keep?', type: 'single', required: true, options: ['Yes', 'No', 'Not sure'] };
const HOW = { id: 'how', short: 'How', label: 'How would you like it looked at?', type: 'single', required: true, options: ['Drop-off in Bandon', 'A visit to me', 'Pickup and return', 'Not sure yet'] };
const NEEDS = {
  website: { label: 'A new website', pick: 'A new website', business: true, pages: [{ title: 'About the site', q: ['have', 'size', 'features'] }, { title: 'Getting it ready', q: ['content', 'when', 'url', 'about'] }], q: [
    { id: 'have', short: 'Has now', label: 'What do you have now?', type: 'single', required: true, options: ['No website yet', 'A website that needs replacing'] },
    { id: 'size', short: 'Size', label: 'Which size sounds right?', type: 'single', required: true, options: ['Starter, one page', 'Standard, 3 to 5 pages', 'Custom, larger', 'Not sure yet'] },
    { id: 'features', short: 'Needs', label: 'Does it need any of these?', hint: 'Pick any that apply', type: 'multi', options: ['Online booking', 'Selling online', 'A photo gallery', 'A quote or contact form', 'A blog or news', 'None of these', 'Not sure yet'] },
    { id: 'content', short: 'Words and photos', label: 'Do you have the words and photos?', type: 'single', required: true, options: ['Yes, ready to go', 'Some of them', 'No, I need help', 'Not sure yet'] },
    { id: 'when', short: 'Timing', label: 'When do you want it live?', type: 'single', required: true, options: ['As soon as possible', 'Within a month', 'No rush'] },
    { id: 'url', short: 'Current site', label: 'Your current site, if you have one', type: 'url' },
    { id: 'about', short: 'The business', label: 'What does your business do?', type: 'text', required: true }
  ] },
  existing: { label: 'Help with a website I already have', pick: 'Help with my current website', business: true, pages: [{ title: 'Your current site', q: ['want', 'url', 'about'] }], q: [
    { id: 'want', short: 'Wants', label: 'What would help?', hint: 'Pick any that apply', type: 'multi', required: true, options: ['A new look, same content (Reskin)', 'An SEO audit', 'A care plan: hosting, backups and updates', 'Fixes or changes', 'Not sure yet'] },
    { id: 'url', short: 'Site', label: 'Your website address', type: 'url', required: true },
    { id: 'about', short: 'What they want', label: 'What is not working, or what do you want changed?', type: 'text', required: true }
  ] },
  software: { label: 'Custom software', pick: 'Custom software', business: true, pages: [{ title: 'About the tool', q: ['kind', 'users', 'budget'] }, { title: 'The work it helps with', q: ['today', 'use'] }], q: [
    { id: 'kind', short: 'Kind', label: 'What kind of tool?', hint: 'Pick any that apply', type: 'multi', required: true, options: ['A portal for customers or staff', 'Quoting, booking or scheduling', 'A dashboard or reports', 'Payments or subscriptions', 'Connecting systems I already use', 'Something else'] },
    { id: 'users', short: 'Used by', label: 'Who will use it?', type: 'single', required: true, options: ['Just me', 'My staff', 'My customers', 'Staff and customers'] },
    { id: 'budget', short: 'Budget', label: 'Rough budget', type: 'single', required: true, options: ['Under $1,000', '$1,000 to $5,000', 'More than $5,000', 'Not sure yet'] },
    { id: 'today', short: 'Today', label: 'How does the work get done today?', type: 'text', required: true },
    { id: 'use', short: 'Should do', label: 'What should the software do?', type: 'text', required: true }
  ] },
  diagnostic: { label: 'A computer diagnostic', pick: 'A diagnostic', town: true, pages: [{ title: 'About the computer', q: ['device', 'problem'] }, { title: 'Getting it looked at', q: ['files', 'how'] }], q: [
    DEVICE,
    { id: 'problem', short: 'What is going on', label: 'What is going on with it?', type: 'text', required: true },
    FILES, HOW
  ] },
  fix: { label: 'A repair or upgrade', pick: 'A repair or upgrade', town: true, pages: [{ title: 'About the job', q: ['job', 'device', 'problem'] }, { title: 'Getting it done', q: ['files', 'how'] }], q: [
    { id: 'job', short: 'Job', label: 'What kind of job?', type: 'single', required: true, options: ['Repair', 'Upgrade', 'Tech support or setup', 'Not sure yet'] },
    DEVICE,
    { id: 'problem', short: 'What is needed', label: 'What needs doing?', type: 'text', required: true },
    FILES, HOW
  ] },
  build: { label: 'A new custom PC', pick: 'A new PC build', town: true, pages: [{ title: 'About the build', q: ['use', 'budget'] }, { title: 'The details', q: ['extras', 'how', 'notes'] }], q: [
    { id: 'use', short: 'For', label: 'What is it for?', hint: 'Pick any that apply', type: 'multi', required: true, options: ['Gaming', 'Work or office', 'Video or photo editing', 'Programming', 'Home and family', 'Something else'] },
    { id: 'budget', short: 'Budget', label: 'Rough budget', type: 'range', required: true, min: 500, max: 5000, step: 100, notSure: 'Not sure yet' },
    { id: 'extras', short: 'With it', label: 'Do you need any of these with it?', hint: 'Pick any that apply', type: 'multi', options: ['A monitor', 'Keyboard and mouse', 'Windows', 'Files moved from my old computer', 'None of these'] },
    { id: 'how', short: 'Getting it', label: 'How would you like to get it?', type: 'single', required: true, options: ['Pick it up in Bandon', 'Brought to me', 'Not sure yet'] },
    { id: 'notes', short: 'Wants in it', label: 'Anything specific you want in it?', type: 'text' }
  ] },
  other: { label: 'Something else', pick: 'Something else', pages: [{ title: 'What you need', q: ['about'] }], q: [
    { id: 'about', short: 'What they need', label: 'What do you need?', type: 'text', required: true }
  ] }
};
const REACH = ['Email', 'Call', 'Text'];
const MIN_SECONDS = 3;

// a slider's answer as text: $500 ... $4,900, and $5,000+ at the top
const rangeText = (q, n) => '$' + Number(n).toLocaleString('en-US') + (Number(n) >= q.max ? '+' : '');
const rangeOk = (q, v) => { if (v === q.notSure) return true; const n = Number(String(v).replace(/[^0-9]/g, '')); return n >= q.min && n <= q.max && (n - q.min) % q.step === 0 && v === rangeText(q, n); };
const clean = (s, max) => String(s == null ? '' : s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, max);
const validEmail = e => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(e || '').trim());
const validPhone = p => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 && d.length <= 15; };

// Reads and checks one submission. Returns { ok: false, reason } or { ok: true, request }.
function parse(b) {
  const need = clean(b.need, 20), N = NEEDS[need];
  if (!N) return { ok: false, reason: 'need-required' };
  const answers = {}, incoming = (b.answers && typeof b.answers === 'object') ? b.answers : {};
  for (const q of N.q) {
    const raw = incoming[q.id]; let v;
    if (q.type === 'single') { v = clean(raw, 120); if (!q.options.includes(v)) v = ''; }
    else if (q.type === 'multi') { v = (Array.isArray(raw) ? raw : (raw == null ? [] : [raw])).map(x => clean(x, 120)).filter(x => q.options.includes(x)); v = [...new Set(v)]; if (!v.length) v = ''; }
    else if (q.type === 'range') { v = clean(raw, 20); if (!rangeOk(q, v)) v = ''; }
    else v = clean(raw, q.type === 'url' ? 200 : 1500);
    if (v !== '') answers[q.id] = v;
    else if (q.required) return { ok: false, reason: 'missing:' + q.id };
  }
  const name = clean(b.name, 120), business = clean(b.business, 160), town = clean(b.town, 80), email = clean(b.email, 160), phone = clean(b.phone, 30);
  if (!name) return { ok: false, reason: 'name-required' };
  if (N.business && !business) return { ok: false, reason: 'business-required' };
  if (!validEmail(email) && !validPhone(phone)) return { ok: false, reason: 'contact-required' };
  if (email && !validEmail(email)) return { ok: false, reason: 'bad-email' };
  if (phone && !validPhone(phone)) return { ok: false, reason: 'bad-phone' };
  if (N.town && !town) return { ok: false, reason: 'town-required' };
  const reach = REACH.includes(clean(b.reach, 10)) ? clean(b.reach, 10) : '';
  return { ok: true, request: { need, needLabel: N.label, answers, name, business, email, phone, reach, town, details: clean(b.details, 4000), page: clean(b.page, 200) } };
}

// The card the assistant fills in during a conversation (kind: 'card'). It has no fixed questions: a job title, a
// short summary, the facts gathered as "Label: value", and one way to reach the visitor. A name is optional.
function parseCard(b) {
  const job = clean(b.job, 60), summary = clean(b.summary, 320), contact = clean(b.contact, 160), name = clean(b.name, 120);
  if (!job) return { ok: false, reason: 'job-required' };
  const card = (Array.isArray(b.details) ? b.details : []).slice(0, 10).map(x => clean(x, 90)).filter(Boolean).map(x => { const k = x.indexOf(':'); return k > 0 && k < 28 ? [x.slice(0, k).trim(), x.slice(k + 1).trim()] : ['Note', x]; }).filter(x => x[1]);
  if (card.length < 3) return { ok: false, reason: 'details-required' };
  const email = validEmail(contact) ? contact : '', digits = contact.replace(/[^0-9]/g, ''), phone = !email && digits.length >= 7 && digits.length <= 15 ? contact : '';
  if (!email && !phone) return { ok: false, reason: 'contact-required' };
  const talk = (Array.isArray(b.transcript) ? b.transcript : []).slice(-40).map(x => (x && x.role === 'assistant' ? 'Assistant: ' : 'Visitor: ') + clean(x && x.text, 1200)).join(' / ').slice(0, 9000);
  return { ok: true, request: { need: 'card', needLabel: job, side: b.side === 'design' ? 'Rooted Coast Design' : 'Rooted Coast Tech', answers: {}, card, name, business: '', email, phone, reach: '', town: '', details: summary, talk, conv: /^[0-9a-f]{24}$/.test(String(b.conv || '')) ? b.conv : '', page: clean(b.page, 200) } };
}

// The request as label and value pairs, in the order the questions were asked.
function rowsFor(r, forVisitor) {
  const N = NEEDS[r.need] || { q: [] }, a = r.answers || {};
  return [[forVisitor ? 'You asked for' : 'Need', r.needLabel || N.label || r.need]]
    .concat(N.q.filter(q => a[q.id] != null && a[q.id] !== '').map(q => [forVisitor ? q.label.replace(/\?$/, '') : (q.short || q.label), Array.isArray(a[q.id]) ? a[q.id].join(', ') : a[q.id]]))
    .concat(r.side && !forVisitor ? [['Side', r.side]] : []).concat(r.card || [])
    .concat([['Anything else', r.details], ['Name', r.name], ['Business', r.business], ['Email', r.email], ['Phone', r.phone], ['Best way to reach', r.reach], ['Town', r.town]])
    .concat(forVisitor ? [] : [['Sent from', r.page + (r.need === 'card' ? ' (through the assistant)' : '')], ['Conversation', r.talk]]).filter(x => x[1]);
}
const plain = (head, rows, tail) => head + '\n\n' + rows.map(x => x[0] + ': ' + x[1]).join('\n') + (tail ? '\n\n' + tail : '');

// The request, to hello@.
function emailFor(r, link, esc) {
  const rows = rowsFor(r), who = r.business || r.name || r.email || r.phone;
  return { subject: 'Request: ' + r.needLabel + ', ' + who, text: plain('New request from the website', rows, link ? 'Open the request: ' + link : ''),
    html: brandEmail({ preheader: r.needLabel + ' for ' + who, label: 'New request', title: r.needLabel + '.', intro: 'From ' + who + (r.town ? ' in ' + r.town : '') + (r.need === 'card' ? ', through the assistant.' : ', through the quote form.'), rows, button: link ? { href: link, text: 'Open the request' } : null, note: r.email ? 'Reply to this email to answer them directly.' : 'They left a phone number and no email address.' }, esc) };
}
// The confirmation, to the visitor. It makes no promise beyond the one the site makes: a reply within one business day.
function confirmFor(r, esc) {
  const rows = rowsFor(r, true);
  return { subject: 'Got your request: ' + r.needLabel.replace(/^A |^An /, '').replace(/^./, c => c.toUpperCase()), text: plain('Got it. Thank you' + (r.name ? ', ' + r.name : '') + '. I read every request myself and reply within one business day. Here is a copy of what you sent.', rows, 'Rooted Coast Design, Bandon, Oregon\nhello@rootedcoastdesign.com  (541) 329-9273'),
    html: brandEmail({ preheader: 'I reply within one business day. Here is a copy of what you sent.', label: 'Request received', title: 'Got it.', accent: 'Thank you.', intro: 'I read every request myself and reply within one business day. Here is a copy of what you sent' + (r.name ? ', ' + r.name : '') + '.', rows, note: 'Need to add something? Reply to this email, or call (541) 329-9273.' }, esc) };
}

// The real dependencies, loaded only when the function runs on Vercel (paths are for api/quote.js).
function defaults() {
  const http = require('../pq/http'), store = require('../pq/store'), notify = require('../pq/notify');
  let ready = null;
  const db = () => { const { neon } = require('@neondatabase/serverless'); return neon(process.env.DATABASE_URL || process.env.POSTGRES_URL); };
  const hasDb = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  return {
    body: http.body, clientIp: http.clientIp, baseUrl: http.baseUrl, sign: http.sign, verify: http.verify, throttle: store.throttle, newId: store.newId, esc: notify.esc, sendEmail: notify.sendEmail,
    to: process.env.QUOTE_TO || 'hello@rootedcoastdesign.com',
    from: process.env.QUOTE_FROM || 'Rooted Coast Design <hello@rootedcoastdesign.com>', // hello@ has the Google account that carries the logo as its picture
    // Requests are kept in the site's file storage (Vercel Blob), the same way photo quotes are: one JSON file per
    // request at a path only its 24-character id reveals. If a database is ever added, a copy goes there too.
    async save(id, r) {
      const { put } = require('@vercel/blob');
      const rec = { id, created_at: new Date().toISOString(), status: 'new', need: r.need, needLabel: r.needLabel, side: r.side || '', card: r.card || null, conv: r.conv || '', talk: r.talk || '', name: r.name, business: r.business, email: r.email, phone: r.phone, reach: r.reach, town: r.town, details: r.details, answers: r.answers, page: r.page };
      // private first (2026-11-15: a request holds a name, email and phone); if the store refuses private files, the
      // request is still kept, as before, so a request is never lost
      const body = JSON.stringify(rec, null, 2), at = 'requests/' + id + '/request.json';
      // Requests go to a separate private store (PRIVATE_BLOB_READ_WRITE_TOKEN) when BLOB_ACCESS=private; the main store
      // stays public for the photo-quote widget. A refused private save falls back so a request is never lost.
      const PT = process.env.PRIVATE_BLOB_READ_WRITE_TOKEN;
      const pub = () => put(at, body, { access: 'public', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 0 });
      if (process.env.BLOB_ACCESS === 'private' && PT) { try { await put(at, body, { access: 'private', token: PT, contentType: 'application/json', addRandomSuffix: false }); } catch (e) { console.error('[quote] private save refused, saved as before', e && e.message); await pub(); } }
      else await pub();
      if (hasDb) { try { const sql = db();
        if (!ready) ready = sql`CREATE TABLE IF NOT EXISTS rc_requests (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), need TEXT NOT NULL, name TEXT, business TEXT, email TEXT, phone TEXT, reach TEXT, town TEXT, details TEXT, answers JSONB, page TEXT, status TEXT NOT NULL DEFAULT 'new')`;
        await ready;
        await sql`INSERT INTO rc_requests (id, need, name, business, email, phone, reach, town, details, answers, page) VALUES (${id}, ${r.need}, ${r.name}, ${r.business}, ${r.email}, ${r.phone}, ${r.reach}, ${r.town}, ${r.details}, ${JSON.stringify(r.answers)}, ${r.page})`;
      } catch (e) { console.error('[quote] database copy failed, file copy stands', e && e.message); } }
      return { ok: true };
    },
    async load(id) {
      if (!/^[0-9a-f]{24}$/.test(String(id || ''))) return null;
      const { list, get } = require('@vercel/blob');
      // private copy first, then an older public one
      const PT = process.env.PRIVATE_BLOB_READ_WRITE_TOKEN;
      if (PT) try { const g = await get('requests/' + id + '/request.json', { access: 'private', token: PT, useCache: false }); if (g && g.statusCode === 200 && g.stream) return JSON.parse(await new Response(g.stream).text()); } catch (e) { /* not private, or not found */ }
      const found = await list({ prefix: 'requests/' + id + '/request.json', limit: 1 }), hit = found && found.blobs && found.blobs[0];
      if (!hit) return null;
      const res = await fetch(hit.url, { cache: 'no-store' });
      return res.ok ? await res.json() : null;
    }
  };
}

function make(deps) {
  return async function handler(req, res) {
    const d = deps || (make._d = make._d || defaults());
    if (req.method === 'GET') return require('./request')(d)(req, res);
    if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method' });
    const b = d.body(req);
    // quiet drops: a filled trap field, or a form sent faster than a person can type
    if (clean(b._hp, 50)) return res.status(200).json({ ok: true, id: 'ok' });
    const elapsed = (Date.now() - Number(b.startedAt || 0)) / 1000;
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_SECONDS) return res.status(200).json({ ok: true, id: 'ok' });
    if (!d.throttle('quote:' + d.clientIp(req), 6)) return res.status(429).json({ ok: false, reason: 'slow-down' });
    const p = b.kind === 'card' ? parseCard(b) : parse(b);
    if (!p.ok) return res.status(400).json(p);
    const id = d.newId(), r = p.request;
    let saved = { ok: false }, sent = { ok: false };
    try { saved = await d.save(id, r); } catch (e) { saved = { ok: false, reason: 'save-failed' }; console.error('[quote] save failed', e && e.message); }
    const link = saved.ok ? d.baseUrl(req) + '/api/quote?id=' + id + '&sig=' + d.sign('quote:' + id) : '';
    try { const m = emailFor(r, link, d.esc); sent = await d.sendEmail({ to: d.to, from: d.from, replyTo: r.email || undefined, subject: m.subject, html: m.html, text: m.text }); } catch (e) { sent = { ok: false }; }
    // the visitor is told it went through only if it reached at least one place Johnathon will see it
    if (!saved.ok && !sent.ok) return res.status(502).json({ ok: false, reason: 'not-delivered' });
    // then, and only then, the visitor's own copy. Its failure changes nothing for them.
    if (r.email) { try { const c = confirmFor(r, d.esc); await d.sendEmail({ to: r.email, from: d.from, replyTo: d.to, subject: c.subject, html: c.html, text: c.text }); } catch (e) { /* their copy is a courtesy */ } }
    return res.status(200).json({ ok: true, id, saved: !!saved.ok, emailed: !!sent.ok });
  };
}

module.exports = make();
module.exports.make = make; module.exports.parse = parse; module.exports.parseCard = parseCard; module.exports.emailFor = emailFor; module.exports.confirmFor = confirmFor; module.exports.rowsFor = rowsFor; module.exports.NEEDS = NEEDS; module.exports.REACH = REACH; module.exports.rangeText = rangeText;
