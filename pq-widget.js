/* ────────────────────────────────────────────────────────────────────────────
   ROOTED COAST QUOTES — embeddable photo-to-quote widget
   rootedcoastdesign.com

   Drop one line on any client site:

     <script src="https://www.rootedcoastdesign.com/pq-widget.js"
             data-site="england-brothers" defer><\/script>

   (That closing tag is written <\/script> on purpose. An HTML parser ends a
   script block at the first literal <\/script> it sees, even inside a comment or
   a string — so a raw one here would truncate this file the moment anyone
   inlines it into a page instead of loading it by src. Keep every closing tag
   in this file escaped.)

   It renders where the script tag sits. To place it somewhere specific, add an
   empty element instead and the widget fills it:

     <div data-rcd-quote></div>

   Options on the script tag:
     data-site      required — tenant slug from lib/pq/tenants.js
     data-mode      "inline" (default) or "button" (opens a full-screen sheet)
     data-label     button text, when mode="button"
     data-on-sent   name of a window function to call when a lead sends, for
                    analytics. A 'rcd-quote-sent' event on window fires either
                    way. Detail: { slug, leadId, photoCount }.
     data-api       override API origin (defaults to the script's own origin)

   ── Two design decisions worth knowing before you edit this file ──

   1. SHADOW DOM. The widget mounts in a closed-ish shadow root so the client
      site's CSS cannot reach in and the widget's CSS cannot leak out. Every
      trades site this ships to has different, often careless, global styles.
      Without isolation this breaks on site three.

   2. UPLOADS START IMMEDIATELY. The moment a photo is chosen it compresses and
      begins uploading, in the background, while the homeowner answers the
      questions. By the time they reach Send, the uploads are already done and
      the button responds instantly. Uploading at submit time means a spinner on
      a bad connection, and a spinner on a bad connection is an abandoned lead.

   Compression: longest edge capped at 1600px, JPEG q0.82. A 6 MB iPhone photo
   lands around 300 KB — plenty to see a cracked hose or read a model plate,
   small enough to send over one bar.
   ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  // Finding our own script tag, in order of reliability.
  //
  // document.currentScript is the right answer and works for a plain
  // <script src> on a normal page. It is null whenever the script is executed
  // some other way: injected by a tag manager, re-created by a CMS, run inside
  // a sandboxed frame that rebuilds the document. Small business sites do all
  // three, so falling straight to "the last script on the page" — which is
  // whatever ran most recently, usually not ours — silently produces an empty
  // slug and a widget that never renders.
  //
  // So: ask for the element by the attribute that identifies it.
  var SCRIPT = document.currentScript
    || document.querySelector('script[data-site][src*="pq-widget"]')
    || document.querySelector('script[data-site]')
    || (function () {
      var s = document.getElementsByTagName('script');
      return s[s.length - 1];
    })();

  var SLUG = (SCRIPT && SCRIPT.getAttribute('data-site')) || '';
  var MODE = (SCRIPT && SCRIPT.getAttribute('data-mode')) || 'inline';
  var LABEL = (SCRIPT && SCRIPT.getAttribute('data-label')) || 'Get a quote from photos';
  var API = (SCRIPT && SCRIPT.getAttribute('data-api')) ||
    (SCRIPT && SCRIPT.src ? new URL(SCRIPT.src).origin : '');
  var ON_SENT = (SCRIPT && SCRIPT.getAttribute('data-on-sent')) || '';

  if (!SLUG) { console.error('[rcd-quotes] missing data-site on the script tag'); return; }

  // The widget lives in a shadow root, so a host page cannot listen to anything
  // inside it. Sites that replaced a form which fired its own analytics event
  // need that event back. Two ways in, both optional:
  //
  //   window.addEventListener('rcd-quote-sent', fn)   — always dispatched
  //   data-on-sent="myFunc"                           — calls window.myFunc
  //
  // Both get { slug, leadId, photoCount }. Fired once, only on a lead the API
  // confirmed. Wrapped so a broken analytics snippet on the host page can never
  // take down the thank-you screen the homeowner is looking at.
  function announceSent(detail) {
    try {
      window.dispatchEvent(new CustomEvent('rcd-quote-sent', { detail: detail }));
    } catch (e) { /* CustomEvent is ancient; not worth a shim */ }
    if (!ON_SENT) return;
    try {
      var fn = window[ON_SENT];
      if (typeof fn === 'function') fn(detail);
      else console.warn('[rcd-quotes] data-on-sent="' + ON_SENT + '" is not a function on window');
    } catch (e) {
      console.warn('[rcd-quotes] data-on-sent handler threw', e);
    }
  }

  var MAX_EDGE = 1600;
  var JPEG_Q = 0.82;
  var MAX_PHOTOS = 6;

  // ── Tiny DOM helper ────────────────────────────────────────────────────────
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) el.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }

  // ── Styles ─────────────────────────────────────────────────────────────────
  // Scoped to the shadow root. --brand is set per tenant at mount time.
  // Fonts are loaded by the host document, and @font-face is document-scoped —
  // which means a face the client's site already declares (Anton, say) is
  // usable inside our shadow root by name. Always give it a real fallback
  // stack: if their font fails to load, the widget must not fall to Times.
  var CSS = `
:host{ all:initial; }
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
.rcq{
  --brand:#00617A; --brand-text:#fff;
  --bg:#fff; --panel:#f6f8f9; --line:#dfe6e9; --line-soft:#eef2f3;
  --head:#101416; --body:#3f5057; --dim:#7d8b93; --bad:#b3261e; --good:#1e7a4f;
  --accent:var(--brand);        /* brand used as ink, lines and small marks */
  --radius:10px; --btn-radius:10px;
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --font-head:var(--font);
  --head-transform:none; --head-spacing:normal;
  font:400 16px/1.55 var(--font);
  color:var(--body); background:var(--bg);
  border:1px solid var(--line); border-radius:var(--radius); padding:20px;
  max-width:620px; text-align:left;
}
/* Only applies when the tenant has not forced a surface. A forced surface is
   set as an inline style on .rcq, which outranks any stylesheet rule. */
@media (prefers-color-scheme: dark){
  .rcq{ --bg:#151b1e; --panel:#1c2427; --line:#2b3539; --line-soft:#222b2f;
        --head:#e6edf0; --body:#a8bac2; --dim:#7b8a92; }
}
.rcq.sheet{border:none;border-radius:0;max-width:none;min-height:100%;padding:20px 16px 40px}

/* header + progress */
.hd{margin-bottom:18px}
.kick{font-size:11px;letter-spacing:.17em;text-transform:uppercase;font-weight:700;color:var(--accent)}
h2{font-family:var(--font-head);font-size:clamp(1.25rem,4.6vw,1.6rem);line-height:1.22;font-weight:700;color:var(--head);margin:7px 0 6px;text-transform:var(--head-transform);letter-spacing:var(--head-spacing)}
.sub{font-size:14.5px;color:var(--dim)}
.bar{display:flex;gap:5px;margin:16px 0 20px}
.bar i{flex:1;height:3px;border-radius:2px;background:var(--line);transition:background .25s}
.bar i.on{background:var(--accent)}

/* steps */
.step{display:none}
.step.on{display:block;animation:fade .18s ease-out}
@keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}

fieldset{border:none;margin:0 0 20px}
legend,.qlabel{display:block;font-family:var(--font-head);font-weight:600;color:var(--head);font-size:16px;margin-bottom:4px;text-transform:var(--head-transform);letter-spacing:var(--head-spacing)}
.hint{font-size:13.5px;color:var(--dim);margin-bottom:10px;line-height:1.45}

/* option chips */
.opts{display:flex;flex-direction:column;gap:8px}
.opts.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.opt{display:flex;align-items:flex-start;gap:10px;background:var(--panel);
  border:1.5px solid var(--line-soft);border-radius:var(--radius);padding:12px 13px;cursor:pointer;
  font-size:15px;color:var(--body);min-height:48px;transition:border-color .12s,color .12s}
.opt:hover{border-color:var(--accent)}
.opt input{accent-color:var(--accent);width:19px;height:19px;margin:1px 0 0;flex:none}
.opt.sel{border-color:var(--accent);color:var(--head);font-weight:500}

input[type=text],input[type=tel],input[type=email],textarea{
  width:100%;background:var(--panel);border:1.5px solid var(--line-soft);border-radius:var(--radius);
  color:var(--head);font:400 16px/1.5 inherit;font-family:inherit;padding:13px 13px;min-height:50px}
input:focus,textarea:focus{outline:none;border-color:var(--accent)}
textarea{min-height:92px;resize:vertical}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media(max-width:470px){.two{grid-template-columns:1fr}}

/* photos */
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:9px;margin:12px 0}
.shot{position:relative;aspect-ratio:1;border-radius:var(--radius);overflow:hidden;background:var(--panel);
  border:1.5px solid var(--line-soft)}
.shot img{width:100%;height:100%;object-fit:cover;display:block}
.shot .veil{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  background:rgba(10,14,16,.55);color:#fff;font-size:11px;font-weight:700;letter-spacing:.06em}
.shot.err{border-color:var(--bad)}
.shot .x{position:absolute;top:5px;right:5px;width:26px;height:26px;border-radius:50%;border:none;
  background:rgba(10,14,16,.66);color:#fff;font:700 15px/1 inherit;cursor:pointer;
  display:flex;align-items:center;justify-content:center}
.add{aspect-ratio:1;border:1.5px dashed var(--line);border-radius:var(--radius);background:transparent;
  color:var(--dim);cursor:pointer;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:5px;font:600 12px/1.3 inherit;font-family:inherit;text-align:center;padding:6px}
.add:hover{border-color:var(--accent);color:var(--accent)}
.add svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.8}
.prompts{background:var(--panel);border-radius:var(--radius);padding:13px 14px;margin-bottom:6px}
.prompts li{list-style:none;font-size:14px;line-height:1.5;padding-left:20px;position:relative;margin-bottom:7px;color:var(--body)}
.prompts li:last-child{margin-bottom:0}
.prompts li::before{content:"";position:absolute;left:0;top:.55em;width:7px;height:7px;
  border-radius:50%;background:var(--accent)}
.prompts b{color:var(--head);font-weight:600}
.upnote{font-size:13px;color:var(--dim);margin-top:2px;min-height:18px}

/* nav */
.nav{display:flex;gap:10px;margin-top:6px}
button.go{flex:1;min-height:54px;border:var(--btn-ring-w,0) solid var(--btn-ring,transparent);border-radius:var(--btn-radius);background:var(--brand);
  color:var(--brand-text);font:600 16px/1 inherit;font-family:inherit;cursor:pointer;padding:0 16px;
  transition:background-color 180ms,color 180ms}
button.go:not([disabled]):hover{background:var(--btn-hover,var(--brand));color:var(--btn-hover-text,var(--brand-text))}
button.go[disabled]{opacity:.55;cursor:default}
button.back{min-height:54px;border:1.5px solid var(--line);border-radius:var(--btn-radius);background:transparent;
  color:var(--body);font:600 15px/1 inherit;font-family:inherit;cursor:pointer;padding:0 18px}

.err{color:var(--bad);font-size:14px;margin-top:9px;font-weight:500}
.fine{font-size:12.5px;color:var(--dim);margin-top:12px;line-height:1.5}
.hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}

/* done */
.done{text-align:center;padding:14px 0 6px}
.done .tick{width:60px;height:60px;margin:0 auto 16px;border-radius:50%;background:var(--brand);
  display:flex;align-items:center;justify-content:center}
.done .tick svg{width:30px;height:30px;stroke:#fff;fill:none;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.done h3{font-family:var(--font-head);font-size:1.35rem;color:var(--head);font-weight:700;margin-bottom:9px;text-transform:var(--head-transform);letter-spacing:var(--head-spacing)}
.done p{font-size:15px;margin-bottom:8px}

/* modal shell */
.scrim{position:fixed;inset:0;background:rgba(8,12,14,.62);z-index:2147483000;
  overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0}
.sheetwrap{max-width:640px;margin:0 auto;min-height:100%;background:var(--bg)}
.close{position:sticky;top:0;z-index:2;display:flex;justify-content:flex-end;
  background:var(--bg);padding:10px 12px 0}
.close button{width:40px;height:40px;border-radius:50%;border:1px solid var(--line);
  background:var(--bg);color:var(--body);font:400 22px/1 inherit;cursor:pointer}
button.launch{border:none;border-radius:var(--btn-radius);background:var(--brand);color:var(--brand-text);
  font:600 16px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  min-height:54px;padding:0 24px;cursor:pointer}

@media (prefers-reduced-motion: reduce){ .step.on{animation:none} }
`;

  // ── Image compression ──────────────────────────────────────────────────────
  // createImageBitmap with imageOrientation:'from-image' respects EXIF, so a
  // photo taken sideways does not arrive sideways. Older Safari falls back to
  // an <img>, which browsers have auto-oriented for years.
  function compress(file) {
    return new Promise(function (resolve, reject) {
      function draw(src, w, h) {
        var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));
        var c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        var ctx = c.getContext('2d');
        ctx.drawImage(src, 0, 0, cw, ch);
        var url = c.toDataURL('image/jpeg', JPEG_Q);
        if (src.close) src.close();
        if (!url || url.length < 100) return reject(new Error('encode failed'));
        resolve(url);
      }

      if (window.createImageBitmap) {
        createImageBitmap(file, { imageOrientation: 'from-image' })
          .then(function (bm) { draw(bm, bm.width, bm.height); })
          .catch(fallback);
      } else { fallback(); }

      function fallback() {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          try { draw(img, img.naturalWidth, img.naturalHeight); }
          catch (e) { reject(e); }
          finally { URL.revokeObjectURL(url); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
        img.src = url;
      }
    });
  }

  // ── Theming ────────────────────────────────────────────────────────────────
  // The widget drops into a section the client's designer already styled. On a
  // dark estimate panel a white rounded card reads as pasted-on, and the whole
  // point of an embed is that it looks like it belongs there.
  //
  // Everything here is set as an INLINE style on .rcq, which outranks the
  // stylesheet — including the prefers-color-scheme block. So a tenant that
  // forces `surface: 'dark'` stays dark on a phone in light mode, which is what
  // "match the section it sits in" has to mean.
  //
  // Tenant fields, all optional:
  //   color, text        brand fill and the text that sits on it
  //   surface            'dark' | 'light' — omit to follow the viewer's setting
  //   radius             CSS length, e.g. '0px' for a square-cornered site
  //   font, headFont     font stacks; a face the host page @font-faces works
  //   headUppercase      true for display type that is set in caps
  //   dark               overrides for the dark palette, e.g. { bg:'#14100D' }
  var DARK_DEFAULT = {
    bg: '#151b1e', panel: '#1c2427', line: '#2b3539', lineSoft: '#222b2f',
    head: '#e6edf0', body: '#a8bac2', dim: '#7b8a92',
  };
  var LIGHT_DEFAULT = {
    bg: '#ffffff', panel: '#f6f8f9', line: '#dfe6e9', lineSoft: '#eef2f3',
    head: '#101416', body: '#3f5057', dim: '#7d8b93',
  };

  function applyBrand(el, B) {
    var s = el.style;
    if (B.color) s.setProperty('--brand', B.color);
    if (B.text) s.setProperty('--brand-text', B.text);
    // A brand colour that is legible as a button fill is often illegible as
    // 11px text on that brand's own dark panel — England Brothers' #B70202 on
    // #14100D, for one. `accent` is the colour for ink, hairlines and the
    // little prompt dots; it defaults to the brand colour when unset.
    if (B.accent) s.setProperty('--accent', B.accent);

    if (B.surface === 'dark' || B.surface === 'light') {
      var base = B.surface === 'dark' ? DARK_DEFAULT : LIGHT_DEFAULT;
      var p = {};
      for (var k in base) p[k] = base[k];
      var over = (B.surface === 'dark' ? B.dark : B.light) || {};
      for (var j in over) p[j] = over[j];

      s.setProperty('--bg', p.bg);
      s.setProperty('--panel', p.panel);
      s.setProperty('--line', p.line);
      s.setProperty('--line-soft', p.lineSoft);
      s.setProperty('--head', p.head);
      s.setProperty('--body', p.body);
      s.setProperty('--dim', p.dim);
      // The default bad-news red is tuned for white. On a dark panel it goes
      // muddy and stops reading as an error at all.
      if (B.surface === 'dark') s.setProperty('--bad', p.bad || '#ff8a80');
    }

    if (B.radius != null) {
      s.setProperty('--radius', B.radius);
      s.setProperty('--btn-radius', B.btnRadius != null ? B.btnRadius : B.radius);
    }
    // Optional ring and hover on the primary button, so a site whose buttons
    // carry an outline (Andrew Remodel: black with a gold ring that fills gold
    // on hover) gets the same button inside the form. Unset = plain fill.
    if (B.btnRing) { s.setProperty('--btn-ring', B.btnRing); s.setProperty('--btn-ring-w', B.btnRingWidth || '3px'); }
    if (B.btnHover) s.setProperty('--btn-hover', B.btnHover);
    if (B.btnHoverText) s.setProperty('--btn-hover-text', B.btnHoverText);
    if (B.font) s.setProperty('--font', B.font);
    if (B.headFont) s.setProperty('--font-head', B.headFont);
    if (B.headUppercase) {
      s.setProperty('--head-transform', 'uppercase');
      s.setProperty('--head-spacing', B.headSpacing || '.02em');
    }
  }

  // ── Widget ─────────────────────────────────────────────────────────────────
  function build(host, cfg, opts) {
    var root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.innerHTML = '';
    root.appendChild(h('style', { text: CSS }));

    var card = h('div', { class: 'rcq' + (opts && opts.sheet ? ' sheet' : '') });
    applyBrand(card, cfg.brand || {});
    root.appendChild(card);

    var startedAt = Date.now();
    var state = { jobType: '', answers: {}, photos: [] };
    var step = 0;
    var STEPS = 4;

    // header ------------------------------------------------------------------
    var title = h('h2', { text: cfg.heading || 'Get a quote from photos' });
    var sub = h('p', { class: 'sub', text: cfg.intro || '' });
    var bar = h('div', { class: 'bar' });
    var bars = [];
    for (var i = 0; i < STEPS; i++) { var b = h('i'); bars.push(b); bar.appendChild(b); }
    card.appendChild(h('div', { class: 'hd' }, [
      h('div', { class: 'kick', text: cfg.name }), title, sub, bar,
    ]));

    var stepsWrap = h('div');
    card.appendChild(stepsWrap);
    // No "powered by" line. The widget is the client's form on the client's
    // site; the credit belongs in the email footer, not in front of their
    // customer. Removed 2026-09-06 at the owner's instruction.

    // `scroll` is false for the first paint at mount. Scrolling there hijacks
    // the page: every visitor landed on the quote card instead of the top of
    // the site, because mount happens on load. Only a step change the
    // homeowner caused should move the page. (Reported by the owner on
    // Coastal Appliance's site, 2026-09-06.)
    function paint(scroll) {
      bars.forEach(function (el, i) { el.classList.toggle('on', i <= step); });
      [].forEach.call(stepsWrap.children, function (el, i) { el.classList.toggle('on', i === step); });
      var active = stepsWrap.children[step];
      if (active && scroll) {
        // Scroll the card into view on step change, but do not steal focus into
        // a text field — that pops the keyboard over the question on mobile.
        card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    }
    function go(n) { step = Math.max(0, Math.min(STEPS, n)); paint(true); }

    function navRow(backLabel, nextLabel, onNext) {
      var next = h('button', { class: 'go', type: 'button', text: nextLabel, onclick: onNext });
      var row = h('div', { class: 'nav' });
      if (backLabel) row.appendChild(h('button', { class: 'back', type: 'button', text: backLabel, onclick: function () { go(step - 1); } }));
      row.appendChild(next);
      return { row: row, next: next };
    }

    function errorLine() { return h('p', { class: 'err', role: 'alert', 'aria-live': 'polite' }); }

    // ── Step 1 · job type ────────────────────────────────────────────────────
    var s1 = h('div', { class: 'step' });
    var s1err = errorLine();
    var jobOpts = h('div', { class: 'opts grid' });
    (cfg.jobTypes || []).forEach(function (label) {
      var input = h('input', { type: 'radio', name: 'jobType', value: label });
      var lab = h('label', { class: 'opt' }, [input, h('span', { text: label })]);
      input.addEventListener('change', function () {
        [].forEach.call(jobOpts.children, function (x) { x.classList.remove('sel'); });
        lab.classList.add('sel');
        state.jobType = label;
        s1err.textContent = '';
      });
      jobOpts.appendChild(lab);
    });
    var n1 = navRow(null, 'Next', function () {
      if (!state.jobType) { s1err.textContent = 'Pick the one that fits closest.'; return; }
      applyConditions();
      go(1);
    });
    s1.appendChild(h('fieldset', {}, [
      h('legend', { text: 'What do you need done?' }),
      h('p', { class: 'hint', text: 'Closest match is fine. You can explain in a moment.' }),
      jobOpts,
    ]));
    s1.appendChild(s1err);
    s1.appendChild(n1.row);
    stepsWrap.appendChild(s1);

    // ── Step 2 · photos ──────────────────────────────────────────────────────
    var s2 = h('div', { class: 'step' });
    var s2err = errorLine();
    var shots = h('div', { class: 'shots' });
    var upnote = h('p', { class: 'upnote', 'aria-live': 'polite' });
    var picker = h('input', { type: 'file', accept: 'image/*', multiple: 'multiple', style: 'display:none' });

    var addBtn = h('button', {
      class: 'add', type: 'button',
      onclick: function () { picker.click(); },
      html: '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M3 8.5A1.5 1.5 0 014.5 7h2.2l1.1-2h8.4l1.1 2h2.2A1.5 1.5 0 0121 8.5v9A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5z"/>' +
            '<circle cx="12" cy="12.5" r="3.2"/></svg><span>Add photo</span>',
    });

    function renderShots() {
      shots.innerHTML = '';
      state.photos.forEach(function (p, idx) {
        var tile = h('div', { class: 'shot' + (p.status === 'error' ? ' err' : '') });
        tile.appendChild(h('img', { src: p.preview, alt: 'Photo ' + (idx + 1) }));
        if (p.status === 'uploading') tile.appendChild(h('div', { class: 'veil', text: 'SENDING' }));
        if (p.status === 'error') tile.appendChild(h('div', { class: 'veil', text: 'RETRY' }));
        tile.appendChild(h('button', {
          class: 'x', type: 'button', 'aria-label': 'Remove photo ' + (idx + 1), text: '×',
          onclick: function () { state.photos.splice(idx, 1); renderShots(); tally(); relabelNext(); },
        }));
        if (p.status === 'error') {
          tile.addEventListener('click', function (e) {
            if (e.target.classList.contains('x')) return;
            upload(p);
          });
        }
        shots.appendChild(tile);
      });
      if (state.photos.length < MAX_PHOTOS) shots.appendChild(addBtn);
    }

    function tally() {
      var up = state.photos.filter(function (p) { return p.status === 'uploading'; }).length;
      var bad = state.photos.filter(function (p) { return p.status === 'error'; }).length;
      if (bad) upnote.textContent = bad + ' photo' + (bad === 1 ? '' : 's') + " didn't send. Tap it to try again.";
      else if (up) upnote.textContent = 'Sending ' + up + ' photo' + (up === 1 ? '' : 's') + '… you can keep going.';
      else if (state.photos.length) upnote.textContent = state.photos.length + ' photo' + (state.photos.length === 1 ? '' : 's') + ' ready.';
      else upnote.textContent = '';
    }

    function upload(p) {
      p.status = 'uploading'; renderShots(); tally();
      fetch(API + '/api/pq/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: SLUG, index: state.photos.indexOf(p), dataUrl: p.dataUrl }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok) { p.status = 'done'; p.url = d.url; p.sig = d.sig; p.dataUrl = null; }
          else { p.status = 'error'; }
        })
        .catch(function () { p.status = 'error'; })
        .finally(function () { renderShots(); tally(); });
    }

    picker.addEventListener('change', function () {
      var files = [].slice.call(picker.files || []);
      picker.value = '';
      s2err.textContent = '';
      var room = MAX_PHOTOS - state.photos.length;
      if (files.length > room) {
        s2err.textContent = 'We take up to ' + MAX_PHOTOS + ' photos. We will use the first ' + room + '.';
        files = files.slice(0, room);
      }
      files.forEach(function (f) {
        if (!/^image\//.test(f.type)) return;
        compress(f).then(function (dataUrl) {
          var p = { preview: dataUrl, dataUrl: dataUrl, status: 'pending' };
          state.photos.push(p);
          renderShots(); tally(); relabelNext();
          upload(p);                 // starts now, finishes while they answer
        }).catch(function () {
          s2err.textContent = "One photo couldn't be read. Try a different one.";
        });
      });
    });

    var promptList = h('ul', { class: 'prompts' });
    (cfg.photoPrompts || []).forEach(function (p) {
      promptList.appendChild(h('li', { html: '<b>' + escapeHtml(p.label) + '</b>' + (p.hint ? ': ' + escapeHtml(p.hint) : '') }));
    });

    var photosRequired = cfg.photosRequired !== false;

    var n2 = navRow('Back', 'Next', function () {
      var ready = state.photos.filter(function (p) { return p.status === 'done'; }).length;
      if (!state.photos.length) {
        if (photosRequired) {
          s2err.textContent = 'At least one photo, please. It is the whole point.';
          return;
        }
        go(2); // optional for this tenant: carry on without
        return;
      }
      if (!ready && state.photos.every(function (p) { return p.status === 'error'; })) {
        if (photosRequired) {
          s2err.textContent = 'None of the photos sent. Check your signal and tap one to retry.';
          return;
        }
        // Optional: do not trap someone on a bad connection. Drop the failed
        // photos and move on — the contractor still gets the answers.
        state.photos = [];
        renderShots(); tally();
      }
      go(2);
    });

    // Say so on the button when there is nothing attached yet, so "Next" does
    // not read as "you have to add one first".
    function relabelNext() {
      n2.next.textContent = (!photosRequired && !state.photos.length) ? 'Skip photos' : 'Next';
    }

    s2.appendChild(h('fieldset', {}, [
      h('legend', { text: 'Show us' }),
      h('p', { class: 'hint', text: photosRequired
        ? 'Three good photos beat a long description. Here is what helps most:'
        : 'Optional, but a few photos mean we show up knowing what to expect. What helps most:' }),
      promptList,
      shots, upnote,
    ]));
    s2.appendChild(picker);
    s2.appendChild(s2err);
    s2.appendChild(n2.row);
    relabelNext();
    stepsWrap.appendChild(s2);

    // ── Step 3 · the questions ───────────────────────────────────────────────
    var s3 = h('div', { class: 'step' });
    var s3err = errorLine();

    var qNodes = [];

    // A question may carry showIf: { jobType: [...] }. Without it the question
    // always shows, so tenants written before this behave exactly as before.
    function qVisible(q) {
      var c = q.showIf;
      if (!c || !c.jobType || !c.jobType.length) return true;
      return c.jobType.indexOf(state.jobType) !== -1;
    }

    function resetQuestion(node) {
      [].forEach.call(node.fs.querySelectorAll('input'), function (i) { i.checked = false; });
      [].forEach.call(node.fs.querySelectorAll('label.opt'), function (l) { l.classList.remove('sel'); });
      var ta = node.fs.querySelector('textarea');
      if (ta) ta.value = '';
      delete state.answers[node.q.id];
    }

    // Hidden questions are reset, so an answer given before the job type
    // changed never rides along in the payload.
    function applyConditions() {
      qNodes.forEach(function (n) {
        var vis = qVisible(n.q);
        if (!vis) resetQuestion(n);
        n.fs.style.display = vis ? '' : 'none';
      });
    }

    (cfg.questions || []).forEach(function (q) {
      var fs = h('fieldset');
      fs.appendChild(h('legend', { text: q.label + (q.required ? '' : ' (optional)') }));
      if (q.hint) fs.appendChild(h('p', { class: 'hint', text: q.hint }));

      if (q.type === 'single' || q.type === 'multi') {
        var wrap = h('div', { class: 'opts' + ((q.options || []).length > 4 && q.type === 'multi' ? ' grid' : '') });
        (q.options || []).forEach(function (o) {
          var input = h('input', {
            type: q.type === 'multi' ? 'checkbox' : 'radio',
            name: 'q_' + q.id, value: o,
          });
          var lab = h('label', { class: 'opt' }, [input, h('span', { text: o })]);
          input.addEventListener('change', function () {
            if (q.type === 'multi') {
              lab.classList.toggle('sel', input.checked);
              var got = state.answers[q.id] || [];
              if (input.checked) got = got.concat([o]);
              else got = got.filter(function (x) { return x !== o; });
              state.answers[q.id] = got;
            } else {
              [].forEach.call(wrap.children, function (x) { x.classList.remove('sel'); });
              lab.classList.add('sel');
              state.answers[q.id] = o;
            }
            s3err.textContent = '';
          });
          wrap.appendChild(lab);
        });
        fs.appendChild(wrap);
      } else {
        var ta = h('textarea', { 'aria-label': q.label, maxlength: '1200' });
        ta.addEventListener('input', function () { state.answers[q.id] = ta.value; });
        fs.appendChild(ta);
      }
      s3.appendChild(fs);
      qNodes.push({ q: q, fs: fs });
    });

    var n3 = navRow('Back', 'Next', function () {
      var missing = qNodes.filter(function (n) {
        if (!n.q.required || n.fs.style.display === 'none') return false;
        var v = state.answers[n.q.id];
        return v == null || v === '' || (Array.isArray(v) && !v.length);
      }).map(function (n) { return n.q; });
      if (missing.length) {
        s3err.textContent = 'Still need: ' + missing.map(function (q) { return q.label.replace(/\?$/, ''); }).join(', ') + '.';
        return;
      }
      go(3);
    });
    s3.appendChild(s3err);
    s3.appendChild(n3.row);
    stepsWrap.appendChild(s3);

    // ── Step 4 · contact ─────────────────────────────────────────────────────
    var s4 = h('div', { class: 'step' });
    var s4err = errorLine();
    var fName = h('input', { type: 'text', autocomplete: 'name', 'aria-label': 'Your name', placeholder: 'Jane Sandoval' });
    var fPhone = h('input', { type: 'tel', autocomplete: 'tel', 'aria-label': 'Phone', placeholder: '(541) 555-0134' });
    var fEmail = h('input', { type: 'email', autocomplete: 'email', 'aria-label': 'Email', placeholder: 'you@example.com' });
    var fAddr = h('input', { type: 'text', autocomplete: 'street-address', 'aria-label': 'Job address or town', placeholder: 'Street address, or just the town' });
    var hp = h('input', { type: 'text', class: 'hp', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });

    var n4 = navRow('Back', 'Send it', submit);

    s4.appendChild(h('fieldset', {}, [
      h('legend', { text: 'Who do we get back to?' }),
      h('p', { class: 'hint', text: 'A phone number gets you a faster answer than an email.' }),
      h('div', {}, [h('span', { class: 'qlabel', text: 'Name' }), fName]),
      h('div', { style: 'margin-top:12px' }, [
        h('div', { class: 'two' }, [
          h('div', {}, [h('span', { class: 'qlabel', text: 'Phone' }), fPhone]),
          h('div', {}, [h('span', { class: 'qlabel', text: 'Email' }), fEmail]),
        ]),
      ]),
      h('div', { style: 'margin-top:12px' }, [h('span', { class: 'qlabel', text: 'Where is the job?' }), fAddr]),
      hp,
    ]));
    s4.appendChild(s4err);
    s4.appendChild(n4.row);
    s4.appendChild(h('p', {
      class: 'fine',
      text: 'Your photos and answers go to ' + cfg.name + ' only. No account, no marketing list.',
    }));
    stepsWrap.appendChild(s4);

    // ── Step 5 · done ────────────────────────────────────────────────────────
    var s5 = h('div', { class: 'step' });
    var doneMsg = h('p');
    s5.appendChild(h('div', { class: 'done' }, [
      h('div', { class: 'tick', html: '<svg viewBox="0 0 24 24"><path d="M5 13l4.5 4.5L19 7"/></svg>' }),
      h('h3', { text: 'Sent.' }),
      doneMsg,
      h('p', { class: 'fine', text: 'A copy is on its way to your email if you gave us one.' }),
    ]));
    stepsWrap.appendChild(s5);

    function submit() {
      s4err.textContent = '';
      var name = fName.value.trim();
      var phone = fPhone.value.trim();
      var email = fEmail.value.trim();

      if (!name) { s4err.textContent = 'We need a name to put on the quote.'; fName.focus(); return; }

      var digits = phone.replace(/\D/g, '');
      var emailOk = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email);

      // Order matters. Someone who typed a number with a typo in it has
      // obviously tried to give us one — telling them "we need a phone or an
      // email" reads as if the field were blank, and they stare at it. Point at
      // the thing they actually got wrong first, and only fall back to the
      // generic message when both fields really are empty.
      if (email && !emailOk) { s4err.textContent = 'That email looks off. Mind checking it?'; fEmail.focus(); return; }
      if (phone && digits.length < 10) { s4err.textContent = 'That number looks short. We need the area code too.'; fPhone.focus(); return; }
      if (digits.length < 10 && !emailOk) {
        s4err.textContent = 'A phone number or an email, so we can reach you.';
        fPhone.focus();
        return;
      }

      var pending = state.photos.filter(function (p) { return p.status === 'uploading'; });
      if (pending.length) {
        s4err.textContent = 'Just finishing the photo upload. One moment.';
        n4.next.disabled = true;
        setTimeout(function () { n4.next.disabled = false; submit(); }, 1200);
        return;
      }

      n4.next.disabled = true;
      n4.next.textContent = 'Sending…';

      fetch(API + '/api/pq/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: SLUG,
          jobType: state.jobType,
          answers: state.answers,
          photos: state.photos.filter(function (p) { return p.status === 'done'; })
            .map(function (p) { return { url: p.url, sig: p.sig }; }),
          name: name, phone: phone, email: email, address: fAddr.value.trim(),
          _hp: hp.value, startedAt: startedAt,
          referrer: location.href,
        }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok) throw new Error((d && d.reason) || 'failed');
          var n = d.photoCount || 0;
          var photosWord = n + ' photo' + (n === 1 ? '' : 's');
          // Tenants can say what actually happens next. A painter still walks
          // the job; an appliance tech may just show up with the part. The
          // default is deliberately vague so it is never a false promise.
          doneMsg.textContent = cfg.doneNote
            ? cfg.doneNote.replace('{photos}', photosWord)
            : cfg.name + ' has your ' + photosWord + ' and your answers. Expect a reply within one business day.';
          step = 4; STEPS = 4;
          bars.forEach(function (el) { el.classList.add('on'); });
          [].forEach.call(stepsWrap.children, function (el, i) { el.classList.toggle('on', i === 4); });
          title.textContent = 'Thanks, that is everything we need.';
          sub.textContent = '';
          card.scrollIntoView({ block: 'start', behavior: 'smooth' });
          announceSent({ slug: SLUG, leadId: d.leadId || null, photoCount: n });
        })
        .catch(function () {
          s4err.textContent = "That didn't go through. Check your signal and tap Send it again.";
          n4.next.disabled = false;
          n4.next.textContent = 'Send it';
        });
    }

    renderShots();
    paint(false);
    return card;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Mount ──────────────────────────────────────────────────────────────────
  function mountInline(cfg) {
    var target = document.querySelector('[data-rcd-quote]') || document.getElementById('rcd-quote');
    if (!target) {
      target = document.createElement('div');
      if (SCRIPT && SCRIPT.parentNode) SCRIPT.parentNode.insertBefore(target, SCRIPT.nextSibling);
      else document.body.appendChild(target);
    }
    build(target, cfg, { sheet: false });
  }

  function mountButton(cfg) {
    var holder = document.querySelector('[data-rcd-quote]') || (function () {
      var d = document.createElement('div');
      if (SCRIPT && SCRIPT.parentNode) SCRIPT.parentNode.insertBefore(d, SCRIPT.nextSibling);
      else document.body.appendChild(d);
      return d;
    })();

    var shadow = holder.attachShadow ? holder.attachShadow({ mode: 'open' }) : holder;
    shadow.appendChild(h('style', { text: CSS }));
    var btn = h('button', { class: 'launch', type: 'button', text: LABEL });
    applyBrand(btn, cfg.brand || {});
    if (cfg.brand && cfg.brand.color) {
      btn.style.background = cfg.brand.color;
      btn.style.color = cfg.brand.text || '#fff';
    }
    shadow.appendChild(btn);

    btn.addEventListener('click', function () {
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000';
      document.body.appendChild(overlay);
      var prevOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';

      var oShadow = overlay.attachShadow({ mode: 'open' });
      oShadow.appendChild(h('style', { text: CSS }));

      function shut() {
        document.documentElement.style.overflow = prevOverflow;
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        btn.focus();
      }
      function onKey(e) { if (e.key === 'Escape') shut(); }
      document.addEventListener('keydown', onKey);

      var closeBar = h('div', { class: 'close' }, [
        h('button', { type: 'button', 'aria-label': 'Close', text: '×', onclick: shut }),
      ]);
      var inner = h('div', { class: 'sheetwrap' }, [closeBar]);
      var scrim = h('div', { class: 'scrim', onclick: function (e) { if (e.target === scrim) shut(); } }, [inner]);
      oShadow.appendChild(scrim);

      // build() mounts into its own shadow root, so give it a plain host div
      // inside the overlay. Nesting shadow roots is fine and keeps the sheet's
      // styles independent of the launch button's.
      var slot = document.createElement('div');
      inner.appendChild(slot);
      build(slot, cfg, { sheet: true });
    });
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  fetch(API + '/api/pq/config?slug=' + encodeURIComponent(SLUG))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.ok) throw new Error('config');
      if (MODE === 'button') mountButton(d.config);
      else mountInline(d.config);
    })
    .catch(function (e) {
      console.error('[rcd-quotes] could not load config for "' + SLUG + '"', e);
    });
})();
