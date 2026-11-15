// api/pq/lead.js
// GET /lead/<slug>/<leadId>   (rewritten to /api/pq/lead?slug=&id=)
//
// The page the contractor opens from the notification. No login: the 24-hex
// lead id is the credential, the same way a Stripe receipt link works. That is
// a deliberate trade — a plumber on a roof will not type a password, and a
// forwarded link is a feature (they send it to their estimator).
//
// Consequences we accept and design around:
//   • noindex, nofollow, no referrer, and never linked from anywhere public.
//   • Nothing sensitive beyond what the homeowner typed into a public form.
//   • Ids are 96 bits of randomness; guessing is not a threat model.
//
// Rendered server-side as one HTML document with inline CSS. It has to open in
// two seconds on one bar of signal, which rules out a framework, a bundle, or
// a web font.

'use strict';

const { getTenant } = require('../../lib/pq/tenants');
const { getLead } = require('../../lib/pq/store');
const { esc, prettyPhone } = require('../../lib/pq/notify');
const { sign } = require('../../lib/pq/http');

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function localDate(iso) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}

function page(tenant, lead, statusKey) {
  const brand = (tenant.brand && tenant.brand.color) || '#00617A';
  const photos = lead.photos || [];

  const answerRows = [];
  if (lead.jobType) answerRows.push(['Job type', lead.jobType]);
  for (const q of tenant.questions || []) {
    const v = lead.answers && lead.answers[q.id];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    answerRows.push([q.label, Array.isArray(v) ? v.join(' · ') : String(v)]);
  }

  const mapHref = lead.address
    ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lead.address)
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="${esc(brand)}">
<title>${esc(lead.name || 'Quote request')} — ${esc(tenant.name)}</title>
<style>
:root{
  --brand:${esc(brand)};
  --bg:#f4f6f7; --card:#ffffff; --line:#e4eaec; --line-soft:#eef2f3;
  --head:#101416; --body:#3f5057; --dim:#7d8b93;
}
@media (prefers-color-scheme: dark){
  :root{ --bg:#0d1113; --card:#161c1f; --line:#263035; --line-soft:#1e262a;
         --head:#e6edf0; --body:#a8bac2; --dim:#7b8a92; }
}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--body);
  font:400 16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  padding:0 0 max(2rem,env(safe-area-inset-bottom));}
.wrap{max-width:660px;margin:0 auto;padding:0 14px}

header{background:var(--brand);color:#fff;padding:18px 0 20px;margin-bottom:14px}
header .wrap{display:block}
.kicker{font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:700;opacity:.8}
h1{font-size:clamp(1.4rem,5.5vw,1.85rem);line-height:1.2;font-weight:700;margin-top:6px;color:#fff}
.when{font-size:13px;opacity:.82;margin-top:6px}

.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px}
.card h2{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);
  font-weight:700;margin-bottom:12px}

