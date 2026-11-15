/* ============================================================================
   api/create-checkout.js — Stripe Checkout session builder.

   Every amount is computed SERVER-SIDE from pricing.js. Nothing the client
   sends is trusted as a price. There are no Stripe dashboard Price IDs left:
   all line items are built inline from price_data, so changing a number in
   pricing.js is the only step needed to change what a customer is charged.

   Repriced 2026-09-03.
   ========================================================================= */
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');
const P = require('../pricing.js');

// Shared secret for verifying the signed drive-time travel quote produced by
// api/travel-quote.js. Both endpoints derive the key the same way, so a fee can
// only enter checkout if travel-quote signed it. No new env var is required.
const TRAVEL_SIGN_KEY = process.env.TRAVEL_SIGN_SECRET || process.env.STRIPE_SECRET_KEY || 'rcd-travel-fallback-key';

const cents = (dollars) => Math.round(Number(dollars) * 100);

/* ── Line-item descriptions shown on the Stripe receipt ──────────────────
   Keyed to the catalogue in pricing.js. Kept here rather than in pricing.js
   because they are checkout-specific phrasing, not prices.                  */
const RECEIPT_NAMES = {
  seedling:       'Starter Website — One Page, Designed & Built',
  sapling:        'Standard Website — 3 to 5 Pages (50% deposit today)',
  timber:         'Custom Website — Larger Build, Scoped to Fit (50% deposit today)',
  reskin:         'The Reskin — New Look on Your Existing Structure',
  'seo-audit':    'SEO Audit — Full Site Audit, Google Business Profile Review & One-Page Plan',
  scoping:        'Discovery & Scoping — Written Spec (credited toward a build within 60 days)',
  copywriting:    'Professional Copywriting — Written From Scratch',
  photos:         'Licensed Stock-Photo Sourcing',
  gbp:            'Google Business Profile Setup',
  booking:        'Booking Integration',
  email:          'Branded Email Setup',
  reviews:        'Review Generation Page & Printable QR Code',
  revision:       'Additional Revision Round',
  'online-store': 'Online Store Add-On — Cart, Secure Checkout & Up to 15 Products',
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const str = (v, n) => (typeof v === 'string' ? v : '').slice(0, n);
  const customerEmail = str(body.customerEmail, 120), customerName = str(body.customerName, 120),
        businessName  = str(body.businessName, 120),  orderRef     = str(body.orderRef, 40),
        cardSpec      = typeof body.cardSpec === 'string' ? body.cardSpec : '';
  // Keys are strings, each counted once. A number or a repeated key used to
  // reach the line-item loop (QA walk, 2026-10-29).
  const cartKeys = Array.isArray(body.cartKeys)
    ? [...new Set(body.cartKeys.filter(k => typeof k === 'string' && k.length < 64))]
    : [];

  if (cartKeys.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  if (cartKeys.some(key => P.RETIRED_KEYS.includes(key))) {
    return res.status(400).json({ error: 'That package is no longer available. Review current website packages before ordering.' });
  }

  const CATALOGUE = P.catalogue();
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  // The success and cancel URLs come back to this site only. A client-supplied
  // siteUrl used to be trusted as-is, which let a crafted request send the
  // customer anywhere after paying.
  const OWN_HOSTS = ['www.rootedcoastdesign.com', 'rootedcoastdesign.com', 'localhost'];
  let siteUrl = null;
  try {
    const u = new URL(String(body.siteUrl || ''));
    if (OWN_HOSTS.includes(u.hostname) || (process.env.VERCEL_URL && u.hostname === process.env.VERCEL_URL)) siteUrl = u.origin;
  } catch (e) {}

  let cardSpecs = {};
  try { cardSpecs = cardSpec ? JSON.parse(cardSpec) : {}; } catch (e) {}
  if (!cardSpecs || typeof cardSpecs !== 'object' || Array.isArray(cardSpecs)) cardSpecs = {};

  // The same rules the shop and the cart apply, so no link or crafted request
  // can buy two websites, two care plans, or add-ons with nothing to attach to.
  const SITE_PKGS = ['seedling','sapling','timber','reskin'];
  const sites = cartKeys.filter(k => SITE_PKGS.includes(k));
  if (sites.length > 1) return res.status(400).json({ error: 'One website per order. Pick a single site package.' });
  if (cartKeys.filter(k => k.startsWith('care-')).length > 1) return res.status(400).json({ error: 'One care plan per order.' });
  const hasStd = ['sapling','timber'].some(k => cartKeys.includes(k));
  for (const k of cartKeys) {
    const a = hasOwn(P.ADDONS, k) ? P.ADDONS[k] : null;
    if (a && a.req === 'site' && sites.length === 0) return res.status(400).json({ error: a.name + ' attaches to a website package. Add a site first.' });
    if (k === 'online-store' && !hasStd) return res.status(400).json({ error: 'The online store add-on needs a Standard or Custom website.' });
  }

  const lineItems    = [];
  const unknownKeys  = [];
  const balanceItems = [];
  let   hasRecurring = false;

  for (const key of cartKeys) {
    const item = hasOwn(CATALOGUE, key) ? CATALOGUE[key] : null;
    if (!item) { unknownKeys.push(key); continue; }

    const receiptName = RECEIPT_NAMES[key] || item.name;

    /* ── Care plans, billed monthly ─────────────────────────────────────*/
    if (item.recurring) {
      hasRecurring = true;
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: item.name + ' — billed monthly, cancel with 30 days notice' },
          unit_amount: cents(item.monthly),
          recurring: { interval: 'month' },
        },
        quantity: 1,
      });
      continue;
    }

    /* ── Additional pages — unit price × whitelisted count ──────────────*/
    if (key === 'extra-pages') {
      const unit = P.ADDONS['extra-pages'].price;
      const max  = P.ADDONS['extra-pages'].max;
      let qty = parseInt(cardSpecs[key] && cardSpecs[key].qty, 10);
      if (!Number.isFinite(qty) || qty < 1) qty = 1;
      if (qty > max) qty = max;
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: 'Additional Website Pages (' + qty + ' × ' + P.money(unit) + ')' },
          unit_amount: cents(unit * qty),
        },
        quantity: 1,
      });
      continue;
    }

    /* ── On-site photography — base plus verified travel ────────────────
       A live drive-time fee is only honoured if the HMAC from
       api/travel-quote.js verifies. Otherwise travel is zero and Johnathon
       confirms it manually — never an unverified charge.                    */
    if (key === 'photoshoot') {
      const spec = cardSpecs[key] || {};
      let travel = 0;
      let travelLabel = P.PHOTO_TRAVEL.local.label;

      if (spec.sig && spec.dest != null && spec.fee != null) {
        const fee = Number(spec.fee);
        const expected = crypto.createHmac('sha256', TRAVEL_SIGN_KEY)
          .update(String(spec.dest) + '|' + fee).digest('hex');
        if (Number.isFinite(fee) && fee >= 0 &&
            typeof spec.sig === 'string' && spec.sig.length === expected.length &&
            crypto.timingSafeEqual(Buffer.from(spec.sig), Buffer.from(expected))) {
          travel = fee;
          travelLabel = String(spec.dest);
        }
      } else if (hasOwn(P.PHOTO_TRAVEL, String(spec.zone))) {
        travel = P.PHOTO_TRAVEL[spec.zone].fee;
        travelLabel = P.PHOTO_TRAVEL[spec.zone].label;
      }

      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: travel
              ? 'On-Site Photography — Shoot + ' + P.money(travel) + ' travel (' + travelLabel + ')'
              : 'On-Site Photography — Shot at Your Business (travel included, ' + travelLabel + ')',
          },
          unit_amount: cents(P.ADDONS.photoshoot.price + travel),
        },
        quantity: 1,
      });
      continue;
    }

    /* ── Website packages taking a 50% deposit ───────────*/
    if (item.deposit) {
      const half = item.price / 2;
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: receiptName },
          unit_amount: cents(half),
        },
        quantity: 1,
      });
      // Balance due at launch, recorded for manual invoicing later.
      balanceItems.push({ key, amount: half });
      continue;
    }

    /* ── Everything else: flat, paid in full ────────────────────────────*/
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: { name: receiptName },
        unit_amount: cents(item.price),
      },
      quantity: 1,
    });
  }

  if (lineItems.length === 0) {
    return res.status(400).json({ error: 'No valid items found in cart.' });
  }

  const mode = hasRecurring ? 'subscription' : 'payment';

  const base = siteUrl || (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://www.rootedcoastdesign.com');

  const sessionParams = {
    mode,
    line_items: lineItems,
    customer_email: customerEmail || undefined,

    metadata: {
      business_name:         businessName || '',
      customer_name:         customerName || '',
      order_ref:             orderRef ? String(orderRef).slice(0, 40) : '',
      cart_keys:             cartKeys.join(','),
      skipped_keys:          unknownKeys.join(','),
      balance_due_at_launch: balanceItems.map(b => `${b.key}=$${b.amount.toFixed(2)}`).join(', '),
      card_details:          cardSpec ? String(cardSpec).slice(0, 490) : '',
      card_details_2:        cardSpec ? String(cardSpec).slice(490, 980) : '',
      card_details_3:        cardSpec ? String(cardSpec).slice(980, 1470) : '',
    },
    success_url: `${base}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${base}/cart.html`,
    billing_address_collection: 'auto',
  };

  // A monthly care plan includes a Rooted Coast Invoices seat. The Invoices
  // app shares this Stripe account and grants the seat from the checkout
  // session's cart_keys; stamping the care key on the subscription as well
  // lets its webhook recognise the subscription on its own later (renewals,
  // cancellation) without a lookup. Prepaid terms are one-off payments and
  // carry no subscription, so they get an expiry on the app side instead.
  if (mode === 'subscription') {
    const careKey = cartKeys.find(k => k.startsWith('care-'));
    if (careKey) sessionParams.subscription_data = { metadata: { rc_care: careKey } };
  }

  // No sale running: let customers enter a promotion code at checkout.
  // To run a sale, create a Stripe coupon and set sessionParams.discounts
  // instead (Stripe does not allow discounts and allow_promotion_codes together).
  sessionParams.allow_promotion_codes = true;

  try {
    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.status(200).json({ url: session.url, skipped: unknownKeys });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
