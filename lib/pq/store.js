// lib/pq/store.js
// ─────────────────────────────────────────────────────────────────────────────
// Where leads and photos live.
//
// TWO BACKENDS, ON PURPOSE:
//
//   Photos          → always Vercel Blob. Public URLs (unguessable random
//                     paths) so they render in an email client without auth.
//
//   Lead records    → Postgres if DATABASE_URL is set, otherwise a JSON file in
//                     Blob next to the photos.
//
// The Blob fallback means this ships and works the day you connect Blob, with
// no database at all. Add Postgres later and you get lead history, a per-client
// list, and a dashboard — without changing any calling code. Everything above
// this file only ever calls saveLead / getLead / listLeads / setStatus.
//
// Lead IDs are 24 hex characters from crypto.randomBytes. That is the only
// thing protecting a lead page, so they must stay random — never derive an ID
// from an email address, a counter, or a timestamp.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const crypto = require('crypto');
const { put, list, del } = require('@vercel/blob');

const HAS_PG = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);

let _sql = null;
function sql() {
  if (!HAS_PG) return null;
  if (!_sql) {
    const { neon } = require('@neondatabase/serverless');
    _sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  }
  return _sql;
}

function newId() {
  return crypto.randomBytes(12).toString('hex'); // 24 chars
}

// ── Schema ───────────────────────────────────────────────────────────────────
// Runs at most once per warm function instance. CREATE ... IF NOT EXISTS is
// cheap and idempotent, which beats making you remember to run a migration
// before the first lead of the day arrives.

let _schemaReady = null;
async function ensureSchema() {
  if (!HAS_PG) return;
  if (_schemaReady) return _schemaReady;
  const db = sql();
  _schemaReady = (async () => {
    await db`
      CREATE TABLE IF NOT EXISTS pq_leads (
        id          TEXT PRIMARY KEY,
        slug        TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        status      TEXT NOT NULL DEFAULT 'new',
        name        TEXT,
        phone       TEXT,
        email       TEXT,
        address     TEXT,
        job_type    TEXT,
        answers     JSONB,
        photos      JSONB,
        meta        JSONB
      )`;
    await db`CREATE INDEX IF NOT EXISTS pq_leads_slug_created ON pq_leads (slug, created_at DESC)`;
  })().catch((e) => {
    _schemaReady = null; // let the next request retry rather than wedging
    throw e;
  });
  return _schemaReady;
}

// ── Photos ───────────────────────────────────────────────────────────────────

const MAX_PHOTO_BYTES = 3 * 1024 * 1024; // after client-side compression
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

async function savePhoto(slug, leadId, index, buffer, contentType) {
  if (!ALLOWED_TYPES.has(contentType)) throw new Error('unsupported image type: ' + contentType);
  if (!buffer || buffer.length === 0) throw new Error('empty image');
  if (buffer.length > MAX_PHOTO_BYTES) throw new Error('image too large');

  const ext = contentType === 'image/png' ? 'png'
    : contentType === 'image/webp' ? 'webp'
    : contentType === 'image/heic' ? 'heic'
    : 'jpg';

  // addRandomSuffix keeps the URL unguessable even though leadId is already
  // random — a photo URL leaked in a forwarded email should not imply the
  // whole lead page.
  const blob = await put(`quotes/${slug}/${leadId}/photo-${index}.${ext}`, buffer, {
    access: 'public',
    contentType,
    addRandomSuffix: true,
    cacheControlMaxAge: 60 * 60 * 24 * 365,
  });

  return { url: blob.url, contentType, bytes: buffer.length };
}

// ── Leads ────────────────────────────────────────────────────────────────────

// Deterministic path so getLead can find the record without a database.
// addRandomSuffix is OFF here for exactly that reason; the 24-char leadId is
// the secret.
function leadPath(slug, id) {
  return `quotes/${slug}/${id}/lead.json`;
}

