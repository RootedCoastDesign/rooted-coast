#!/usr/bin/env node
/* ============================================================================
   check-prices.js — guards against price drift.

   Scans every production file for currency strings and fails if one appears
   that pricing.js does not account for. Run it after any pricing change:

       node check-prices.js

   Exit 0 = every published number traces back to pricing.js.
   Exit 1 = something drifted. The report says which file and which number.
   ========================================================================= */
const fs = require('fs');
const path = require('path');
const P = require('./pricing.js');

const ROOT = __dirname;

// Directories that are archives, notes or working material — never published.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '_notes', '_to_delete', '_demo-alder', '_social-posts',
  '_merch', '_merch-designs', '_client-coostucky', 'img', 'city-heroes',
  'stickersandcards', 'print-band', 'work-strip', 'coastal-appliance',
]);
// Per-client documents already delivered — frozen at the rate agreed.
const SKIP_FILES = new Set(['intake-andrew.html', 'intake-coastal.html', 'check-prices.js']);

/* ── Build the set of every number pricing.js authorises ─────────────────*/
const allowed = new Map();          // "1,199" -> what it is
const allow = (n, what) => {
  if (n == null) return;
  allowed.set(Number(n).toLocaleString('en-US'), what);
  allowed.set(String(n), what);     // unformatted, e.g. "1199" in JSON-LD
};

Object.values(P.PACKAGES).forEach(p => allow(p.price, p.label + ' package'));
/* Added with the rebuild (2026-11-12). */
if (P.TECH_FEES) { allow(P.TECH_FEES.drop, 'Tech diagnostic, drop-off'); allow(P.TECH_FEES.visit, 'Tech diagnostic, at your place'); }
if (P.SOFTWARE && P.SOFTWARE.small) { allow(P.SOFTWARE.small.min, 'Software, smaller projects from'); allow(P.SOFTWARE.small.max, 'Software, smaller projects to'); }
/* Not prices: the ends of the PC budget slider on the quote form, which is the customer's own budget. */
allow(500, 'PC build budget slider, low end (a budget, not a price)'); allow(4900, 'PC build budget slider, last step (a budget, not a price)');
allow(P.LAUNCH_BUNDLE.price,   'Full Launch price');
allow(P.LAUNCH_BUNDLE.value,   'Full Launch stated value');
allow(P.LAUNCH_BUNDLE.savings, 'Full Launch savings');
P.LAUNCH_BUNDLE.components.forEach(c => allow(c.amount, 'bundle component: ' + c.label));
Object.values(P.CARE).forEach(c => {
  allow(c.monthly, c.label + ' care, monthly');
  if (c.terms) Object.values(c.terms).forEach(t => allow(t.price, c.label + ' care, ' + t.months + ' month'));
});
Object.values(P.ADDONS).forEach(a => allow(a.price, 'add-on: ' + a.name));
allow(P.PRINT.logo.price, 'logo');
Object.values(P.PRINT.cards.ladder).forEach(v => allow(v, 'business cards'));
Object.values(P.PRINT.stickers.ladder).forEach(v => allow(v, 'stickers'));
allow(P.SOFTWARE.minimum, 'software minimum');
allow(P.SOFTWARE.scoping.price, 'discovery and scoping');
Object.values(P.PHOTO_TRAVEL).forEach(z => allow(z.fee, 'photo travel fee'));
// Sponsorship is a published range rather than a single price, so both ends of
// it are authorised. Added 2026-09-06 with South Coast Conditions.
Object.values(P.SPONSORSHIP || {}).forEach(s => {
  allow(s.monthlyMin, s.name + ', monthly floor');
  allow(s.monthlyMax, s.name + ', monthly ceiling');
});
// Invoices seats are bundled into every care plan and stated as a value.
Object.values(P.INVOICES || {}).forEach(i => allow(i.monthly, i.label + ', monthly (bundled value)'));
Object.values(P.LEGACY || {}).forEach(l => {
  allow(l.monthly || l.price,
    'GRANDFATHERED: ' + l.name + ', quoted ' + l.quotedOn + ', retire by ' + l.expires);
  if (l.terms) Object.values(l.terms).forEach(t => allow(t.price,
    'GRANDFATHERED: ' + l.name + ', ' + t.months + ' month term'));
});

// What a prepaid term works out to per month. A private quote page may say
// "works out to $44.25 a month"; computing it here rather than listing it
// means the figure cannot drift away from the term it describes.
[P.CARE, P.LEGACY || {}].forEach(set => {
  Object.values(set).forEach(plan => {
    if (!plan.terms) return;
    Object.values(plan.terms).forEach(t => {
      const per = Math.round((t.price / t.months) * 100) / 100;
      const what = (plan.label || plan.name) + ', ' + t.months + ' month term per month';
      allow(per, what);
      allowed.set(per.toFixed(2), what);
    });
  });
});

