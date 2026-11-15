// test/pq-widget.test.js
// Drives pq-widget.js inside jsdom with the API stubbed, and walks the whole
// form the way a homeowner would: pick a job, attach a photo, answer the
// questions, fill in contact details, send.
//
//   npm i -D jsdom && node test/pq-widget.test.js
//
// jsdom has no canvas, so the compression step is stubbed — that path is
// exercised for real in a browser. Everything else is the shipping code:
// shadow DOM mount, step gating, upload-in-background, validation, submit
// payload shape.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch { console.log('jsdom not installed — skipping widget test (npm i -D jsdom)'); process.exit(0); }

const WIDGET = fs.readFileSync(path.join(__dirname, '..', 'pq-widget.js'), 'utf8');
const { publicConfig, getTenant } = require('../lib/pq/tenants');
const CONFIG = publicConfig(getTenant('coastal-appliance'));

const calls = { upload: 0, submit: null };

const dom = new JSDOM(
  `<!doctype html><html><body>
     <h1>Some client site</h1>
     <div data-rcd-quote></div>
     <script id="w" src="https://www.rootedcoastdesign.com/pq-widget.js" data-site="coastal-appliance" data-on-sent="rcdSent"></script>
   </body></html>`,
  { url: 'https://www.coastalappliancerepairllc.com/', pretendToBeVisual: true, runScripts: 'outside-only' }
);

const { window } = dom;

window.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/api/pq/config')) {
    return { ok: true, json: async () => ({ ok: true, config: CONFIG }) };
  }
  if (u.includes('/api/pq/upload')) {
    calls.upload++;
    const n = calls.upload;
    return { ok: true, json: async () => ({
      ok: true,
      url: 'https://teststore.public.blob.vercel-storage.com/quotes/coastal-appliance/u-x/photo-' + n + '.jpg',
      sig: 'a'.repeat(32),
    }) };
  }
  if (u.includes('/api/pq/submit')) {
    calls.submit = JSON.parse(init.body);
    return { ok: true, json: async () => ({ ok: true, leadId: 'b'.repeat(24), photoCount: calls.submit.photos.length }) };
  }
  throw new Error('unexpected fetch: ' + u);
};

// jsdom has no 2D canvas. Return a fixed data URL so the widget's photo path
// runs end to end without a real encoder.
const STUB_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
window.HTMLCanvasElement.prototype.getContext = function () {
  return { drawImage() {} };
};
window.HTMLCanvasElement.prototype.toDataURL = function () { return STUB_JPEG; };
window.createImageBitmap = async () => ({ width: 3000, height: 2000, close() {} });
// Count scrolls. The widget must not move the page when it mounts — that
// hijacked every page load on Coastal Appliance's site — only when the
// homeowner changes step.
let scrolls = 0;
window.Element.prototype.scrollIntoView = function () { scrolls++; };

// The host page's analytics hook. Coastal Appliance's old form fired a GA4
// generate_lead event on submit; the widget replaced that form, so both routes
// out of the shadow root are exercised here.
//
// The handler throws on purpose. A client's marketing snippet must never be
// able to take the thank-you screen away from a homeowner who just sent a
// lead, so the confirmation test below passing IS that assertion.
const sent = { fn: [], evt: [] };
window.rcdSent = (d) => { sent.fn.push(d); throw new Error('host analytics blew up'); };
window.addEventListener('rcd-quote-sent', (e) => sent.evt.push(e.detail));

// document.currentScript is null outside real script execution; the widget's
// fallback picks the last <script>, which is the one we planted.
vm.runInContext(WIDGET, dom.getInternalVMContext());

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function shadow() {
  const host = window.document.querySelector('[data-rcd-quote]');
  assert.ok(host.shadowRoot, 'widget did not mount a shadow root');
  return host.shadowRoot;
}
const $ = (sel) => shadow().querySelector(sel);
const $$ = (sel) => [].slice.call(shadow().querySelectorAll(sel));
const stepOn = () => $$('.step').findIndex((s) => s.classList.contains('on'));
const nextBtn = () => $$('.step')[stepOn()].querySelector('button.go');
const errText = () => ($$('.step')[stepOn()].querySelector('.err') || {}).textContent || '';

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n      ')); fail++; }
}