async function saveLead(lead) {
  const record = {
    id: lead.id,
    slug: lead.slug,
    createdAt: lead.createdAt || new Date().toISOString(),
    status: lead.status || 'new',
    name: lead.name || '',
    phone: lead.phone || '',
    email: lead.email || '',
    address: lead.address || '',
    jobType: lead.jobType || '',
    answers: lead.answers || {},
    photos: lead.photos || [],
    meta: lead.meta || {},
  };

  // Blob copy is always written: it is the backup when Postgres is down and
  // the only store when Postgres is absent.
  await put(leadPath(record.slug, record.id), JSON.stringify(record, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    cacheControlMaxAge: 0,
  });

  if (HAS_PG) {
    try {
      await ensureSchema();
      const db = sql();
      await db`
        INSERT INTO pq_leads (id, slug, created_at, status, name, phone, email, address, job_type, answers, photos, meta)
        VALUES (${record.id}, ${record.slug}, ${record.createdAt}, ${record.status},
                ${record.name}, ${record.phone}, ${record.email}, ${record.address}, ${record.jobType},
                ${JSON.stringify(record.answers)}, ${JSON.stringify(record.photos)}, ${JSON.stringify(record.meta)})
        ON CONFLICT (id) DO NOTHING`;
    } catch (e) {
      // A database hiccup must never lose a lead. The Blob write above already
      // succeeded, the email still goes out, and the lead page still resolves.
      console.error('[pq] postgres insert failed, blob copy stands:', e.message);
    }
  }

  return record;
}

async function getLead(slug, id) {
  if (!/^[0-9a-f]{24}$/.test(String(id || ''))) return null;

  if (HAS_PG) {
    try {
      await ensureSchema();
      const rows = await sql()`SELECT * FROM pq_leads WHERE id = ${id} AND slug = ${slug} LIMIT 1`;
      if (rows && rows[0]) {
        const r = rows[0];
        return {
          id: r.id, slug: r.slug,
          createdAt: new Date(r.created_at).toISOString(),
          status: r.status, name: r.name, phone: r.phone, email: r.email,
          address: r.address, jobType: r.job_type,
          answers: r.answers || {}, photos: r.photos || [], meta: r.meta || {},
        };
      }
    } catch (e) {
      console.error('[pq] postgres read failed, falling back to blob:', e.message);
    }
  }

  // Blob path. We do not know the store's public hostname, so list() by prefix
  // to recover the URL, then fetch it.
  try {
    const found = await list({ prefix: leadPath(slug, id), limit: 1 });
    const hit = found && found.blobs && found.blobs[0];
    if (!hit) return null;
    const r = await fetch(hit.url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.error('[pq] blob read failed:', e.message);
    return null;
  }
}

async function setStatus(slug, id, status) {
  const allowed = ['new', 'quoted', 'won', 'lost'];
  if (!allowed.includes(status)) throw new Error('bad status');

  const lead = await getLead(slug, id);
  if (!lead) return null;
  lead.status = status;

  await put(leadPath(slug, id), JSON.stringify(lead, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    cacheControlMaxAge: 0,
  });

  if (HAS_PG) {
    try {
      await ensureSchema();
      await sql()`UPDATE pq_leads SET status = ${status} WHERE id = ${id} AND slug = ${slug}`;
    } catch (e) {
      console.error('[pq] postgres status update failed:', e.message);
    }
  }
  return lead;
}

// Listing needs a real index, so this is Postgres-only. Without a database the
// contractor still gets every lead by email — they just cannot browse history.
async function listLeads(slug, limit = 50) {
  if (!HAS_PG) return { supported: false, leads: [] };
  await ensureSchema();
  const rows = await sql()`
    SELECT id, created_at, status, name, phone, email, address, job_type, photos
    FROM pq_leads WHERE slug = ${slug}
    ORDER BY created_at DESC LIMIT ${Math.min(Number(limit) || 50, 200)}`;
  return {
    supported: true,
    leads: (rows || []).map((r) => ({
      id: r.id,
      createdAt: new Date(r.created_at).toISOString(),
      status: r.status, name: r.name, phone: r.phone, email: r.email,
      address: r.address, jobType: r.job_type,
      photoCount: Array.isArray(r.photos) ? r.photos.length : 0,
    })),
  };
}

// ── Simple abuse throttle ────────────────────────────────────────────────────
// In-memory, per warm instance. Not a real rate limiter — it will not survive a
// cold start or coordinate across regions. It exists to blunt a script hammering
// one function instance. The honeypot field and the origin allowlist in
// tenants.js do the heavier lifting.

const _hits = new Map();
function throttle(key, maxPerHour = 8) {
  const now = Date.now();
  const cutoff = now - 3600e3;
  const arr = (_hits.get(key) || []).filter((t) => t > cutoff);
  if (arr.length >= maxPerHour) return false;
  arr.push(now);
  _hits.set(key, arr);
  if (_hits.size > 500) { // keep the map from growing forever on a warm instance
    for (const [k, v] of _hits) if (!v.some((t) => t > cutoff)) _hits.delete(k);
  }
  return true;
}

module.exports = {
  newId, savePhoto, saveLead, getLead, setStatus, listLeads, throttle,
  MAX_PHOTO_BYTES, HAS_PG,
};