// Internal consistency: a print product's fallback price must equal its own
// ladder at the default quantity, or the cart can show a number the checkout
// will not charge.
[['cards', P.PRINT.cards], ['stickers', P.PRINT.stickers]].forEach(([name, item]) => {
  if (item.price !== item.ladder[item.defaultQty]) {
    console.error('FAIL — pricing.js: ' + name + '.price ($' + item.price + ') does not match ladder[' +
                  item.defaultQty + '] ($' + item.ladder[item.defaultQty] + ').');
    process.exit(1);
  }
});
// Every prepaid care term must derive from its own monthly rate:
//     price = monthly × (months − freeMonths)
// A term that says "3 months free" while charging for 10 of 12 is the exact
// drift found in the Stripe catalogue on 2026-09-07 (annual sold at 10 months
// paid). Deriving it here means the note and the number cannot disagree.
[['CARE', P.CARE], ['LEGACY', P.LEGACY || {}]].forEach(([group, set]) => {
  Object.values(set).forEach(plan => {
    if (!plan.terms || !plan.monthly) return;
    Object.values(plan.terms).forEach(t => {
      const expected = plan.monthly * (t.months - t.freeMonths);
      if (t.price !== expected) {
        console.error('FAIL — pricing.js: ' + group + ' ' + (plan.label || plan.name) + ' ' +
                      t.months + '-month term is $' + t.price + ', but ' + t.freeMonths +
                      ' month(s) free on $' + plan.monthly + '/mo derives $' + expected + '.');
        process.exit(1);
      }
    });
  });
});

// The bundle savings must derive from live component prices.
if (P.LAUNCH_BUNDLE.value - P.LAUNCH_BUNDLE.price !== P.LAUNCH_BUNDLE.savings) {
  console.error('FAIL — pricing.js: Full Launch savings do not derive from components.');
  process.exit(1);
}

// Software payment schedule must total 100%, and the figures it produces are
// authorised as computed values — the first instalment, and that instalment
// net of the discovery credit ("a $5,000 build starts at $1,401"). Computing
// them here rather than listing them means they cannot go stale: change the
// minimum, the split or the scoping fee and this follows automatically.
const pay = P.SOFTWARE.payment;
const pctTotal = pay.schedule.reduce((s, x) => s + x.pct, 0);
if (pctTotal !== 100) {
  console.error('FAIL — pricing.js: software payment schedule totals ' + pctTotal + '%, not 100%.');
  process.exit(1);
}
pay.schedule.forEach((step, i) => {
  const amt = P.SOFTWARE.minimum * step.pct / 100;
  allow(amt, 'software instalment ' + (i + 1) + ' (' + step.pct + '% of the ' + P.SOFTWARE.minimum + ' minimum)');
});
allow(P.SOFTWARE.minimum * pay.schedule[0].pct / 100 - P.SOFTWARE.scoping.price,
  'first software instalment after the discovery credit');

// Derived and incidental figures that are legitimately published but are not
// catalogue prices. Each one is here deliberately, with a reason.
[
  [12,   'domain registration, approximate annual cost quoted on caddie-card'],
  [50,   'photography travel rate, $50 per hour of drive time'],
  [5,    'travel fee rounding increment in api/travel-quote.js'],
  [0,    'zero'],
].forEach(([n, why]) => allow(n, why));

// Per-unit prices shown alongside a ladder price (e.g. "≈$0.60 / card", "$1.79 / sticker").
const UNIT_RE = /^\$\d\.\d{2}$/;

/* ── Walk the tree ───────────────────────────────────────────────────────*/
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('_')) walk(path.join(dir, entry.name));
    } else if (/\.(html|js|json|xml)$/.test(entry.name) && !SKIP_FILES.has(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }
})(ROOT);

const CURRENCY = /\$\s?([0-9](?:[0-9,]*[0-9])?(?:\.[0-9]{2})?)/g;
const problems = [];

for (const file of files) {
  const rel  = path.relative(ROOT, file);
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');

  lines.forEach((line, i) => {
    // Skip regex backreferences ($1, $2) and template placeholders.
    if (/\$\{/.test(line) && !/\$[0-9]/.test(line.replace(/\$\{[^}]*\}/g, ''))) return;

    let m;
    CURRENCY.lastIndex = 0;
    while ((m = CURRENCY.exec(line)) !== null) {
      const raw = m[1];
      const full = '$' + raw;
      if (UNIT_RE.test(full)) continue;                 // per-unit display price
      if (/^[12]$/.test(raw) && /\$[12]['")\]]/.test(line)) continue; // regex backref
      if (allowed.has(raw)) continue;
      // .50 deposits are half of an allowed package price
      if (raw.endsWith('.50')) {
        const whole = Number(raw.replace(/,/g, '')) * 2;
        if (allowed.has(whole.toLocaleString('en-US')) || allowed.has(String(whole))) continue;
      }
      problems.push({ file: rel, line: i + 1, value: full, text: line.trim().slice(0, 110) });
    }
  });
}

/* ── Report ──────────────────────────────────────────────────────────────*/
console.log('check-prices — scanned ' + files.length + ' production files\n');

if (problems.length === 0) {
  console.log('PASS. Every published price traces back to pricing.js.\n');
  const rows = [...new Set([...allowed.entries()].map(([n, w]) => '  $' + n + '  —  ' + w))]
    .filter(r => !/^\s+\$\d+\s+—/.test(r) || true);
  console.log('Authorised prices (' + new Set([...allowed.values()]).size + ' distinct items):');
  console.log([...new Map([...allowed.entries()].filter(([k]) => k.includes(',') || Number(k) >= 12))
    .entries()].map(([n, w]) => '  $' + n.padEnd(7) + w).join('\n'));
  process.exit(0);
}

console.log('FAIL — ' + problems.length + ' price(s) not accounted for in pricing.js:\n');
const byFile = {};
problems.forEach(p => { (byFile[p.file] = byFile[p.file] || []).push(p); });
Object.keys(byFile).sort().forEach(f => {
  console.log('  ' + f);
  byFile[f].forEach(p => console.log('    line ' + p.line + '  ' + p.value + '   ' + p.text));
  console.log();
});
process.exit(1);