(async () => {
  console.log('\nRooted Coast Quotes — widget in jsdom\n');
  await wait(30);

  await test('the source carries no raw closing script tag', async () => {
    // An HTML parser ends a script block at the first literal closing tag it
    // sees — inside a comment or a string counts. One in this file truncates
    // the widget the moment anyone inlines it into a page rather than loading
    // it by src, and the half that survives fails silently. Keep them escaped.
    const raw = WIDGET.match(/<\/script>/gi) || [];
    assert.strictEqual(raw.length, 0,
      'found ' + raw.length + ' raw closing script tag(s) — write them as <\\/script>');
  });

  await test('mounting does not scroll the page', async () => {
    assert.ok(shadow().querySelector('.rcq'), 'no card rendered');
    assert.strictEqual(scrolls, 0, 'the widget scrolled the page on load');
  });

  await test('mounts into the host page without touching its DOM', async () => {
    assert.ok(shadow().querySelector('.rcq'), 'no card rendered');
    assert.strictEqual(window.document.querySelector('h1').textContent, 'Some client site',
      'the widget modified the host page');
    assert.ok(!window.document.body.innerHTML.includes('Refrigerator'),
      'widget markup leaked into the light DOM');
  });

  await test('shows the tenant name, intro and every job type', async () => {
    assert.strictEqual($('.kick').textContent, 'Coastal Appliance Repair');
    assert.ok($('.sub').textContent.includes('model plate'));
    assert.strictEqual($$('.opts.grid .opt').length, CONFIG.jobTypes.length);
  });

  await test('will not advance without a job type, then does', async () => {
    nextBtn().click();
    assert.ok(errText().length > 0, 'expected a validation message');
    assert.strictEqual(stepOn(), 0);

    const radios = $$('.step')[0].querySelectorAll('input[type=radio]');
    radios[0].checked = true;
    radios[0].dispatchEvent(new window.Event('change'));
    nextBtn().click();
    assert.strictEqual(stepOn(), 1, 'did not reach the photo step');
    assert.strictEqual(scrolls, 1, 'a step change should scroll the card into view');
  });

  await test('the photo step lists all three shot prompts', async () => {
    const items = $$('.prompts li');
    assert.strictEqual(items.length, 3);
    assert.ok(items[1].textContent.includes('model and serial'), 'the model-plate prompt is missing');
  });

  await test('demands at least one photo', async () => {
    nextBtn().click();
    assert.ok(/at least one photo/i.test(errText()), errText());
    assert.strictEqual(stepOn(), 1);
  });

  await test('a chosen photo uploads immediately, in the background', async () => {
    const picker = $$('.step')[1].parentNode.querySelector('input[type=file]');
    const file = new window.File([new Uint8Array([1, 2, 3])], 'fridge.jpg', { type: 'image/jpeg' });
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    picker.dispatchEvent(new window.Event('change'));
    await wait(60);

    assert.strictEqual(calls.upload, 1, 'upload did not fire on selection');
    assert.strictEqual($$('.shot').length, 1, 'no thumbnail rendered');
    assert.ok(/1 photo ready/.test($('.upnote').textContent), $('.upnote').textContent);
  });

  await test('a photo can be removed again', async () => {
    const file = new window.File([new Uint8Array([4, 5, 6])], 'plate.jpg', { type: 'image/jpeg' });
    const picker = $$('.step')[1].parentNode.querySelector('input[type=file]');
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    picker.dispatchEvent(new window.Event('change'));
    await wait(60);
    assert.strictEqual($$('.shot').length, 2);

    $$('.shot')[1].querySelector('.x').click();
    assert.strictEqual($$('.shot').length, 1, 'remove did not drop the tile');
    nextBtn().click();
    assert.strictEqual(stepOn(), 2, 'did not reach the questions');
  });

  await test('required questions are enforced by label, not by id', async () => {
    nextBtn().click();
    assert.ok(/Still need/.test(errText()), errText());
    assert.ok(errText().includes('What is it doing'), errText());
    assert.strictEqual(stepOn(), 2);
  });

  await test('answering the required questions opens the contact step', async () => {
    const fieldsets = $$('.step')[2].querySelectorAll('fieldset');
    CONFIG.questions.forEach((q, i) => {
      if (!q.required) return;
      const fs = fieldsets[i];
      const input = fs.querySelector('input[type=radio],input[type=checkbox]');
      if (input) { input.checked = true; input.dispatchEvent(new window.Event('change')); }
      else {
        const ta = fs.querySelector('textarea');
        ta.value = 'It clicks and never gets cold.';
        ta.dispatchEvent(new window.Event('input'));
      }
    });
    nextBtn().click();
    assert.strictEqual(stepOn(), 3, errText());
  });

  await test('a name alone is not enough — we need a way to reach them', async () => {
    const inputs = $$('.step')[3].querySelectorAll('input');
    inputs[0].value = 'Jane Sandoval';
    nextBtn().click();
    await wait(20);
    assert.ok(/phone number or an email/i.test(errText()), errText());
    assert.strictEqual(calls.submit, null, 'submitted without contact details');
  });

  await test('a mistyped email is named as the problem, not treated as blank', async () => {
    const inputs = $$('.step')[3].querySelectorAll('input');
    inputs[2].value = 'jane@nope';
    nextBtn().click();
    await wait(20);
    assert.ok(/looks off/i.test(errText()), errText());
    assert.strictEqual(calls.submit, null);
    inputs[2].value = '';
  });

  await test('a phone missing its area code says so', async () => {
    const inputs = $$('.step')[3].querySelectorAll('input');
    inputs[1].value = '555-0134';
    nextBtn().click();
    await wait(20);
    assert.ok(/area code/i.test(errText()), errText());
    assert.strictEqual(calls.submit, null);
  });

  await test('a complete form submits the right payload', async () => {
    const inputs = $$('.step')[3].querySelectorAll('input');
    inputs[1].value = '(541) 555-0134';
    inputs[2].value = 'jane@example.com';
    inputs[3].value = '412 Elmira Ave, Coos Bay';
    nextBtn().click();
    await wait(80);

    const s = calls.submit;
    assert.ok(s, 'nothing was submitted');
    assert.strictEqual(s.slug, 'coastal-appliance');
    assert.strictEqual(s.name, 'Jane Sandoval');
    assert.strictEqual(s.jobType, CONFIG.jobTypes[0]);
    assert.strictEqual(s.photos.length, 1, 'the removed photo should not be sent');
    assert.ok(s.photos[0].url && s.photos[0].sig, 'photo url/signature missing');
    assert.strictEqual(s._hp, '', 'honeypot should be empty');
    assert.ok(s.startedAt > 0 && s.startedAt <= Date.now());
    CONFIG.questions.filter((q) => q.required).forEach((q) => {
      assert.ok(s.answers[q.id] != null, 'missing answer for ' + q.id);
    });
  });

  await test('the confirmation screen names the business and the photo count', async () => {
    assert.strictEqual(stepOn(), 4, 'did not reach the thank-you step');
    const done = $('.done').textContent;
    assert.ok(done.includes('Coastal Appliance Repair'), done);
    assert.ok(/1 photo\b/.test(done), done);
    assert.ok($('h2').textContent.includes('Thanks'), $('h2').textContent);
  });

  await test('a sent lead reaches the host page, for analytics', async () => {
    assert.strictEqual(sent.fn.length, 1, 'data-on-sent function was not called exactly once');
    assert.strictEqual(sent.evt.length, 1, 'rcd-quote-sent did not fire exactly once');
    for (const d of [sent.fn[0], sent.evt[0]]) {
      assert.strictEqual(d.slug, 'coastal-appliance');
      assert.strictEqual(d.leadId, 'b'.repeat(24));
      assert.strictEqual(d.photoCount, 1);
    }
  });

  await test('no Rooted Coast credit in front of the client\'s customer', async () => {
    // Removed 2026-09-06. The credit lives in the email footer instead.
    assert.strictEqual($('.by'), null, 'the "Photo quoting by" line is back');
    assert.ok(!/Rooted Coast/.test(shadow().textContent), 'Rooted Coast named inside the widget');
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
