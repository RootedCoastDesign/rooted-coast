// test/pq-theme.test.js
// Checks that a tenant's theme actually reaches the rendered widget, and that
// the England Brothers record in particular matches the site it is embedded in.
//
//   node test/pq-theme.test.js
//
// The regression this exists to catch: the widget's default palette is light
// with a prefers-color-scheme dark override. England Brothers' estimate panel
// is dark at all times. If a forced surface ever stops beating that media
// query, the widget turns into a white card in the middle of a near-black
// section on every phone set to light mode — and nobody would notice from a
// desktop in dark mode.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch { console.log('jsdom not installed — skipping theme test'); process.exit(0); }

const WIDGET = fs.readFileSync(path.join(__dirname, '..', 'pq-widget.js'), 'utf8');
const { publicConfig, getTenant } = require('../lib/pq/tenants');

// Relative luminance / contrast ratio, WCAG 2.1.
function lum(hex) {
  const h = hex.replace('#', '');
  const v = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function render(slug, { prefersDark = false } = {}) {
  const cfg = publicConfig(getTenant(slug));
  const dom = new JSDOM(
    `<!doctype html><html><body><div data-rcd-quote></div>
     <script id="w" src="https://www.rootedcoastdesign.com/pq-widget.js" data-site="${slug}"></script>
     </body></html>`,
    { url: 'https://example.com/', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const { window } = dom;
  window.matchMedia = (q) => ({
    matches: prefersDark && /dark/.test(q), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  window.fetch = async (u) => {
    if (String(u).includes('/api/pq/config')) return { ok: true, json: async () => ({ ok: true, config: cfg }) };
    throw new Error('unexpected fetch');
  };
  window.Element.prototype.scrollIntoView = function () {};
  vm.runInContext(WIDGET, dom.getInternalVMContext());
  return { window, cfg };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; }
}

(async () => {
  console.log('\nRooted Coast Quotes — theming\n');

  const EB = getTenant('england-brothers');

  await test('England Brothers is wired to a real inbox and a real phone', async () => {
    assert.ok(EB.notifyEmail.length && EB.notifyEmail[0].includes('@'),
      'notifyEmail is empty — leads would be saved and never seen');
    assert.match(EB.phone, /^\+1\d{10}$/, 'phone must be E.164 for tap-to-call');
    assert.strictEqual(EB.phone, '+15415510920');
    assert.strictEqual(EB.notifyEmail[0], 'leads@england-brothers.example');
  });

  await test('their allowlist covers apex and www', async () => {
    assert.ok(EB.allowedOrigins.includes('https://englandbrotherspainting.com'));
    assert.ok(EB.allowedOrigins.includes('https://www.englandbrotherspainting.com'));
  });

  await test('the theme is applied inline, so it survives light mode', async () => {
    const { window } = render('england-brothers', { prefersDark: false });
    await wait(30);
    const card = window.document.querySelector('[data-rcd-quote]').shadowRoot.querySelector('.rcq');
    assert.ok(card, 'no card');
    assert.strictEqual(card.style.getPropertyValue('--bg'), '#14100D',
      'forced dark surface did not reach the card');
    assert.strictEqual(card.style.getPropertyValue('--panel'), '#1E1813');
    assert.strictEqual(card.style.getPropertyValue('--radius'), '0px');
    assert.strictEqual(card.style.getPropertyValue('--head-transform'), 'uppercase');
    assert.ok(/Anton/.test(card.style.getPropertyValue('--font-head')));
    assert.ok(/Archivo/.test(card.style.getPropertyValue('--font')));
  });

  await test('display and body fonts both carry a real fallback stack', async () => {
    const b = EB.brand;
    assert.ok(/sans-serif$/.test(b.font.trim()), 'body font must end in a generic family');
    assert.ok(/sans-serif$/.test(b.headFont.trim()), 'head font must end in a generic family');
    assert.ok(b.headFont.split(',').length >= 3, 'one webfont and nothing else is not a stack');
  });

  await test('brand red is used as a fill, brass as ink — the contrast reason', async () => {
    const b = EB.brand;
    const bg = b.dark.bg;
    assert.ok(contrast(b.color, bg) < 4.5,
      'if the brand red now passes on their dark panel, the accent override is unnecessary');
    assert.ok(contrast(b.accent, bg) >= 4.5,
      `accent ${b.accent} on ${bg} is ${contrast(b.accent, bg).toFixed(2)}:1 — needs 4.5`);
    assert.ok(contrast(b.text, b.color) >= 4.5,
      'button text must be legible on the brand fill');
  });

  await test('body and heading text clear 4.5:1 on their panel', async () => {
    const d = EB.brand.dark;
    for (const [name, c] of [['head', d.head], ['body', d.body]]) {
      const r = contrast(c, d.bg);
      assert.ok(r >= 4.5, `${name} ${c} on ${d.bg} is ${r.toFixed(2)}:1`);
    }
    // Hints are secondary, so 3:1 is the bar rather than 4.5.
    assert.ok(contrast(d.dim, d.bg) >= 3, `dim ${d.dim} is ${contrast(d.dim, d.bg).toFixed(2)}:1`);
    // The error colour has to read as an error on a dark ground.
    assert.ok(contrast(d.bad, d.bg) >= 4.5, 'error text is unreadable on the dark panel');
  });

  await test('the questions keep everything their old form collected', async () => {
    const ids = EB.questions.map((q) => q.id);
    assert.ok(ids.includes('timing'), 'their old form asked how soon');
    assert.ok(ids.includes('also'), 'their old form let people tick several kinds of work');
    const also = EB.questions.find((q) => q.id === 'also');
    assert.strictEqual(also.type, 'multi', 'multi-select was a feature of the form we replaced');
    for (const chip of ['Exterior', 'Interior', 'Cabinets', 'Deck, fence or railing', 'Pressure washing']) {
      assert.ok(EB.jobTypes.includes(chip) || also.options.includes(chip),
        'lost their chip option: ' + chip);
    }
    const free = EB.questions.find((q) => q.type === 'text');
    assert.ok(free, 'their old form had a free-text box; people use it');
  });

  await test('England Brothers lets a homeowner skip photos; the default still requires them', async () => {
    const eb = render('england-brothers'); await wait(30);
    const es = eb.window.document.querySelector('[data-rcd-quote]').shadowRoot;
    const eSteps = es.querySelectorAll('.step');
    const r = eSteps[0].querySelector('input[type=radio]'); r.checked = true; r.dispatchEvent(new eb.window.Event('change'));
    eSteps[0].querySelector('button.go').click();
    assert.strictEqual(eSteps[1].querySelector('button.go').textContent, 'Skip photos', 'button should say so when nothing is attached');
    assert.ok(/Optional/.test(eSteps[1].querySelector('.hint').textContent));
    eSteps[1].querySelector('button.go').click();
    assert.ok(eSteps[2].classList.contains('on'), 'should have advanced without a photo');

    const ca = render('coastal-appliance'); await wait(30);
    const cs = ca.window.document.querySelector('[data-rcd-quote]').shadowRoot;
    const cSteps = cs.querySelectorAll('.step');
    const r2 = cSteps[0].querySelector('input[type=radio]'); r2.checked = true; r2.dispatchEvent(new ca.window.Event('change'));
    cSteps[0].querySelector('button.go').click();
    assert.strictEqual(cSteps[1].querySelector('button.go').textContent, 'Next');
    cSteps[1].querySelector('button.go').click();
    assert.ok(cSteps[1].classList.contains('on'), 'appliance repair should still insist on a photo');
    assert.ok(/at least one photo/i.test(cSteps[1].querySelector('.err').textContent));
  });

  await test('England Brothers copy never promises a price from photos', async () => {
    const cfg = publicConfig(getTenant('england-brothers'));
    const all = JSON.stringify(cfg).toLowerCase();
    for (const bad of ['price most jobs', 'without the drive out', 'that is what the photos are for', 'real number']) {
      assert.ok(!all.includes(bad), 'overpromise found: "' + bad + '"');
    }
    assert.ok(/walk/.test(cfg.intro), 'intro should say the job gets walked');
    assert.ok(/walk-through/.test(cfg.doneNote), 'thank-you should set up the walk-through');
  });

  // Coastal Appliance Repair is the mirror image of England Brothers: a light
  // site, so the forced surface has to beat the widget's prefers-color-scheme
  // dark override rather than its light default. Same failure mode, opposite
  // direction — a near-black card dropped into their white .form-card on any
  // phone set to dark mode.
  const CA = getTenant('coastal-appliance');

  await test('Coastal Appliance is pinned light, even for a viewer in dark mode', async () => {
    const { window } = render('coastal-appliance', { prefersDark: true });
    await wait(30);
    const card = window.document.querySelector('[data-rcd-quote]').shadowRoot.querySelector('.rcq');
    assert.ok(card, 'no card');
    assert.strictEqual(card.style.getPropertyValue('--bg'), '#F5F7F8',
      'forced light surface did not survive a dark-mode viewer');
    assert.strictEqual(card.style.getPropertyValue('--panel'), '#E7EDF0');
    assert.strictEqual(card.style.getPropertyValue('--radius'), '2px');
    assert.strictEqual(card.style.getPropertyValue('--head-transform'), 'uppercase');
    assert.ok(/Anton/.test(card.style.getPropertyValue('--font-head')));
    assert.ok(/Sora/.test(card.style.getPropertyValue('--font')));
  });

  await test('Coastal text and brand fill clear contrast on their light panel', async () => {
    const l = CA.brand.light;
    for (const [name, c] of [['head', l.head], ['body', l.body]]) {
      const r = contrast(c, l.bg);
      assert.ok(r >= 4.5, `${name} ${c} on ${l.bg} is ${r.toFixed(2)}:1`);
    }
    assert.ok(contrast(l.dim, l.bg) >= 3, `dim ${l.dim} is ${contrast(l.dim, l.bg).toFixed(2)}:1`);
    // Their accent is dark enough to be read as small text on the light ground,
    // which is why this record needs no separate `accent` override.
    assert.ok(contrast(CA.brand.color, l.bg) >= 4.5,
      `brand ${CA.brand.color} on ${l.bg} is ${contrast(CA.brand.color, l.bg).toFixed(2)}:1`);
    assert.ok(contrast(CA.brand.text, CA.brand.color) >= 4.5,
      'button text must be legible on the brand fill');
  });

  await test('Coastal fonts carry a real fallback stack', async () => {
    const b = CA.brand;
    assert.ok(/sans-serif$/.test(b.font.trim()), 'body font must end in a generic family');
    assert.ok(/sans-serif$/.test(b.headFont.trim()), 'head font must end in a generic family');
  });

  await test('Coastal requires photos — the model plate is the point', async () => {
    const cfg = publicConfig(CA);
    assert.strictEqual(cfg.photosRequired, true,
      'an appliance tech cannot bring the right part without the plate');
    assert.ok(/model plate/i.test(cfg.intro), 'the intro should ask for the plate by name');
  });

  await test('a tenant with no surface set still follows the viewer', async () => {
    // Was coastal-appliance until they got a real light theme on 2026-09-06.
    // demo is now the tenant that deliberately pins no surface.
    const { window } = render('demo');
    await wait(30);
    const card = window.document.querySelector('[data-rcd-quote]').shadowRoot.querySelector('.rcq');
    assert.strictEqual(card.style.getPropertyValue('--bg'), '',
      'a tenant that did not ask for a surface should not get one pinned');
    assert.strictEqual(card.style.getPropertyValue('--brand'), '#00617A');
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
