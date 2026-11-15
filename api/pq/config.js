// api/pq/config.js
// GET /api/pq/config?slug=england-brothers
//
// The widget's first call. Returns the tenant's public shape — name, brand
// colour, job types, the five questions, the photo prompts — so the form is
// driven entirely by lib/pq/tenants.js and the widget itself ships unchanged
// to every client.
//
// CORS IS WIDE OPEN HERE, ON PURPOSE. publicConfig() contains nothing that is
// not already visible on the client's own page, so there is no origin to
// protect. The upload and submit endpoints are the ones that check origins.
//
// Why it must be unconditional and not "allow if origin is on the list": this
// response is cached at the edge. The first request to fill the cache might be
// a direct visit with no Origin header at all — a person checking the URL in
// a browser. If the header were conditional, that cached copy would have no
// Access-Control-Allow-Origin, and every real cross-origin call for the next
// five minutes would fail with "Failed to fetch" while the URL looks fine when
// you open it by hand. That is exactly the bug this comment replaced.

'use strict';

const { getTenant, publicConfig } = require('../../lib/pq/tenants');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, reason: 'method' });

  const slug = String((req.query && req.query.slug) || '').trim();
  const tenant = getTenant(slug);

  if (!tenant) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ ok: false, reason: 'unknown-site' });
  }

  // Short edge cache: editing tenants.js means a redeploy anyway, which
  // invalidates this, so a short cache costs nothing and keeps the form instant.
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400');
  return res.status(200).json({ ok: true, config: publicConfig(tenant) });
};
