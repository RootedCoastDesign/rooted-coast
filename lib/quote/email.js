// DRAFT, with quote.js. One email template in the new site's look, used by every email the site sends:
// black background, slate lines, the wordmark, cyan as the accent, and the terminal line from the footer.
// Built with tables and inline styles because that is what email programs render reliably. The headline face is
// requested as a web font and falls back to the system sans where an email program blocks web fonts.
'use strict';
const C = { bg: '#040404', panel: '#0C0D0F', line: '#2B3037', ink: '#EEF3F6', body: '#B3BEC7', dim: '#7C8892', sea: '#8FE3F8', btn: '#2E353D', btnLine: '#56606C' };
const HEAD = "'Bricolage Grotesque','Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const SANS = "'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
// No Courier in this list: Android turns it into a wide serif typewriter face that wrapped the footer in Gmail.
const MONO = "'Geist Mono',ui-monospace,'SF Mono',Menlo,Consolas,'Roboto Mono','Droid Sans Mono',monospace";

// { preheader, label, title, intro, rows: [[label, value]], button: { href, text }, note } -> a full HTML document
function brandEmail(o, esc) {
  const rows = (o.rows || []).filter(r => r && r[1] != null && r[1] !== '');
  const table = rows.length ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:22px 0 0;border-top:1px solid ' + C.line + '">'
    + rows.map(r => '<tr><td valign="top" style="padding:11px 14px 11px 0;border-bottom:1px solid ' + C.line + ';font:400 13px/1.5 ' + SANS + ';color:' + C.dim + ';width:34%">' + esc(r[0]) + '</td>'
      + '<td valign="top" style="padding:11px 0;border-bottom:1px solid ' + C.line + ';font:400 15px/1.5 ' + SANS + ';color:' + C.ink + ';white-space:pre-wrap;word-break:break-word">' + esc(r[1]) + '</td></tr>').join('') + '</table>' : '';
  const button = o.button ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 0"><tr><td bgcolor="' + C.btn + '" style="border-radius:999px;border:1px solid ' + C.btnLine + '">'
    + '<a href="' + esc(o.button.href) + '" style="display:inline-block;padding:14px 24px;font:500 15px/1 ' + SANS + ';color:' + C.ink + ';text-decoration:none;border-radius:999px">' + esc(o.button.text) + ' &rarr;</a></td></tr></table>' : '';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">'
    + '<title>' + esc(o.title) + '</title><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500&family=Geist:wght@300;400;500;600&family=Geist+Mono&display=swap" rel="stylesheet"></head>'
    + '<body bgcolor="' + C.bg + '" style="margin:0;padding:0;background:' + C.bg + ';color:' + C.body + '">'
    + (o.preheader ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:' + C.bg + '">' + esc(o.preheader) + '</div>' : '')
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="' + C.bg + '" style="background:' + C.bg + '"><tr><td align="center" style="padding:28px 16px 36px">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">'
    // wordmark
    + '<tr><td style="padding:0 4px 22px;font:600 21px/1 ' + SANS + ';letter-spacing:-.045em;color:' + C.ink + '">rooted<span style="font-weight:300">coast</span><span style="font-weight:300;color:' + C.dim + '"> / </span><span style="font-weight:400;color:' + C.sea + '">design</span></td></tr>'
    // the card
    + '<tr><td bgcolor="' + C.panel + '" style="background:' + C.panel + ';border:1px solid ' + C.line + ';border-radius:18px;padding:28px 26px 30px">'
    + (o.label ? '<p style="margin:0 0 12px;font:400 11px/1.4 ' + MONO + ';letter-spacing:.2em;text-transform:uppercase;color:' + C.dim + '">' + esc(o.label) + '</p>' : '')
    + '<h1 style="margin:0;font:500 28px/1.12 ' + HEAD + ';letter-spacing:-.03em;color:' + C.ink + '">' + esc(o.title) + (o.accent ? ' <span style="color:' + C.sea + '">' + esc(o.accent) + '</span>' : '') + '</h1>'
    + (o.intro ? '<p style="margin:14px 0 0;font:400 16px/1.55 ' + SANS + ';color:' + C.body + '">' + esc(o.intro) + '</p>' : '')
    + table + button
    + (o.note ? '<p style="margin:22px 0 0;font:400 14px/1.55 ' + SANS + ';color:' + C.dim + '">' + esc(o.note) + '</p>' : '')
    + '</td></tr>'
    // the site's footer (2026-11-15): wordmark, one line, email and phone, the legal line, centred
    + '<tr><td align="center" style="padding:30px 4px 0;text-align:center;font:600 22px/1 ' + SANS + ';letter-spacing:-.04em;color:' + C.ink + '">rooted<span style="font-weight:300">coast</span></td></tr>'
    + '<tr><td align="center" style="padding:8px 4px 0;text-align:center;font:400 13px/1.5 ' + SANS + ';color:' + C.body + '">Websites, software and computer repair &middot; Bandon, Oregon</td></tr>'
    + '<tr><td align="center" style="padding:14px 4px 0;text-align:center;font:400 14px/1.6 ' + SANS + ';color:' + C.body + '"><a href="mailto:hello@rootedcoastdesign.com" style="color:' + C.ink + ';text-decoration:none">hello@rootedcoastdesign.com</a> &nbsp;&middot;&nbsp; <a href="tel:+15413299273" style="color:' + C.ink + ';text-decoration:none;white-space:nowrap">(541) 329-9273</a></td></tr>'
    + '<tr><td align="center" style="padding:12px 4px 0;text-align:center;font:400 12px/1.5 ' + SANS + ';color:' + C.dim + '">&copy; 2026 Rooted Coast Design LLC</td></tr>'
    + '</table></td></tr></table></body></html>';
}
module.exports = { brandEmail, C };
