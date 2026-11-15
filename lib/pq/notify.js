// lib/pq/notify.js
// ─────────────────────────────────────────────────────────────────────────────
// Getting the lead in front of the contractor.
//
// Email goes out through Resend's REST API with plain fetch — no SDK, no extra
// dependency, and it is three fields wide. SMS is optional and only fires if
// Twilio credentials exist, because a text is what actually gets read on a
// jobsite and an email is what gets read that evening.
//
// NOTHING IN HERE MAY THROW. A failed notification must not fail the submit —
// the lead is already saved and the homeowner is already looking at a thank-you
// screen. Every send returns a result object instead of raising.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const RESEND_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.PQ_FROM_EMAIL || 'Rooted Coast Quotes <quotes@rootedcoastdesign.com>';
const REPLY_TO_DEFAULT = process.env.PQ_REPLY_TO || 'hello@rootedcoastdesign.com';

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER || '';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function prettyPhone(p) {
  const d = String(p || '').replace(/\D/g, '').replace(/^1/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || '');
}

// ── Resend ───────────────────────────────────────────────────────────────────

// Display name on the From line. The mailbox stays quotes@rootedcoastdesign.com
// (that is the domain Resend has verified), but the *name* is the client's, so
// a lead reads as "England Brothers Painting leads" in a crowded tab list
// rather than as a vendor they have never heard of.
function fromFor(tenant) {
  const m = /<([^>]+)>/.exec(FROM);
  const mailbox = m ? m[1] : FROM;
  const name = tenant && (tenant.fromName || (tenant.name + ' leads'));
  return name ? `${name.replace(/[<>"]/g, '')} <${mailbox}>` : FROM;
}

