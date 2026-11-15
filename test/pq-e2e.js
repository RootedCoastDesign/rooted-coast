// test/pq-e2e.js
// End-to-end exercise of the photo-quote endpoints with Vercel Blob, Postgres
// and Resend all stubbed out. No network, no credentials, no cost.
//
//   node test/pq-e2e.js
//
// What it proves: a photo uploads and comes back signed, a submit with that
// signature is accepted and stored, a submit with a forged signature drops the
// photo, the lead page renders the answers, and the status endpoint refuses a
// bad key. If you change lib/pq/* or api/pq/*, run this before deploying.

'use strict';

const assert = require('assert');
const path = require('path');

// ── Stub @vercel/blob ────────────────────────────────────────────────────────
// Injected into require.cache before store.js is loaded, so store.js gets the
// fake without knowing it.
const FAKE_HOST = 'https://teststore.public.blob.vercel-storage.com/';
const blobs = new Map();

const blobStub = {
  async put(pathname, bodyValue, opts = {}) {
    const suffix = opts.addRandomSuffix ? '-' + Math.random().toString(16).slice(2, 10) : '';
    const key = pathname.replace(/(\.[a-z0-9]+)?$/i, (ext) => suffix + (ext || ''));
    const url = FAKE_HOST + key;
    blobs.set(key, {
      url,
      body: Buffer.isBuffer(bodyValue) ? bodyValue : Buffer.from(String(bodyValue)),
    });
    return { url, pathname: key };
  },
  async list({ prefix, limit }) {
    const out = [];
    for (const [key, v] of blobs) {
      if (key.startsWith(prefix)) out.push({ pathname: key, url: v.url });
      if (limit && out.length >= limit) break;
    }
    return { blobs: out };
  },
  async del() {},
};

require.cache[require.resolve('@vercel/blob')] = {
  id: require.resolve('@vercel/blob'),
  filename: require.resolve('@vercel/blob'),
  loaded: true,
  exports: blobStub,
};

// ── Environment ──────────────────────────────────────────────────────────────
process.env.PQ_SIGN_SECRET = 'test-signing-key';
process.env.PQ_BASE_URL = 'https://www.rootedcoastdesign.com';
delete process.env.DATABASE_URL;   // exercise the blob-only path
delete process.env.POSTGRES_URL;
delete process.env.RESEND_API_KEY; // notify.js logs and returns instead of sending

// Serve the fake blob URLs back to store.getLead's fetch().
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith(FAKE_HOST)) {
    const key = u.slice(FAKE_HOST.length);
    const hit = blobs.get(key);
    if (!hit) return { ok: false, status: 404, async json() { return null; }, async text() { return ''; } };
    return {
      ok: true, status: 200,
      async json() { return JSON.parse(hit.body.toString('utf8')); },
      async text() { return hit.body.toString('utf8'); },
    };
  }
  if (u.startsWith('https://api.resend.com')) {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, async json() { return { id: 'stub' }; }, async text() { return '{}'; } };
  }
  return realFetch(url, init);
};
const sent = [];
process.env.RESEND_API_KEY = 'stub-key'; // now safe: fetch is intercepted

const R = (p) => require(path.join(__dirname, '..', p));

// ── Mock req/res ─────────────────────────────────────────────────────────────
function call(handler, { method = 'POST', query = {}, body = null, headers = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headersSent: {}, _body: null,
      setHeader(k, v) { this.headersSent[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; },
      json(o) { this._body = o; resolve(this); return this; },
      send(s) { this._body = s; resolve(this); return this; },
      end() { resolve(this); return this; },
    };
    const req = {
      method, query, body,
      headers: Object.assign({ host: 'www.rootedcoastdesign.com', 'user-agent': 'test' }, headers),
      socket: { remoteAddress: '203.0.113.' + Math.floor(Math.random() * 250) },
    };
    Promise.resolve(handler(req, res)).catch((e) => { res._body = { threw: e.message }; resolve(res); });
  });
}

