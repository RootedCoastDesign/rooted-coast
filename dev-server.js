// dev-server.js — local test server for the Rooted Coast site.
//
// Emulates Vercel locally: serves the static .html/.css/.js/images from this
// folder AND runs the serverless functions in /api the same way Vercel does, so
// you can test the cart, the travel-fee calculator, and checkout before pushing.
//
//   USAGE:
//     node dev-server.js            # then open http://localhost:3000
//     PORT=4000 node dev-server.js  # use a different port
//
//   ENV (optional): create a file named ".env" next to this one, e.g.
//     STRIPE_SECRET_KEY=sk_test_...   # test-mode key for checkout (test card 4242 4242 4242 4242)
//     ORS_API_KEY=...                 # optional; the calculator works without it
//   Lines are KEY=VALUE, one per line. This file is only read locally and is
//   already covered by .gitignore patterns for .env — never commit real keys.
//
//   Requires Node 18+ (for global fetch, used by api/travel-quote.js).
//   No npm install needed for the calculator; checkout also needs `npm i stripe`.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;

// --- tiny .env loader (no dependency) ---
(function loadEnv() {
  try {
    const txt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    txt.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    });
    console.log('Loaded .env');
  } catch (e) { /* no .env, that's fine */ }
})();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain',
};

// Build a Vercel-style (req, res) pair around Node's raw objects.
function decorate(req, res, body, query) {
  req.body = body;
  req.query = query;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); return res; };
  res.send = (b) => { res.end(b); return res; };
}

async function handleApi(name, req, res, body, query) {
  const modPath = path.join(ROOT, 'api', name + '.js');
  if (!fs.existsSync(modPath)) { res.statusCode = 404; return res.end('No such function: ' + name); }
  decorate(req, res, body, query);
  try {
    delete require.cache[require.resolve(modPath)]; // pick up edits without restarting
    const handler = require(modPath);
    await handler(req, res);
  } catch (err) {
    console.error('api/' + name + ' error:', err && err.message);
    if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: String(err && err.message || err) })); }
  }
}

function serveStatic(urlPath, res) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  // prevent path traversal
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) { res.statusCode = 403; return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // pretty 404 page if present, else plain
      const notFound = path.join(ROOT, '404.html');
      if (fs.existsSync(notFound)) { res.statusCode = 404; res.setHeader('Content-Type', 'text/html'); return res.end(fs.readFileSync(notFound)); }
      res.statusCode = 404; return res.end('Not found: ' + rel);
    }
    res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const query = Object.fromEntries(u.searchParams.entries());

  if (u.pathname.startsWith('/api/')) {
    const name = u.pathname.slice('/api/'.length).replace(/\/+$/, '');
    if (req.method === 'GET' || req.method === 'OPTIONS') {
      return handleApi(name, req, res, {}, query);
    }
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (e) { body = {}; }
      handleApi(name, req, res, body, query);
    });
    return;
  }
  serveStatic(u.pathname, res);
});

server.listen(PORT, () => {
  console.log('Rooted Coast dev server running:  http://localhost:' + PORT);
  console.log('  Static pages + /api functions are live. Ctrl+C to stop.');
  console.log('  Travel calculator: needs internet (reaches OpenStreetMap). Checkout: needs STRIPE_SECRET_KEY + `npm i stripe`.');
});