async function sendEmail({ to, subject, html, text, replyTo, from }) {
  if (!RESEND_KEY) {
    console.warn('[pq] RESEND_API_KEY not set — email skipped. Subject:', subject, '→', to);
    return { ok: false, skipped: true, reason: 'no-key' };
  }
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) return { ok: false, skipped: true, reason: 'no-recipient' };

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + RESEND_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from || FROM,
        to: recipients,
        subject,
        html,
        text,
        reply_to: replyTo || REPLY_TO_DEFAULT,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error('[pq] resend failed', r.status, body.slice(0, 400));
      return { ok: false, status: r.status };
    }
    return { ok: true };
  } catch (e) {
    console.error('[pq] resend threw:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── Twilio (optional) ────────────────────────────────────────────────────────

async function sendSms(to, body) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM || !to) {
    return { ok: false, skipped: true };
  }
  try {
    const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + auth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body }).toString(),
    });
    if (!r.ok) {
      console.error('[pq] twilio failed', r.status, (await r.text().catch(() => '')).slice(0, 300));
      return { ok: false, status: r.status };
    }
    return { ok: true };
  } catch (e) {
    console.error('[pq] twilio threw:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── Templates ────────────────────────────────────────────────────────────────
// Table-based and inline-styled, because Gmail on Android strips most of what
// you would rather write. Photos are linked full-size AND embedded as remote
// images — if the client blocks images, the "Open the lead" button still works.

function contractorEmail(tenant, lead, leadUrl) {
  const brand = (tenant.brand && tenant.brand.color) || '#00617A';
  const rows = [];

  if (lead.address) rows.push(['Address', lead.address]);
  if (lead.jobType) rows.push(['Job', lead.jobType]);

  for (const q of tenant.questions || []) {
    const v = lead.answers && lead.answers[q.id];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    rows.push([q.label, Array.isArray(v) ? v.join(', ') : String(v)]);
  }

  const rowsHtml = rows.map(([k, v]) => `
    <tr>
      <td style="padding:9px 14px 9px 0;vertical-align:top;color:#6b7780;font:400 13px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;white-space:nowrap;">${esc(k)}</td>
      <td style="padding:9px 0;vertical-align:top;color:#12181c;font:500 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${esc(v)}</td>
    </tr>`).join('');

  const photosHtml = (lead.photos || []).map((p, i) => `
    <a href="${esc(p.url)}" style="text-decoration:none;display:inline-block;margin:0 8px 8px 0;">
      <img src="${esc(p.url)}" alt="Photo ${i + 1}" width="150"
           style="width:150px;height:150px;object-fit:cover;border-radius:6px;border:1px solid #dfe4e7;display:block;">
    </a>`).join('');

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f2f5f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f6;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8ea;">

    <tr><td style="background:${esc(brand)};padding:18px 24px;">
      <div style="color:#ffffff;font:700 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;opacity:.85;">New quote request</div>
      <div style="color:#ffffff;font:700 21px/1.25 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin-top:5px;">${esc(lead.name || 'Someone')} — ${esc(lead.jobType || tenant.name)}</div>
    </td></tr>

    <tr><td style="padding:22px 24px 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-bottom:14px;">
            ${lead.phone ? `<a href="tel:${esc(lead.phone)}" style="display:inline-block;background:${esc(brand)};color:#fff;text-decoration:none;font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:13px 20px;border-radius:6px;margin:0 8px 8px 0;">Call ${esc(prettyPhone(lead.phone))}</a>` : ''}
            ${lead.phone ? `<a href="sms:${esc(lead.phone)}" style="display:inline-block;background:#ffffff;color:${esc(brand)};text-decoration:none;font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:12px 20px;border:1.5px solid ${esc(brand)};border-radius:6px;margin:0 8px 8px 0;">Text</a>` : ''}
          </td>
        </tr>
      </table>
    </td></tr>

    ${photosHtml ? `<tr><td style="padding:0 24px 6px;">
      <div style="color:#6b7780;font:600 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;margin-bottom:10px;">${(lead.photos || []).length} photo${(lead.photos || []).length === 1 ? '' : 's'}</div>
      ${photosHtml}
    </td></tr>` : ''}

    <tr><td style="padding:10px 24px 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef2f3;">
        ${rowsHtml}
      </table>
    </td></tr>

    <tr><td style="padding:20px 24px 26px;">
      <a href="${esc(leadUrl)}" style="display:block;text-align:center;background:#12181c;color:#ffffff;text-decoration:none;font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:15px 20px;border-radius:6px;">Open the full lead</a>
      <div style="color:#93a0a8;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin-top:12px;text-align:center;">
        Reply to this email and it goes straight to ${esc(lead.email || 'the customer')}.
      </div>
    </td></tr>

    <tr><td style="padding:14px 24px;background:#fafbfb;border-top:1px solid #eef2f3;text-align:center;">
      <span style="color:#a3aeb5;font:400 11px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">Rooted Coast Quotes · rootedcoastdesign.com</span>
    </td></tr>

  </table>
</td></tr></table></body></html>`;

  const text = [
    `NEW QUOTE REQUEST — ${tenant.name}`,
    '',
    `${lead.name || 'Someone'}`,
    lead.phone ? `Phone: ${prettyPhone(lead.phone)}` : '',
    lead.email ? `Email: ${lead.email}` : '',
    '',
    // rows already starts with Address and Job, so do not list them again
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `${(lead.photos || []).length} photo(s):`,
    ...(lead.photos || []).map((p) => p.url),
    '',
    `Full lead: ${leadUrl}`,
  ].filter((l) => l !== '').join('\n');

  return {
    subject: `New quote request — ${lead.name || 'Someone'}${lead.jobType ? ' · ' + lead.jobType : ''}`,
    html,
    text,
  };
}

function homeownerEmail(tenant, lead) {
  const brand = (tenant.brand && tenant.brand.color) || '#00617A';
  const photoCount = (lead.photos || []).length;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f2f5f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f6;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:10px;border:1px solid #e2e8ea;">
    <tr><td style="background:${esc(brand)};padding:18px 24px;">
      <div style="color:#ffffff;font:700 19px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${esc(tenant.name)}</div>
    </td></tr>
    <tr><td style="padding:24px;">
      <p style="margin:0 0 14px;color:#12181c;font:400 16px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">Thanks${lead.name ? ', ' + esc(lead.name.split(' ')[0]) : ''} — we got it.</p>
      <p style="margin:0 0 14px;color:#3e545e;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
        Your ${photoCount} photo${photoCount === 1 ? '' : 's'} and your answers are with ${esc(tenant.name)} now. Someone will get back to you${lead.phone ? ' at ' + esc(prettyPhone(lead.phone)) : ''}, usually within one business day.
      </p>
      <p style="margin:0;color:#6b7780;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
        If anything changes, just reply to this email.
      </p>
    </td></tr>
    <tr><td style="padding:14px 24px;background:#fafbfb;border-top:1px solid #eef2f3;text-align:center;">
      <span style="color:#a3aeb5;font:400 11px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${esc(tenant.legalName || tenant.name)} · ${esc(tenant.city || '')}</span>
    </td></tr>
  </table>
</td></tr></table></body></html>`;

  return {
    subject: `We got your photos — ${tenant.name}`,
    html,
    text: `Thanks — we got it.\n\nYour ${photoCount} photo(s) and answers are with ${tenant.name}. Someone will get back to you, usually within one business day.\n\n${tenant.legalName || tenant.name}`,
  };
}

// ── Public entry point ───────────────────────────────────────────────────────

async function notifyNewLead(tenant, lead, leadUrl) {
  const results = {};

  const c = contractorEmail(tenant, lead, leadUrl);
  results.contractorEmail = await sendEmail({
    from: fromFor(tenant),
    to: tenant.notifyEmail,
    subject: c.subject,
    html: c.html,
    text: c.text,
    // Replying to the notification should reach the homeowner, not us.
    replyTo: lead.email || REPLY_TO_DEFAULT,
  });

  if (lead.email) {
    const h = homeownerEmail(tenant, lead);
    results.homeownerEmail = await sendEmail({
      from: fromFor(tenant),
      to: lead.email,
      subject: h.subject,
      html: h.html,
      text: h.text,
      replyTo: (tenant.notifyEmail && tenant.notifyEmail[0]) || REPLY_TO_DEFAULT,
    });
  }

  if (tenant.sms) {
    results.sms = await sendSms(
      tenant.sms,
      `New quote request: ${lead.name || 'Someone'}${lead.phone ? ' ' + prettyPhone(lead.phone) : ''}` +
      `${lead.jobType ? ' — ' + lead.jobType : ''}. ${(lead.photos || []).length} photos. ${leadUrl}`
    );
  }

  return results;
}

module.exports = { notifyNewLead, sendEmail, sendSms, esc, prettyPhone };
