// api/pq/submit.js
// POST /api/pq/submit
//   { slug, jobType, answers:{}, photos:[{url,sig}], name, phone, email,
//     address, _hp, startedAt }
//   → { ok, leadId }
//
// Saves the lead, then notifies. The order matters: if Resend is down we still
// have the lead. If the save fails we
// tell the homeowner rather than pretending it went through — a silently
// dropped lead is worse than an error message.
//
// SPAM DEFENCE, in order of how much work each one does:
//   1. Origin allowlist (lib/pq/http.js) — kills drive-by posting outright.
//   2. Photo signatures — a lead with no verified photo is not a lead.
//   3. Honeypot field the widget keeps offscreen and empty.
//   4. Time-to-complete floor — real people take longer than four seconds.
//   5. Per-IP throttle.
// No CAPTCHA. Homeowners on a phone in a driveway will not solve one, and the
// four cheap checks above already stop everything we have seen.

'use strict';

const { getTenant } = require('../../lib/pq/tenants');
const { applyCors, preflight, body, clientIp, verify, baseUrl } = require('../../lib/pq/http');
const { newId, saveLead, throttle } = require('../../lib/pq/store');
const { notifyNewLead } = require('../../lib/pq/notify');

const MIN_SECONDS = 4;

// Strip control characters (not spaces — people have spaces in their names),
// trim, and cap the length so nothing downstream has to worry about size.
function clean(s, max) {
  // eslint-disable-next-line no-control-regex
  return String(s == null ? '' : s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, max);
}

function validPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 10 && d.length <= 15;
}

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(e || '').trim());
}

module.exports = async (req, res) => {
  // Preflight first: it carries no body, so the slug lookup below would
  // 404 it and the browser would never send the real request.
  if (req.method === 'OPTIONS') return preflight(req, res);

  const b = body(req);
  const slug = clean(b.slug, 60);
  const tenant = getTenant(slug);

  if (!tenant) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(404).json({ ok: false, reason: 'unknown-site' });
  }
  if (applyCors(req, res, tenant)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method' });

  // ── Spam gates ──
  if (clean(b._hp, 50)) return res.status(200).json({ ok: true, leadId: 'ok' }); // silent drop
  const elapsed = (Date.now() - Number(b.startedAt || 0)) / 1000;
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_SECONDS) {
    return res.status(200).json({ ok: true, leadId: 'ok' });
  }
  if (!throttle('sub:' + clientIp(req), 6)) {
    return res.status(429).json({ ok: false, reason: 'slow-down' });
  }

  // ── Contact ──
  const name = clean(b.name, 120);
  const phone = clean(b.phone, 30);
  const email = clean(b.email, 160);
  const address = clean(b.address, 200);

  if (!name) return res.status(400).json({ ok: false, reason: 'name-required' });
  if (!validPhone(phone) && !validEmail(email)) {
    return res.status(400).json({ ok: false, reason: 'contact-required' });
  }
  if (email && !validEmail(email)) return res.status(400).json({ ok: false, reason: 'bad-email' });

  // ── Job type must be one we offered ──
  const jobType = clean(b.jobType, 120);
  if (jobType && !(tenant.jobTypes || []).includes(jobType)) {
    return res.status(400).json({ ok: false, reason: 'bad-job-type' });
  }

  // ── Answers: only ids we asked about, only options we offered ──
  const answers = {};
  const incoming = (b.answers && typeof b.answers === 'object') ? b.answers : {};
  for (const q of tenant.questions || []) {
    const raw = incoming[q.id];
    if (raw == null) continue;

    if (q.type === 'multi') {
      const picked = (Array.isArray(raw) ? raw : [raw])
        .map((v) => clean(v, 120))
        .filter((v) => (q.options || []).includes(v))
        .slice(0, 20);
      if (picked.length) answers[q.id] = picked;
    } else if (q.type === 'single') {
      const v = clean(raw, 120);
      if ((q.options || []).includes(v)) answers[q.id] = v;
    } else {
      const v = clean(raw, 1200);
      if (v) answers[q.id] = v;
    }
  }

  for (const q of tenant.questions || []) {
    if (q.required && answers[q.id] == null) {
      return res.status(400).json({ ok: false, reason: 'missing:' + q.id });
    }
  }

  // ── Photos: every URL must carry a signature this deployment issued ──
  const photos = [];
  const rawPhotos = Array.isArray(b.photos) ? b.photos.slice(0, 12) : [];
  for (const p of rawPhotos) {
    const url = clean(p && p.url, 500);
    const sig = clean(p && p.sig, 64);
    if (!url || !sig) continue;
    if (!/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//i.test(url)) continue;
    if (!verify(slug + '|' + url, sig)) continue;
    photos.push({ url });
  }

  // ── Save ──
  const lead = {
    id: newId(),
    slug,
    createdAt: new Date().toISOString(),
    status: 'new',
    name, phone, email, address, jobType, answers, photos,
    meta: {
      ip: clientIp(req),
      userAgent: clean(req.headers['user-agent'], 300),
      referrer: clean(b.referrer || req.headers.referer, 300),
      secondsToComplete: Number.isFinite(elapsed) ? Math.round(elapsed) : null,
    },
  };

  try {
    await saveLead(lead);
  } catch (e) {
    console.error('[pq] SAVE FAILED — lead lost:', e.message, JSON.stringify({ slug, name, phone, email }));
    return res.status(500).json({ ok: false, reason: 'save-failed' });
  }

  const leadUrl = `${baseUrl(req)}/lead/${encodeURIComponent(slug)}/${lead.id}`;

  // Notifications are best-effort and never block the response. The homeowner
  // should not stare at a spinner because an email API is slow.
  try {
    await notifyNewLead(tenant, lead, leadUrl);
  } catch (e) {
    console.error('[pq] notify threw (lead is saved):', e.message);
  }

  return res.status(200).json({
    ok: true,
    leadId: lead.id,
    photoCount: photos.length,
  });
};
