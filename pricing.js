/* ============================================================================
   pricing.js — Rooted Coast Design, single source of truth for every price.

   THIS IS THE ONLY PLACE PRICES ARE DEFINED. Change a number here and it flows
   to the cart, both product builders, the checkout function, and the on-site
   assistant. Static marketing copy is verified against this file by
   `node check-prices.js`.

   Amounts are whole US dollars. The checkout function converts to cents.

   Works in two environments:
     Node   →  const P = require('./pricing.js')
     Browser→  <script src="/pricing.js"></script> then window.RCD_PRICING

   Last repriced: 2026-09-03
   ========================================================================= */
(function (root, factory) {
  var P = factory();
  if (typeof module === 'object' && module.exports) module.exports = P;
  if (typeof window !== 'undefined') window.RCD_PRICING = P;
})(this, function () {
  'use strict';

  /* ── Website packages ───────────────────────────────────────────────────
     `deposit: true` means 50% is charged at checkout and 50% is invoiced at
     launch. Internal keys (seedling/sapling/timber) are deliberately kept so
     existing cart links, saved sessions and order records stay valid.        */
  var PACKAGES = {
    seedling: {
      key: 'seedling',
      label: 'Starter',
      name: 'Starter website · one page',
      price: 649,
      deposit: false,
      turnaround: '3 to 5 business days',
      pages: 'One page',
      revisions: 1,
      blurb: 'One page, scoped tight and built properly. Everything a customer needs to decide, in a single scroll.',
      billingNote: 'One page website, paid in full',
    },
    sapling: {
      key: 'sapling',
      label: 'Standard',
      name: 'Standard website · 3 to 5 pages',
      price: 1199,
      deposit: true,
      turnaround: '5 business days',
      pages: '3 to 5 pages',
      revisions: 1,
      popular: true,
      blurb: 'The right fit for most established local businesses. Room to explain what you do and rank for more than one search.',
    },
    timber: {
      key: 'timber',
      label: 'Custom',
      name: 'Custom website · larger builds',
      price: 2499,
      from: true,
      deposit: true,
      turnaround: '5 business days to 3 weeks depending on scope',
      pages: '5 to 10+ pages',
      revisions: 2,
      blurb: 'Larger websites and advanced functionality: ecommerce, booking systems, portals, integrations and involved builds.',
    },
    reskin: {
      key: 'reskin',
      label: 'Reskin',
      name: 'The Reskin · site refresh',
      price: 549,
      deposit: false,
      // Same as a Standard build. A reskin touches every page, and pretending
      // it is a two day job only ever set the wrong expectation.
      turnaround: '5 business days',
      revisions: 1,
      blurb: 'New colors, fonts, imagery and copy on the structure you already have.',
    },
    'seo-audit': {
      key: 'seo-audit',
      label: 'SEO Audit',
      name: 'SEO Audit',
      price: 249,   // was 399; changed 2026-11-11
      deposit: false,
      turnaround: 'back within 5 business days',
      blurb: 'Where your site actually stands, and a one page plan of what to fix in what order.',
      billingNote: 'Full audit plus a one page plan, back within 5 business days',
    },
  };

  /* ── The Full Launch bundle ─────────────────────────────────────────────
     `value` and `savings` are COMPUTED from live component prices, never
     hard-coded. If any component price changes, the displayed savings follows
     automatically and can never drift out of true.                           */
  var BUNDLE_COMPONENTS = [
    { label: 'Standard website, 3 to 5 pages', amount: PACKAGES.sapling.price },
    { label: 'Custom logo, all file formats',  amount: 299 },
    { label: '250 business cards, shipped',    amount: 149 },
    { label: '250 die-cut stickers, shipped',  amount: 249 },
  ];

  var LAUNCH_BUNDLE = {
    key: 'launch-bundle',
    label: 'Full Launch',
    name: 'Full Launch bundle · Standard site plus brand kit',
    // 2026-10-29: logo dropped to $299 at the owner's call, so the bundle
    // bundle dropped by two hundred to keep the same saving on the parts.
    price: 1699,
    deposit: true,
    components: BUNDLE_COMPONENTS,
    get value()   { return BUNDLE_COMPONENTS.reduce(function (s, c) { return s + c.amount; }, 0); },
    get savings() { return this.value - this.price; },
    billingNote: 'Standard website, logo, 250 cards and 250 stickers',
  };

  /* ── Rooted Coast Invoices ──────────────────────────────────────────────
     The studio's own app (invoices.rootedcoastdesign.com). Its plans are
     priced over there; the numbers are repeated here only because every care
     plan bundles a seat and states it as a value. Change them here and there
     together. Added 2026-09-08.                                              */
  var INVOICES = {
    pro:     { key: 'invoices-pro',      label: 'Invoices Pro',  monthly: 12 },
    proPlus: { key: 'invoices-pro-plus', label: 'Invoices Pro+', monthly: 24 },
  };

  /* ── Care plans ─────────────────────────────────────────────────────────
     Every plan includes a Rooted Coast Invoices seat: Essentials carries Pro,
     Growth and Custom carry Pro+. The seat lives as long as the plan does;
     when a plan ends the account drops to the free tier and nothing is
     deleted. Prepaid terms DO NOT auto-renew. Coverage ends at the end of the term
     unless renewed. Do not describe these as recurring anywhere.
     6 months = 5 months paid (1 free). Annual = 9 months paid (3 free).      */
  var CARE = {
    essentials: {
      key: 'care-sapling',
      label: 'Essentials',
      monthly: 69,
      terms: {
        six:    { months: 6,  price: 345,  freeMonths: 1, note: '6 months, 1 month free' },
        annual: { months: 12, price: 621,  freeMonths: 3, note: '12 months, 3 months free' },
      },
      includes: [
        'Fast hosting, daily backups',
        'Security and uptime monitoring',
        '30 minutes of content updates each month',
        '48 hour support response',
        'Rooted Coast Invoices Pro included ($12 a month value)',
      ],
    },
    growth: {
      key: 'care-timber',
      label: 'Growth',
      monthly: 119,
      popular: true,
      terms: {
        six:    { months: 6,  price: 595,  freeMonths: 1, note: '6 months, 1 month free' },
        annual: { months: 12, price: 1071, freeMonths: 3, note: '12 months, 3 months free' },
      },
      includes: [
        'Everything in Essentials',
        '60 minutes of content updates each month',
        '24 hour support response',
        'Monthly performance and analytics report',
        'Rooted Coast Invoices Pro+ included ($24 a month value)',
      ],
    },
    custom: {
      key: 'care-custom',
      label: 'Custom',
      monthly: 199,
      from: true,
      quoted: true,
      terms: {
        six:    { months: 6,  price: 995,  freeMonths: 1, note: '6 months, 1 month free' },
        annual: { months: 12, price: 1791, freeMonths: 3, note: '12 months, 3 months free' },
      },
      includes: [
        'Everything in Growth',
        '2 or more hours of updates each month',
        'Priority support line',
        'Checkout monitoring for online stores',
      ],
    },
  };

  /* ── Grandfathered prices ───────────────────────────────────────────────
     Honoured rates for people who were quoted before a price change. Terms of
     service §2: "Existing project agreements are honored at the rates agreed
     upon at time of purchase."

     These are NOT listed on any public page and must never be. They exist so a
     private link that was already sent still charges the price it promised.
     Reach one at:  /cart.html?add=<key>

     Retire an entry once the person has either signed up or clearly moved on.  */
  var LEGACY = {
    // Quoted 2026-08-20 at the pre-increase Essentials rate. One recipient.
    // Remove after they sign up, or by 2026-11-01, whichever comes first.
    'care-essentials-59': {
      key: 'care-essentials-59',
      name: 'Essentials care plan',
      monthly: 59,
      recurring: true,
      legacy: true,
      quotedOn: '2026-08-20',
      expires: '2026-11-01',
      billingNote: 'Billed monthly at your quoted rate. Cancel any time with 30 days notice.',
      // Prepaid terms at the grandfathered rate, on the same ladder as the
      // current plans: 6 months = 5 paid, annual = 9 paid. Added 2026-09-07
      // because the client asked for the term options at their quoted price.
      terms: {
        six:    { months: 6,  price: 295, freeMonths: 1, note: '6 months, 1 month free' },
        annual: { months: 12, price: 531, freeMonths: 3, note: '12 months, 3 months free' },
      },
    },
  };

  /* ── Add-ons ────────────────────────────────────────────────────────────
     `req: 'site'` means the add-on attaches to a website package.
     `req: 'any'`  means it can be bought alongside anything in the cart.     */
  var ADDONS = {
    photoshoot: {
      key: 'photoshoot', name: 'On-site photography', price: 449, from: true, req: 'site',
      blurb: 'Up to 3 hours at your business, edited and placed',
      billingNote: 'Travel free within 45 miles of Bandon, drive time fee beyond',
    },
    copywriting: {
      key: 'copywriting', name: 'Professional copywriting', price: 399, from: true, req: 'site',
      blurb: 'Written from scratch to sound like you',
    },
    'online-store': {
      key: 'online-store', name: 'Online store add-on', price: 999, req: 'site',
      blurb: 'A cart and secure checkout on your site, first 15 products included',
      billingNote: 'Cart and secure checkout, up to 15 products, requires a Standard or Custom website build',
    },
    'extra-pages': {
      key: 'extra-pages', name: 'Additional page', price: 149, unit: 'per page', max: 10, req: 'site',
      blurb: 'Built to match the rest of your site',
    },
    gbp: {
      key: 'gbp', name: 'Google Business Profile setup', price: 199, req: 'site',
      blurb: 'Show up in local map results',
    },
    booking: {
      key: 'booking', name: 'Booking integration', price: 249, req: 'site',
      blurb: 'Customers book themselves, day or night',
    },
    email: {
      key: 'email', name: 'Branded email setup', price: 179, req: 'site',
      blurb: 'Your own name on your own domain, on all your devices',
    },
    reviews: {
      key: 'reviews', name: 'Review generation page', price: 149, req: 'site',
      blurb: 'One-tap reviews plus a printable QR code',
    },
    photos: {
      key: 'photos', name: 'Licensed stock-photo sourcing', price: 149, req: 'site',
      blurb: 'Licensed, hand-picked for your trade',
    },
  };

  /* ── Branding and print ─────────────────────────────────────────────────
     Business cards are ONE product as of 2026-09-03. The previous split
     between "from your logo" and "custom design" is retired; the `cards-logo`
     key survives as the internal identifier so old links keep working.

     Stickers currently publish 3x3" at 100 and 250 only. Other sizes and
     larger runs route to a quote until the full cost-checked ladder is set.  */
  var PRINT = {
    logo: {
      key: 'logo', name: 'Custom logo design', price: 299,
      blurb: 'Concept development, typography, color, real-world application testing, revisions and a complete commercial file package',
    },
    cards: {
      key: 'cards-logo',
      name: 'Business cards',
      // `price` is the fallback shown if the cart is reached without a saved
      // builder spec. It must equal ladder[defaultQty].
      price: 149,
      ladder: { 250: 149, 500: 179, 1000: 229, 2500: 299 },
      defaultQty: 250,
      blurb: 'Designed, printed and shipped. Proofed before anything prints.',
      billingNote: 'Printed and shipped to your door',
    },
    stickers: {
      key: 'stickers',
      name: 'Custom stickers',
      // Fallback if the cart is reached without a saved builder spec.
      // Must equal ladder[defaultQty].
      price: 179,
      size: '3x3"',
      ladder: { 100: 179, 250: 249 },
      quotedQty: [500, 1000],
      quotedSizes: ['2x2"', '4x4"'],
      defaultQty: 100,
      blurb: 'Weather resistant die-cut vinyl, designed, printed and shipped.',
      billingNote: 'Die-cut vinyl, printed and shipped',
    },
  };

  /* ── Custom software ────────────────────────────────────────────────────
     Always "from $5,000" — never a flat figure. Final pricing is by scope.   */
  /* Rooted Coast Tech: the diagnostic fee, credited toward the repair if the customer goes ahead (2026-11-11).
     Everything else Tech does is quoted per job, so there are no other Tech prices here. */
  var TECH_FEES = { drop: 75, visit: 100 };
  /* The SEO audit fee comes off a new website ordered within this many days of the audit (2026-11-11). */
  var AUDIT_CREDIT_DAYS = 30;

  var SOFTWARE = {
    /* Smaller projects typically fall in this range and are quoted; larger builds are quoted individually and
       start with the discovery session below (2026-11-12). `minimum` is kept for the older pages that read it. */
    small: { min: 1000, max: 5000 },
    minimum: 5000,
    /* Payment schedule for custom software builds only. Websites stay 50/50.
       Every trigger is something Rooted Coast controls and can evidence —
       "on delivery for review", not "on client approval" — so a client who
       goes quiet cannot freeze 60% of an invoiced project. The final payment
       falls due BEFORE handover: no repo, credentials or finished product
       changes hands ahead of it. */
    payment: {
      schedule: [
        { pct: 40, when: 'to begin' },
        { pct: 30, when: 'on delivery of the working build for review' },
        { pct: 30, when: 'before launch and handover' },
      ],
      stallDays: 30,          // review not returned within this → balance due
      creditAppliesTo: 'the first payment',
      get summary() {
        return this.schedule.map(function (s) { return s.pct + '% ' + s.when; }).join(', ');
      },
      get short() {
        return this.schedule.map(function (s) { return s.pct + '%'; }).join(' / ');
      },
    },
    scoping: {
      key: 'scoping',
      name: 'Discovery and scoping',
      price: 599,
      creditWindowDays: 60,
      blurb: 'Your idea turned into a real written spec: what it does, what it deliberately does not do in version one, how it works, and what it costs to build.',
      billingNote: 'Written spec, credited toward a commissioned build if you proceed within 60 days',
    },
  };

  /* ── On-site photography travel ─────────────────────────────────────────
     Free within ~45 miles of Bandon. Beyond that, $50 per hour of one-way
     drive time. Zones are whitelisted server-side; client values are ignored. */
  var PHOTO_TRAVEL = {
    local: { fee: 0,   label: 'within 45 miles of Bandon' },
    zone2: { fee: 50,  label: 'Reedsport / Gold Beach, ~1 hr' },
    zone3: { fee: 75,  label: 'Florence / Brookings, ~1.5 hr' },
    zone4: { fee: 150, label: 'Eugene area, ~3 hr' },
    zone5: { fee: 140, label: 'Waldport to Lincoln City, ~2.5-3 hr' },
    zone6: { fee: 240, label: 'Tillamook to Astoria / Long Beach WA, ~4-5 hr' },
  };

  /* ── Helpers ────────────────────────────────────────────────────────────*/

  // "$1,199" / "from $2,499" / "$149 per page"
  function money(n) { return '$' + Number(n).toLocaleString('en-US'); }

  function display(item) {
    if (!item) return '';
    var s = (item.from ? 'from ' : '') + money(item.price != null ? item.price : item.monthly);
    if (item.unit) s += ' ' + item.unit;
    return s;
  }

  // Every purchasable key mapped to its resolved record, for the cart and
  // the checkout function. Care plan terms are expanded into their own keys.
  function catalogue() {
    var out = {};
    Object.keys(PACKAGES).forEach(function (k) { out[k] = PACKAGES[k]; });
    Object.keys(ADDONS).forEach(function (k) { out[k] = ADDONS[k]; });
    out.scoping    = SOFTWARE.scoping;
    // Grandfathered rates: reachable by direct link, never listed publicly.
    // Prepaid terms expand into their own keys the same way the current care
    // plans do, so /cart.html?add=<key>-6mo and -annual resolve.
    Object.keys(LEGACY).forEach(function (k) {
      var l = LEGACY[k];
      out[k] = l;
      if (!l.terms) return;
      out[k + '-6mo'] = {
        key: k + '-6mo', name: l.name + ' · 6 month', price: l.terms.six.price, legacy: true,
        billingNote: l.terms.six.note + ' (' + money(l.terms.six.price) + ' one-time, does not auto-renew)',
      };
      out[k + '-annual'] = {
        key: k + '-annual', name: l.name + ' · annual', price: l.terms.annual.price, legacy: true,
        billingNote: l.terms.annual.note + ' (' + money(l.terms.annual.price) + ' one-time, does not auto-renew)',
      };
    });

    ['essentials', 'growth'].forEach(function (name) {
      var plan = CARE[name];
      out[plan.key]           = { key: plan.key, name: plan.label + ' care plan', monthly: plan.monthly, recurring: true, billingNote: 'Billed monthly' };
      out[plan.key + '-sa']   = { key: plan.key + '-sa', name: plan.label + ' care plan', monthly: plan.monthly, recurring: true, billingNote: 'Billed monthly' };
      out[plan.key + '-6mo']  = { key: plan.key + '-6mo', name: plan.label + ' care plan · 6 month', price: plan.terms.six.price, billingNote: plan.terms.six.note + ' (' + money(plan.terms.six.price) + ' one-time, does not auto-renew)' };
      out[plan.key + '-annual'] = { key: plan.key + '-annual', name: plan.label + ' care plan · annual', price: plan.terms.annual.price, billingNote: plan.terms.annual.note + ' (' + money(plan.terms.annual.price) + ' one-time, does not auto-renew)' };
    });
    return out;
  }

  /* ── Sponsorship ────────────────────────────────────────────────────────
     South Coast Conditions (conditions.rootedcoastdesign.com) sells six small
     slots at the bottom of the page to Coos and Curry businesses. Not a Stripe
     product: these are invoiced by hand, and every sponsor is a warm lead for
     a website. Published here because pricing.js is the single source of truth
     for every number on any surface we own, and check-prices.js enforces it.  */
  var SPONSORSHIP = {
    conditions: {
      key: 'conditions-sponsor',
      name: 'South Coast Conditions sponsor slot',
      monthlyMin: 25,
      monthlyMax: 50,
      slots: 6,
      recurring: true,
      blurb: 'One of six slots at the foot of the conditions page. Name, town and link. No ad tech.',
      billingNote: 'Invoiced monthly, cancel any time',
    },
  };

  // Keys that put a website in the cart — add-ons unlock off these.
  var SITE_KEYS = ['seedling', 'sapling', 'timber'];

  // Physical goods that need a shipping address at checkout.
  var RETIRED_KEYS = ['launch-bundle', 'logo', 'cards-logo', 'cards', 'stickers'];

  return {
    PACKAGES: PACKAGES,
    LAUNCH_BUNDLE: LAUNCH_BUNDLE,
    LEGACY: LEGACY,
    CARE: CARE,
    ADDONS: ADDONS,
    PRINT: PRINT,
    SOFTWARE: SOFTWARE,
    TECH_FEES: TECH_FEES,
    AUDIT_CREDIT_DAYS: AUDIT_CREDIT_DAYS,
    PHOTO_TRAVEL: PHOTO_TRAVEL,
    SPONSORSHIP: SPONSORSHIP,
    INVOICES: INVOICES,
    SITE_KEYS: SITE_KEYS,
    RETIRED_KEYS: RETIRED_KEYS,
    catalogue: catalogue,
    money: money,
    display: display,
  };
});