.actions{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.actions .full{grid-column:1/-1}
a.btn{display:flex;align-items:center;justify-content:center;gap:8px;
  min-height:52px;border-radius:9px;text-decoration:none;font-weight:600;font-size:15px;
  background:var(--brand);color:#fff;border:1.5px solid var(--brand);padding:0 14px;text-align:center}
a.btn.ghost{background:transparent;color:var(--brand)}
@media (prefers-color-scheme: dark){ a.btn.ghost{color:var(--head);border-color:var(--line)} }
a.btn:active{transform:translateY(1px)}

.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:9px}
.photos a{display:block;position:relative;aspect-ratio:1;border-radius:9px;overflow:hidden;
  border:1px solid var(--line);background:var(--line-soft)}
.photos img{width:100%;height:100%;object-fit:cover;display:block}
.photos .n{position:absolute;left:7px;top:7px;background:rgba(0,0,0,.62);color:#fff;
  font-size:11px;font-weight:700;padding:3px 7px;border-radius:5px;letter-spacing:.06em}
.nophotos{color:var(--dim);font-size:14px}

dl{display:grid;grid-template-columns:minmax(110px,34%) 1fr;gap:0}
dt,dd{padding:10px 0;border-top:1px solid var(--line-soft);font-size:14.5px}
dt{color:var(--dim);padding-right:14px}
dd{color:var(--head);font-weight:500;overflow-wrap:anywhere}
dl>dt:first-of-type,dl>dt:first-of-type+dd{border-top:none}
@media(max-width:430px){
  dl{grid-template-columns:1fr}
  dt{padding-bottom:0;border-top:1px solid var(--line-soft)}
  dd{padding-top:2px;border-top:none}
  dl>dt:first-of-type+dd{border-top:none}
}

.status{display:flex;gap:8px;flex-wrap:wrap}
.status button{flex:1 1 auto;min-width:88px;min-height:44px;border-radius:8px;cursor:pointer;
  border:1.5px solid var(--line);background:transparent;color:var(--body);
  font:600 14px/1 inherit;font-family:inherit}
.status button[aria-pressed="true"]{background:var(--brand);border-color:var(--brand);color:#fff}
.status button:disabled{opacity:.5;cursor:default}
.saved{font-size:13px;color:var(--dim);margin-top:9px;min-height:18px}

footer{text-align:center;color:var(--dim);font-size:12px;padding:16px 0 0}
footer a{color:var(--dim)}
</style>
</head>
<body>

<header><div class="wrap">
  <div class="kicker">Quote request · ${esc(tenant.name)}</div>
  <h1>${esc(lead.name || 'Someone')}${lead.jobType ? ' — ' + esc(lead.jobType) : ''}</h1>
  <div class="when">${esc(localDate(lead.createdAt))} · ${esc(timeAgo(lead.createdAt))}</div>
</div></header>

<div class="wrap">

  <div class="card">
    <h2>Reach them</h2>
    <div class="actions">
      ${lead.phone ? `<a class="btn" href="tel:${esc(lead.phone)}">Call ${esc(prettyPhone(lead.phone))}</a>` : ''}
      ${lead.phone ? `<a class="btn ghost" href="sms:${esc(lead.phone)}">Text</a>` : ''}
      ${lead.email ? `<a class="btn ghost full" href="mailto:${esc(lead.email)}?subject=${encodeURIComponent('Your quote request — ' + tenant.name)}">Email ${esc(lead.email)}</a>` : ''}
      ${mapHref ? `<a class="btn ghost full" href="${esc(mapHref)}" target="_blank" rel="noopener">Directions to ${esc(lead.address)}</a>` : ''}
    </div>
  </div>

  <div class="card">
    <h2>${photos.length} photo${photos.length === 1 ? '' : 's'}</h2>
    ${photos.length ? `<div class="photos">${photos.map((p, i) => `
      <a href="${esc(p.url)}" target="_blank" rel="noopener">
        <span class="n">${i + 1}</span>
        <img src="${esc(p.url)}" alt="Photo ${i + 1} from ${esc(lead.name || 'the customer')}" loading="lazy" decoding="async">
      </a>`).join('')}</div>
      <p style="margin-top:10px;font-size:13px;color:var(--dim)">Tap any photo for full size.</p>`
      : `<p class="nophotos">No photos were attached.</p>`}
  </div>

  <div class="card">
    <h2>What they told us</h2>
    <dl>
      ${answerRows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
      ${lead.address ? `<dt>Address</dt><dd>${esc(lead.address)}</dd>` : ''}
    </dl>
  </div>

  <div class="card">
    <h2>Where it stands</h2>
    <div class="status" id="status">
      ${['new', 'quoted', 'won', 'lost'].map((s) => `
        <button type="button" data-s="${s}" aria-pressed="${lead.status === s}">${
          s === 'new' ? 'New' : s === 'quoted' ? 'Quoted' : s === 'won' ? 'Won' : 'Lost'
        }</button>`).join('')}
    </div>
    <div class="saved" id="saved"></div>
  </div>

  <footer>
    <p>Rooted Coast Quotes for ${esc(tenant.legalName || tenant.name)}</p>
    <p style="margin-top:4px"><a href="https://www.rootedcoastdesign.com">rootedcoastdesign.com</a></p>
  </footer>
</div>

<script>
(function(){
  var wrap = document.getElementById('status');
  var saved = document.getElementById('saved');
  var slug = ${JSON.stringify(tenant.slug)};
  var id   = ${JSON.stringify(lead.id)};
  var key  = ${JSON.stringify(statusKey)};

  wrap.addEventListener('click', function(e){
    var b = e.target.closest('button[data-s]');
    if (!b || b.disabled) return;
    var next = b.dataset.s;

    [].forEach.call(wrap.children, function(x){ x.setAttribute('aria-pressed', String(x === b)); x.disabled = true; });
    saved.textContent = 'Saving…';

    fetch('/api/pq/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: slug, id: id, status: next, key: key })
    })
    .then(function(r){ return r.json(); })
    .then(function(d){
      saved.textContent = d && d.ok ? 'Saved.' : 'Could not save — try again.';
    })
    .catch(function(){ saved.textContent = 'Could not save — try again.'; })
    .finally(function(){
      [].forEach.call(wrap.children, function(x){ x.disabled = false; });
      setTimeout(function(){ saved.textContent = ''; }, 2500);
    });
  });
})();
</script>
</body></html>`;
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const slug = String(q.slug || '').trim();
  const id = String(q.id || '').trim();
  const tenant = getTenant(slug);

  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'private, no-store');

  if (!tenant || !/^[0-9a-f]{24}$/.test(id)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send('<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font:16px/1.5 system-ui;padding:3rem;text-align:center;color:#3f5057"><p>That link is not valid.</p></body>');
  }

  let lead;
  try {
    lead = await getLead(slug, id);
  } catch (e) {
    console.error('[pq] lead read failed:', e.message);
  }

  if (!lead) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send('<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font:16px/1.5 system-ui;padding:3rem;text-align:center;color:#3f5057"><p>We could not find that quote request.</p></body>');
  }

  // The status buttons post back with this key so a leaked screenshot of the
  // page cannot be replayed against a different lead id.
  const statusKey = sign('status|' + slug + '|' + id);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(page(tenant, lead, statusKey));
};