// A 2x2 red PNG, small but a real image.
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; }
}

(async () => {
  console.log('\nRooted Coast Quotes — end to end\n');

  const config = R('api/pq/config.js');
  const upload = R('api/pq/upload.js');
  const submit = R('api/pq/submit.js');
  const lead = R('api/pq/lead.js');
  const status = R('api/pq/status.js');

  const SLUG = 'coastal-appliance';
  let photo = null;
  let leadId = null;

  await test('config returns the tenant, and never the notify address', async () => {
    const r = await call(config, { method: 'GET', query: { slug: SLUG } });
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r._body.ok, true);
    assert.strictEqual(r._body.config.name, 'Coastal Appliance Repair');
    assert.ok(r._body.config.questions.length >= 5, 'expected at least five questions');
    assert.ok(r._body.config.photoPrompts.length === 3);
    assert.ok(!JSON.stringify(r._body).includes('leads@coastal-appliance.example'), 'leaked the notify email');
  });

  await test('config allows any origin, even one not on the tenant list', async () => {
    // The response is edge-cached, so the header cannot depend on who asked.
    const r = await call(config, { method: 'GET', query: { slug: SLUG }, headers: { origin: 'https://anything.example' } });
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.headersSent['access-control-allow-origin'], '*');
    const bare = await call(config, { method: 'GET', query: { slug: SLUG } });
    assert.strictEqual(bare.headersSent['access-control-allow-origin'], '*', 'a direct visit must also carry the header, or it poisons the cache');
  });

  await test('config 404s on an unknown site', async () => {
    const r = await call(config, { method: 'GET', query: { slug: 'not-a-client' } });
    assert.strictEqual(r.statusCode, 404);
  });

  await test('a cross-origin POST from an unlisted origin is refused', async () => {
    const r = await call(submit, { body: { slug: SLUG }, headers: { origin: 'https://evil.example' } });
    assert.strictEqual(r.statusCode, 403);
  });

  await test('a cross-origin preflight with no body is answered, not 404ed', async () => {
    // The browser sends OPTIONS with no body before any cross-origin POST. If
    // the handler tries to read the slug from the body first, the preflight
    // 404s and the real request is never sent — "Failed to fetch", no log.
    for (const handler of [upload, submit]) {
      const r = await call(handler, { method: 'OPTIONS', body: null,
        headers: { origin: 'https://www.englandbrotherspainting.com' } });
      assert.strictEqual(r.statusCode, 204, 'preflight must be 204, got ' + r.statusCode);
      assert.strictEqual(r.headersSent['access-control-allow-origin'], 'https://www.englandbrotherspainting.com');
      assert.ok(/POST/.test(r.headersSent['access-control-allow-methods']));
      assert.ok(/Content-Type/i.test(r.headersSent['access-control-allow-headers']));
    }
  });

  await test('a permissive preflight does not weaken the real check', async () => {
    // The demo tenant allows '*', so a preflight from anywhere gets a 204 —
    // the preflight cannot know which tenant the POST is for. What matters is
    // that the POST itself is still refused for a tenant that does not list
    // the origin. Remove the demo tenant and the preflight tightens too.
    const pre = await call(upload, { method: 'OPTIONS', body: null, headers: { origin: 'https://evil.example' } });
    assert.strictEqual(pre.statusCode, 204);
    const post = await call(upload, { body: { slug: SLUG, index: 0, dataUrl: PNG_1PX }, headers: { origin: 'https://evil.example' } });
    assert.strictEqual(post.statusCode, 403, 'the POST must still be refused');
  });

  await test('upload accepts a PNG and returns a signed URL', async () => {
    const r = await call(upload, { body: { slug: SLUG, index: 0, dataUrl: PNG_1PX } });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r._body));
    assert.strictEqual(r._body.ok, true);
    assert.ok(/public\.blob\.vercel-storage\.com/.test(r._body.url));
    assert.ok(r._body.sig && r._body.sig.length === 32);
    photo = { url: r._body.url, sig: r._body.sig };
  });

  await test('upload rejects a non-image payload', async () => {
    const r = await call(upload, { body: { slug: SLUG, index: 0, dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' } });
    assert.strictEqual(r.statusCode, 400);
  });

  await test('submit stores the lead and keeps the signed photo', async () => {
    const r = await call(submit, {
      headers: { origin: 'https://www.coastalappliancerepairllc.com' },
      body: {
        slug: SLUG,
        jobType: 'Refrigerator or freezer',
        answers: {
          symptom: 'Runs but does not heat / cool',
          age: '5 to 10 years',
          detail: 'Started making a clicking noise Tuesday.',
          timing: 'This week',
          access: 'Dog in the yard, friendly.',
        },
        photos: [photo],
        name: 'Jane Sandoval',
        phone: '5415550134',
        email: 'jane@example.com',
        address: '412 Elmira Ave, Coos Bay, OR',
        _hp: '',
        startedAt: Date.now() - 90000,
      },
    });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r._body));
    assert.strictEqual(r._body.ok, true);
    assert.strictEqual(r._body.photoCount, 1, 'the signed photo should have survived');
    assert.ok(/^[0-9a-f]{24}$/.test(r._body.leadId), 'lead id must be 24 hex chars');
    leadId = r._body.leadId;
  });

  await test('the name kept its space (control-character strip regression)', async () => {
    const { getLead } = R('lib/pq/store.js');
    const l = await getLead(SLUG, leadId);
    assert.strictEqual(l.name, 'Jane Sandoval');
  });

  await test('both emails went out, and the contractor reply-to is the homeowner', async () => {
    assert.strictEqual(sent.length, 2, 'expected a contractor email and a homeowner email');
    const toContractor = sent.find((m) => m.to.includes('leads@coastal-appliance.example'));
    assert.ok(toContractor, 'contractor was not notified');
    assert.strictEqual(toContractor.reply_to, 'jane@example.com');
    assert.ok(toContractor.html.includes(photo.url), 'photo missing from the email');
    assert.ok(toContractor.html.includes('/lead/' + SLUG + '/' + leadId), 'lead link missing');
    assert.ok(sent.find((m) => m.to.includes('jane@example.com')), 'homeowner got no confirmation');
  });

  await test('a forged photo signature is dropped, not trusted', async () => {
    const r = await call(submit, {
      body: {
        slug: SLUG, jobType: 'Washer',
        answers: { symptom: 'Leaking water', age: 'Under 5 years', timing: 'This week' },
        photos: [{ url: photo.url, sig: 'f'.repeat(32) }],
        name: 'Forger', phone: '5415550199',
        startedAt: Date.now() - 60000,
      },
    });
    assert.strictEqual(r._body.ok, true);
    assert.strictEqual(r._body.photoCount, 0, 'a forged signature was accepted');
  });

  await test('a photo URL on someone else\'s host is dropped', async () => {
    const evil = 'https://evil.example/payload.jpg';
    const { sign } = R('lib/pq/http.js');
    const r = await call(submit, {
      body: {
        slug: SLUG, jobType: 'Washer',
        answers: { symptom: 'Leaking water', age: 'Under 5 years', timing: 'This week' },
        photos: [{ url: evil, sig: sign(SLUG + '|' + evil) }],
        name: 'Redirector', phone: '5415550177',
        startedAt: Date.now() - 60000,
      },
    });
    assert.strictEqual(r._body.photoCount, 0, 'an off-host URL was accepted');
  });

  await test('a missing required answer is rejected with a useful reason', async () => {
    const r = await call(submit, {
      body: {
        slug: SLUG, jobType: 'Washer',
        answers: { symptom: 'Leaking water' },
        name: 'Half Filled', phone: '5415550188',
        startedAt: Date.now() - 60000,
      },
    });
    assert.strictEqual(r.statusCode, 400);
    assert.ok(String(r._body.reason).startsWith('missing:'), r._body.reason);
  });

  await test('an invented answer option is not stored', async () => {
    const r = await call(submit, {
      body: {
        slug: SLUG, jobType: 'Washer',
        answers: { symptom: '<script>alert(1)</script>', age: 'Under 5 years', timing: 'This week' },
        name: 'Injector', phone: '5415550166',
        startedAt: Date.now() - 60000,
      },
    });
    assert.strictEqual(r.statusCode, 400, 'symptom is required, so an invalid value must fail');
  });

  await test('the honeypot drops silently, without saving', async () => {
    const before = sent.length;
    const r = await call(submit, {
      body: {
        slug: SLUG, jobType: 'Washer',
        answers: { symptom: 'Leaking water', age: 'Under 5 years', timing: 'This week' },
        name: 'Bot', phone: '5415550111', _hp: 'http://spam.example',
        startedAt: Date.now() - 60000,
      },
    });
    assert.strictEqual(r._body.ok, true, 'a bot should think it worked');
    assert.strictEqual(sent.length, before, 'the honeypot let an email through');
  });

  await test('a form completed in under four seconds is dropped', async () => {
    const before = sent.length;
    await call(submit, {
      body: {
        slug: SLUG, jobType: 'Washer',
        answers: { symptom: 'Leaking water', age: 'Under 5 years', timing: 'This week' },
        name: 'Speedy', phone: '5415550122', startedAt: Date.now() - 500,
      },
    });
    assert.strictEqual(sent.length, before);
  });

  await test('the lead page renders the answers and the photo', async () => {
    const r = await call(lead, { method: 'GET', query: { slug: SLUG, id: leadId } });
    assert.strictEqual(r.statusCode, 200);
    const html = String(r._body);
    assert.ok(html.includes('Jane Sandoval'));
    assert.ok(html.includes('Runs but does not heat'));
    assert.ok(html.includes(photo.url));
    assert.ok(html.includes('tel:5415550134'));
    assert.ok(html.includes('noindex'), 'lead pages must not be indexable');
  });

  await test('the lead page escapes what the homeowner typed', async () => {
    const r = await call(submit, {
      body: {
        slug: SLUG, jobType: 'Washer',
        answers: { symptom: 'Leaking water', age: 'Under 5 years', timing: 'This week',
                   detail: '</script><img src=x onerror=alert(1)>' },
        name: '<b>Bold</b> Person', phone: '5415550155',
        startedAt: Date.now() - 60000,
      },
    });
    const page = await call(lead, { method: 'GET', query: { slug: SLUG, id: r._body.leadId } });
    const html = String(page._body);
    assert.ok(!html.includes('<img src=x'), 'unescaped HTML reached the page');
    assert.ok(html.includes('&lt;b&gt;Bold&lt;/b&gt;'), 'name was not escaped');
  });

  await test('an unknown lead id 404s', async () => {
    const r = await call(lead, { method: 'GET', query: { slug: SLUG, id: 'a'.repeat(24) } });
    assert.strictEqual(r.statusCode, 404);
  });

  await test('status refuses a bad key and accepts the real one', async () => {
    const bad = await call(status, { body: { slug: SLUG, id: leadId, status: 'quoted', key: 'nope' } });
    assert.strictEqual(bad.statusCode, 403);

    const { sign } = R('lib/pq/http.js');
    const good = await call(status, {
      body: { slug: SLUG, id: leadId, status: 'quoted', key: sign('status|' + SLUG + '|' + leadId) },
    });
    assert.strictEqual(good.statusCode, 200, JSON.stringify(good._body));

    const { getLead } = R('lib/pq/store.js');
    assert.strictEqual((await getLead(SLUG, leadId)).status, 'quoted');
  });

  await test('status rejects an invented status value', async () => {
    const { sign } = R('lib/pq/http.js');
    const r = await call(status, {
      body: { slug: SLUG, id: leadId, status: 'deleted', key: sign('status|' + SLUG + '|' + leadId) },
    });
    assert.strictEqual(r.statusCode, 400);
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
