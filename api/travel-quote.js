// api/travel-quote.js
// Live one-way drive-time travel quote for On-Site Photography.
//
// The customer types a town or full address in the cart. This endpoint geocodes
// it and routes from Bandon, OR, then charges $50 per hour of one-way drive time
// (free within 45 driving miles of Bandon), rounded up to the nearest $5. The
// returned fee is HMAC-signed with the same key api/create-checkout.js uses to
// verify it, so the amount charged at checkout can't be tampered with.
//
// PROVIDERS — no account required by default:
//   • Geocoding + routing use OpenStreetMap's public services (Nominatim + OSRM),
//     which need NO API key. This is fine for the low volume of a photo-shoot
//     cart. If either public service is briefly unavailable, the cart falls back
//     to the flat-zone dropdown automatically.
//   • OPTIONAL upgrade: if you set an ORS_API_KEY environment variable
//     (free token from openrouteservice.org), this endpoint will prefer
//     OpenRouteService instead — more robust for higher volume. No code change
//     needed; it auto-detects the key.

const crypto = require('crypto');

// Bandon, OR (studio origin) — [longitude, latitude].
const ORIGIN = { lon: -124.4083, lat: 43.1190 };
const FREE_RADIUS_MILES = 45;
const RATE_PER_HOUR = 50;         // dollars per hour of one-way drive time
const METERS_PER_MILE = 1609.344;
const UA = 'RootedCoastDesign-travel-quote/1.0 (+https://www.rootedcoastdesign.com)';

const TRAVEL_SIGN_KEY = process.env.TRAVEL_SIGN_SECRET || process.env.STRIPE_SECRET_KEY || 'rcd-travel-fallback-key';

function sign(label, fee) {
  return crypto.createHmac('sha256', TRAVEL_SIGN_KEY).update(String(label) + '|' + fee).digest('hex');
}

async function fetchJson(url, headers, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || CALL_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: headers || {} });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}
// Per-call cap kept low so geocode + route (run back-to-back) finish well under
// Vercel's 10s function limit; if a public map server hangs, we fail fast to the
// cart's zone-dropdown fallback instead of timing out the whole request.
const CALL_TIMEOUT_MS = 4000;

// ── Geocode: address text → { lon, lat, label } ──
async function geocode(address) {
  const key = process.env.ORS_API_KEY;
  if (key) {
    // OpenRouteService (Pelias) — used only if a key is configured.
    const url = 'https://api.openrouteservice.org/geocode/search'
      + '?api_key=' + encodeURIComponent(key)
      + '&text=' + encodeURIComponent(address)
      + '&size=1&boundary.country=US'
      + '&focus.point.lon=' + ORIGIN.lon + '&focus.point.lat=' + ORIGIN.lat;
    const geo = await fetchJson(url, { Accept: 'application/geo+json' });
    const feat = geo && geo.features && geo.features[0];
    if (feat && feat.geometry && Array.isArray(feat.geometry.coordinates)) {
      const [lon, lat] = feat.geometry.coordinates;
      return { lon, lat, label: (feat.properties && feat.properties.label) || address };
    }
    return null;
  }
  // Default: OpenStreetMap Nominatim — no API key required.
  const url = 'https://nominatim.openstreetmap.org/search'
    + '?q=' + encodeURIComponent(address)
    + '&format=jsonv2&limit=1&countrycodes=us&addressdetails=0';
  const arr = await fetchJson(url, { 'User-Agent': UA, Accept: 'application/json' });
  const hit = Array.isArray(arr) && arr[0];
  if (hit && hit.lat && hit.lon) {
    return { lon: parseFloat(hit.lon), lat: parseFloat(hit.lat), label: hit.display_name || address };
  }
  return null;
}

// ── Route: origin → dest → { distanceMeters, durationSeconds } ──
async function route(destLon, destLat) {
  const key = process.env.ORS_API_KEY;
  if (key) {
    const url = 'https://api.openrouteservice.org/v2/directions/driving-car'
      + '?api_key=' + encodeURIComponent(key)
      + '&start=' + ORIGIN.lon + ',' + ORIGIN.lat
      + '&end=' + destLon + ',' + destLat;
    const r = await fetchJson(url, { Accept: 'application/geo+json' });
    const s = r && r.features && r.features[0] && r.features[0].properties && r.features[0].properties.summary;
    if (s && typeof s.distance === 'number' && typeof s.duration === 'number') {
      return { distanceMeters: s.distance, durationSeconds: s.duration };
    }
    return null;
  }
  // Default: public OSRM demo router — no API key required.
  const url = 'https://router.project-osrm.org/route/v1/driving/'
    + ORIGIN.lon + ',' + ORIGIN.lat + ';' + destLon + ',' + destLat
    + '?overview=false&alternatives=false&steps=false';
  const r = await fetchJson(url, { 'User-Agent': UA, Accept: 'application/json' });
  const rt = r && r.routes && r.routes[0];
  if (rt && typeof rt.distance === 'number' && typeof rt.duration === 'number') {
    return { distanceMeters: rt.distance, durationSeconds: rt.duration };
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method' });

  const body = req.body || {};
  let place;
  // Type-ahead path: the client already picked a suggestion, so we have exact
  // coordinates and can skip geocoding entirely.
  const lat = Number(body.lat), lon = Number(body.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
    const lbl = String(body.label || (lat.toFixed(4) + ', ' + lon.toFixed(4))).slice(0, 200);
    place = { lat: lat, lon: lon, label: lbl };
  } else {
    // Text path: geocode the typed address.
    let address = String(body.address || '').trim();
    if (!address || address.length > 200) {
      return res.status(200).json({ ok: false, reason: 'invalid' });
    }
    place = await geocode(address);
    if (!place) return res.status(200).json({ ok: false, reason: 'notfound' });
  }

  const legs = await route(place.lon, place.lat);
  if (!legs) return res.status(200).json({ ok: false, reason: 'noroute' });

  const miles = legs.distanceMeters / METERS_PER_MILE;
  const minutes = Math.round(legs.durationSeconds / 60);

  let fee = 0;
  if (miles > FREE_RADIUS_MILES) {
    const hours = legs.durationSeconds / 3600;
    fee = Math.ceil((hours * RATE_PER_HOUR) / 5) * 5; // nearest $5, rounded up
    if (fee > 600) fee = 600; // sanity cap; anything larger is quoted by hand
  }

  return res.status(200).json({
    ok: true,
    label: place.label,
    miles: Math.round(miles),
    minutes: minutes,
    fee: fee,
    sig: sign(place.label, fee),
  });
};
