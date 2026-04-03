import 'dotenv/config';
import express from 'express';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'planner.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    address TEXT,
    lat REAL,
    lng REAL,
    image_url TEXT,
    link_url TEXT,
    category TEXT NOT NULL DEFAULT 'attraction',
    timing TEXT,
    david_note TEXT,
    jen_note TEXT,
    david_approved INTEGER NOT NULL DEFAULT 0,
    jen_approved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS itinerary_cache (
    cache_key TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS itineraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version INTEGER NOT NULL DEFAULT 1,
    name TEXT,
    card_ids TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'v1',
    optimization TEXT,
    phase TEXT NOT NULL DEFAULT 'draft',
    proposal_json TEXT,
    final_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS itinerary_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    itinerary_id INTEGER NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
    day_number INTEGER NOT NULL,
    date TEXT,
    title TEXT,
    hotel_id INTEGER,
    stops_json TEXT NOT NULL DEFAULT '[]',
    legs_json TEXT,
    enrichment_md TEXT,
    enrichment_status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS flights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL,
    airline TEXT,
    flight_number TEXT,
    departure_airport TEXT,
    arrival_airport TEXT,
    departure_time TEXT,
    arrival_time TEXT,
    departure_tz TEXT,
    arrival_tz TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migrations
try { db.exec('ALTER TABLE cards ADD COLUMN address TEXT'); } catch {}
try { db.exec('ALTER TABLE cards ADD COLUMN lat REAL'); } catch {}
try { db.exec('ALTER TABLE cards ADD COLUMN lng REAL'); } catch {}
try { db.exec('ALTER TABLE itinerary_days ADD COLUMN hotel_id INTEGER'); } catch {}
try { db.exec('ALTER TABLE itinerary_days ADD COLUMN pacing TEXT'); } catch {}
try { db.exec('ALTER TABLE itinerary_days ADD COLUMN summary TEXT'); } catch {}
try { db.exec('ALTER TABLE cards ADD COLUMN place_id TEXT'); } catch {}
try { db.exec('ALTER TABLE cards ADD COLUMN opening_hours TEXT'); } catch {}
try { db.exec('ALTER TABLE cards ADD COLUMN price_level INTEGER'); } catch {}
try { db.exec('ALTER TABLE cards ADD COLUMN business_status TEXT'); } catch {}
try { db.exec('ALTER TABLE cards ADD COLUMN rating REAL'); } catch {}
try { db.exec('ALTER TABLE itineraries ADD COLUMN mode TEXT NOT NULL DEFAULT \'v1\''); } catch {}


const app = express();
app.use(express.json());

// --- Trip settings ---

app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
  }
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(req.body)) {
    stmt.run(key, JSON.stringify(value));
  }
  res.json({ ok: true });
});

// --- Cards CRUD ---

app.get('/api/cards', (req, res) => {
  const { category, approved } = req.query;
  let sql = 'SELECT * FROM cards';
  const conditions = [];
  const params = [];

  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }
  if (approved === 'both') {
    conditions.push('david_approved = 1 AND jen_approved = 1');
  } else if (approved === 'any') {
    conditions.push('(david_approved = 1 OR jen_approved = 1)');
  }

  if (conditions.length) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY created_at DESC';

  res.json(db.prepare(sql).all(...params));
});

app.post('/api/cards', async (req, res) => {
  let { title, description, address, lat, lng, image_url, link_url, category, timing,
    david_note, jen_note, david_approved, jen_approved,
    rating, opening_hours, price_level, place_id } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  // If no place_id, verify against Google Places and enrich
  if (!place_id && GOOGLE_MAPS_API_KEY) {
    const place = await enrichPlace(title) || await autocompletePlaceSearch(title);
    if (place) {
      place_id = place.place_id || place_id;
      if (!lat && place.lat) lat = place.lat;
      if (!lng && place.lng) lng = place.lng;
      if (!image_url && place.image_url) image_url = place.image_url;
      if (!address && place.address) address = place.address;
      if (!rating && place.rating) rating = place.rating;
      if (!opening_hours && place.opening_hours) opening_hours = place.opening_hours;
      if (price_level == null && place.price_level != null) price_level = place.price_level;
      if (!link_url && place.website) link_url = place.website;
    }
  }

  const stmt = db.prepare(`
    INSERT INTO cards (title, description, address, lat, lng, image_url, link_url, category, timing,
      david_note, jen_note, david_approved, jen_approved,
      rating, opening_hours, price_level, place_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    title,
    description || null,
    address || null,
    lat || null,
    lng || null,
    image_url || null,
    link_url || null,
    category || 'attraction',
    timing || null,
    david_note || null,
    jen_note || null,
    david_approved ? 1 : 0,
    jen_approved ? 1 : 0,
    rating || null,
    opening_hours || null,
    price_level ?? null,
    place_id || null
  );
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(card);

  // Auto-generate description in background if none provided
  if (!description && title) {
    (async () => {
      try {
        const prompt = `Write a concise 1-2 sentence description of "${title}"${address ? ` (${address})` : ''} in Japan for a trip planning board. Category: ${category || 'attraction'}. Be vivid and practical — what makes it worth visiting. No markdown, just plain text.`;
        const desc = await callLLM([
          { role: 'system', content: 'You are a concise Japan travel expert. Respond with only the description, nothing else.' },
          { role: 'user', content: prompt },
        ], 120);
        if (desc) {
          db.prepare("UPDATE cards SET description = ?, updated_at = datetime('now') WHERE id = ?").run(desc, card.id);
        }
      } catch {}
    })();
  }
});

app.patch('/api/cards/:id', (req, res) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'not found' });

  const allowed = [
    'title', 'description', 'address', 'lat', 'lng', 'image_url', 'link_url',
    'category', 'timing', 'david_note', 'jen_note',
    'david_approved', 'jen_approved'
  ];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(req.body[key]);
    }
  }
  if (!sets.length) return res.json(card);

  sets.push("updated_at = datetime('now')");
  params.push(req.params.id);

  db.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id));
});

app.delete('/api/cards/:id', (req, res) => {
  const info = db.prepare('DELETE FROM cards WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: true });
});

app.post('/api/cards/:id/approve', (req, res) => {
  const { person } = req.body;
  if (!['david', 'jen'].includes(person)) {
    return res.status(400).json({ error: 'person must be "david" or "jen"' });
  }
  const col = `${person}_approved`;
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'not found' });

  const newVal = card[col] ? 0 : 1;
  db.prepare(`UPDATE cards SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`).run(newVal, req.params.id);
  res.json(db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id));
});

// --- Google Maps helpers ---

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

async function geocode(query) {
  if (!GOOGLE_MAPS_API_KEY || !query) return null;
  try {
    const params = new URLSearchParams({
      address: query,
      key: GOOGLE_MAPS_API_KEY,
      region: 'jp',
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    const loc = data.results?.[0]?.geometry?.location;
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  } catch { return null; }
}

async function geocodeCard(card) {
  if (card.lat && card.lng) return;
  const query = card.address || `${card.title} Japan`;
  const loc = await geocode(query);
  if (loc) {
    db.prepare('UPDATE cards SET lat = ?, lng = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(loc.lat, loc.lng, card.id);
  }
}

// Enrich a card with Google Places data (opening hours, price level, place_id)
async function enrichCardPlaceData(card) {
  if (card.place_id && card.opening_hours) return; // Already enriched
  try {
    let region = '';
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'destination'").get();
      region = row ? JSON.parse(row.value) : '';
    } catch {}
    const query = `${card.title}${card.address ? ' ' + card.address : (region ? ' ' + region : '')}`;
    const place = await searchPlace(query, region);
    if (!place?.place_id) return;

    const details = await placeDetails(place.place_id);
    if (!details) return;

    const updates = { place_id: place.place_id };
    if (details.opening_hours?.weekday_text) {
      updates.opening_hours = JSON.stringify(details.opening_hours);
    }
    if (details.price_level !== undefined) {
      updates.price_level = details.price_level;
    }
    if (details.business_status) {
      updates.business_status = details.business_status;
    }

    const sets = Object.keys(updates).map(k => `${k} = ?`);
    sets.push("updated_at = datetime('now')");
    const vals = Object.values(updates);
    vals.push(card.id);
    db.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  } catch {}
}

// Google Maps Directions API (returns polylines + duration/distance)
async function fetchDirections(origin, destination) {
  if (!GOOGLE_MAPS_API_KEY) return { duration: 'unknown', distance: 'unknown', polyline: null };

  async function tryMode(mode) {
    const params = new URLSearchParams({
      origin, destination, mode,
      key: GOOGLE_MAPS_API_KEY,
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'OK') return null;
    const route = data.routes?.[0];
    const leg = route?.legs?.[0];
    if (!leg) return null;
    return {
      duration: leg.duration?.text || 'unknown',
      duration_value: leg.duration?.value || 0,
      distance: leg.distance?.text || 'unknown',
      polyline: route.overview_polyline?.points || null,
      mode,
      status: data.status,
    };
  }

  try {
    // Try walking first — only use it if under 30 mins
    const walking = await tryMode('walking');
    if (walking && walking.duration_value <= 1800) return walking;

    // Use driving for route polyline (transit Directions API not available on this key)
    // Driving gives real road routes which closely follow transit paths in cities
    const driving = await tryMode('driving');
    if (driving) return driving;

    // Fall back to walking if driving also fails
    if (walking) return walking;
  } catch {}
  return { duration: 'unknown', distance: 'unknown', polyline: null };
}

async function getDirections(origins, destinations, mode = 'transit') {
  if (!GOOGLE_MAPS_API_KEY) return null;
  try {
    const params = new URLSearchParams({
      origins: origins.join('|'),
      destinations: destinations.join('|'),
      mode,
      key: GOOGLE_MAPS_API_KEY,
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// Geocode backfill endpoint
app.post('/api/cards/geocode', async (req, res) => {
  const cards = db.prepare('SELECT * FROM cards WHERE lat IS NULL OR lng IS NULL').all();
  let updated = 0;
  for (const card of cards) {
    await geocodeCard(card);
    updated++;
  }
  res.json({ geocoded: updated });
});

// Directions between a list of places (now uses Directions API for polylines)
app.post('/api/directions', async (req, res) => {
  const { waypoints } = req.body; // [{ lat, lng }, ...]
  if (!waypoints?.length || waypoints.length < 2) {
    return res.status(400).json({ error: 'need at least 2 waypoints' });
  }

  const legs = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const origin = `${waypoints[i].lat},${waypoints[i].lng}`;
    const dest = `${waypoints[i + 1].lat},${waypoints[i + 1].lng}`;
    const result = await fetchDirections(origin, dest);
    legs.push({
      from: waypoints[i],
      to: waypoints[i + 1],
      ...result,
    });
  }

  res.json({ legs });
});

// --- Robust JSON parser for LLM output ---

// Fix Python-style single-quoted dicts to valid JSON
function fixQuotes(str) {
  let out = '';
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const prev = str[i - 1];
    if (ch === '"' && prev !== '\\' && !inSingle) {
      inDouble = !inDouble;
      out += ch;
    } else if (ch === "'" && prev !== '\\' && !inDouble) {
      if (!inSingle) {
        inSingle = true;
        out += '"';
      } else {
        inSingle = false;
        out += '"';
      }
    } else {
      out += ch;
    }
  }
  return out;
}

function robustParseIdeas(raw) {
  // Try direct parse first
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') return parsed;
    return unwrapIdeas(parsed);
  } catch {}

  // Try fixing single quotes then parse
  try {
    const fixed = fixQuotes(raw);
    const parsed = JSON.parse(fixed);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') return parsed;
    return unwrapIdeas(parsed);
  } catch {}

  // Last resort: extract individual objects with regex (handles both quote styles)
  const objects = [];
  const objRegex = /\{[^{}]*(?:"|')title(?:"|')\s*:\s*(?:"|')[^"']*(?:"|')[^{}]*\}/g;
  let match;
  while ((match = objRegex.exec(raw)) !== null) {
    try {
      objects.push(JSON.parse(match[0]));
    } catch {
      try {
        objects.push(JSON.parse(fixQuotes(match[0])));
      } catch {}
    }
  }
  return objects;
}

function unwrapIdeas(val) {
  if (!Array.isArray(val)) return [];
  const results = [];
  for (const item of val) {
    if (typeof item === 'object' && item !== null && item.title) {
      results.push(item);
    } else if (typeof item === 'string') {
      // Try parse as-is, then with fixed quotes
      for (const attempt of [item, fixQuotes(item)]) {
        try {
          const parsed = JSON.parse(attempt);
          if (Array.isArray(parsed)) {
            results.push(...unwrapIdeas(parsed));
          } else if (typeof parsed === 'object' && parsed?.title) {
            results.push(parsed);
          }
          break;
        } catch {}
      }
    }
  }
  return results;
}

// --- Google Places search + photos ---

// Autocomplete search — more forgiving than findplacefromtext
async function autocompletePlaceSearch(query) {
  if (!GOOGLE_MAPS_API_KEY || !query) return null;
  try {
    const acParams = new URLSearchParams({
      input: query,
      key: GOOGLE_MAPS_API_KEY,
      language: 'en',
    });
    const acRes = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?${acParams}`);
    if (!acRes.ok) return null;
    const acData = await acRes.json();
    const prediction = acData.predictions?.[0];
    if (!prediction) return null;

    const detail = await placeDetails(prediction.place_id);
    if (!detail) return null;
    const photo = detail.photos?.[0]?.photo_reference;
    return {
      name: detail.name,
      place_id: prediction.place_id,
      address: detail.formatted_address,
      lat: detail.geometry?.location?.lat,
      lng: detail.geometry?.location?.lng,
      types: detail.types || [],
      website: detail.website || '',
      rating: detail.rating,
      summary: detail.editorial_summary?.overview || '',
      image_url: photo ? `/api/places/photo?ref=${photo}` : '',
      opening_hours: detail.opening_hours ? JSON.stringify(detail.opening_hours) : null,
      price_level: detail.price_level ?? null,
    };
  } catch { return null; }
}

async function searchPlace(query, region) {
  if (!GOOGLE_MAPS_API_KEY) return null;
  try {
    // Location bias: prefer coords for precision, fall back to broad rectangle
    let locationBias = 'rectangle:24.0,122.0|46.0,154.0';
    if (region) {
      const coordMatch = region.match?.(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
      if (coordMatch) {
        locationBias = `circle:20000@${coordMatch[1]},${coordMatch[2]}`;
      }
    }
    const params = new URLSearchParams({
      input: query,
      inputtype: 'textquery',
      fields: 'place_id,name,formatted_address,geometry,photos,types,website,rating',
      key: GOOGLE_MAPS_API_KEY,
      locationbias: locationBias,
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.candidates?.[0] || null;
  } catch { return null; }
}

async function placeDetails(placeId) {
  if (!GOOGLE_MAPS_API_KEY || !placeId) return null;
  try {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: 'name,formatted_address,geometry,photos,types,website,rating,editorial_summary,url,opening_hours,price_level,business_status',
      key: GOOGLE_MAPS_API_KEY,
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.result || null;
  } catch { return null; }
}

function placePhotoUrl(photoRef, maxWidth = 600) {
  if (!photoRef || !GOOGLE_MAPS_API_KEY) return '';
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoRef}&key=${GOOGLE_MAPS_API_KEY}`;
}

// Place autocomplete search
app.get('/api/places/search', async (req, res) => {
  const { q } = req.query;
  if (!q || !GOOGLE_MAPS_API_KEY) return res.json({ results: [] });

  try {
    // Step 1: Autocomplete
    const acParams = new URLSearchParams({
      input: q,
      key: GOOGLE_MAPS_API_KEY,
      language: 'en',
    });
    const acRes = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?${acParams}`);
    if (!acRes.ok) return res.json({ results: [] });
    const acData = await acRes.json();
    const predictions = (acData.predictions || []).slice(0, 5);
    if (!predictions.length) return res.json({ results: [] });

    // Step 2: Fetch details for each prediction
    const results = [];
    for (const p of predictions) {
      try {
        const detail = await placeDetails(p.place_id);
        if (!detail) {
          // Fallback: use prediction data without details
          results.push({
            place_id: p.place_id,
            name: p.structured_formatting?.main_text || p.description?.split(',')[0] || q,
            address: p.description || '',
            lat: null, lng: null,
            types: p.types || [],
            website: '', rating: null, summary: '',
            image_url: '',
          });
          continue;
        }
        const photo = detail.photos?.[0]?.photo_reference;
        results.push({
          place_id: p.place_id,
          name: detail.name || p.structured_formatting?.main_text,
          address: detail.formatted_address || p.description,
          lat: detail.geometry?.location?.lat || null,
          lng: detail.geometry?.location?.lng || null,
          types: detail.types || p.types || [],
          website: detail.website || detail.url || '',
          rating: detail.rating || null,
          summary: detail.editorial_summary?.overview || '',
          image_url: photo ? `/api/places/photo?ref=${photo}` : '',
        });
      } catch {
        results.push({
          place_id: p.place_id,
          name: p.structured_formatting?.main_text || q,
          address: p.description || '',
          lat: null, lng: null, types: p.types || [],
          website: '', rating: null, summary: '', image_url: '',
        });
      }
    }

    res.json({ results });
  } catch (err) {
    console.error('Places search error:', err.message);
    res.json({ results: [] });
  }
});

// Place details by place_id
app.get('/api/places/detail', async (req, res) => {
  const { place_id } = req.query;
  if (!place_id || !GOOGLE_MAPS_API_KEY) return res.status(400).json({ error: 'place_id required' });
  try {
    const detail = await placeDetails(place_id);
    if (!detail) return res.status(404).json({ error: 'not found' });
    const photo = detail.photos?.[0]?.photo_reference;
    res.json({
      name: detail.name,
      place_id: detail.place_id || place_id,
      address: detail.formatted_address,
      lat: detail.geometry?.location?.lat,
      lng: detail.geometry?.location?.lng,
      types: detail.types || [],
      website: detail.website || detail.url || '',
      rating: detail.rating || null,
      summary: detail.editorial_summary?.overview || '',
      image_url: photo ? `/api/places/photo?ref=${photo}` : '',
      opening_hours: detail.opening_hours ? JSON.stringify(detail.opening_hours) : null,
      price_level: detail.price_level ?? null,
    });
  } catch {
    res.status(500).json({ error: 'failed to fetch details' });
  }
});

// Photo proxy (Google requires API key in URL)
app.get('/api/places/photo', async (req, res) => {
  const { ref } = req.query;
  if (!ref || !GOOGLE_MAPS_API_KEY) return res.status(400).send('missing ref');
  try {
    const url = placePhotoUrl(ref, 800);
    const upstream = await fetch(url, { redirect: 'follow' });
    if (!upstream.ok) return res.status(502).send('photo fetch failed');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch {
    res.status(502).send('photo fetch failed');
  }
});

// Enrich a place by name — returns full details for LLM context
// region: optional location hint — can be "lat,lng" coords or city name. Defaults to settings.destination.
async function enrichPlace(title, region) {
  if (!region) {
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'destination'").get();
      region = row ? JSON.parse(row.value) : '';
    } catch { region = ''; }
  }
  const isCoords = /^-?\d+\.?\d*,\s*-?\d+\.?\d*$/.test(region);
  let searchCity = '';
  if (isCoords) {
    const [lat, lng] = region.split(',').map(Number);
    searchCity = nearestCity(lat, lng);
  } else if (region) {
    searchCity = region;
  }

  // Try multiple search variants — LLM names are often too verbose for Google
  const cleanTitle = title.replace(/\s*\(.*?\)\s*/g, '').trim(); // strip parenthetical
  const shortTitle = cleanTitle.split(/\s+/).slice(0, 3).join(' '); // first 3 words
  const queries = [
    `${title}${searchCity ? ' ' + searchCity : ''}`,
    cleanTitle !== title ? `${cleanTitle}${searchCity ? ' ' + searchCity : ''}` : null,
    shortTitle !== cleanTitle ? `${shortTitle}${searchCity ? ' ' + searchCity : ''}` : null,
  ].filter(Boolean);

  let place = null;
  for (const q of queries) {
    place = await searchPlace(q, region);
    if (place) break;
  }
  if (!place) return null;

  const detail = await placeDetails(place.place_id);
  if (!detail) return null;
  const photo = detail.photos?.[0]?.photo_reference;
  return {
    name: detail.name,
    place_id: detail.place_id || place.place_id,
    address: detail.formatted_address,
    lat: detail.geometry?.location?.lat,
    lng: detail.geometry?.location?.lng,
    types: detail.types || [],
    website: detail.website || '',
    rating: detail.rating,
    summary: detail.editorial_summary?.overview || '',
    image_url: photo ? `/api/places/photo?ref=${photo}` : '',
    opening_hours: detail.opening_hours ? JSON.stringify(detail.opening_hours) : null,
    price_level: detail.price_level ?? null,
  };
}

// --- Tavily web search ---

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

async function tavilySearch(query, maxResults = 3) {
  if (!TAVILY_API_KEY) return '';
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        max_results: maxResults,
        include_raw_content: true,
        search_depth: 'basic',
      }),
    });
    if (!res.ok) return '';
    const data = await res.json();
    // Combine raw content from top results, truncated to keep context reasonable
    return (data.results || [])
      .map(r => `[${r.title}]\n${(r.raw_content || r.content || '').slice(0, 1500)}`)
      .join('\n\n---\n\n');
  } catch { return ''; }
}

// --- LLM + Image helpers ---

const LM_STUDIO_URL = process.env.LM_STUDIO_URL || 'http://localhost:1234';
const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL || '';
const LM_STUDIO_API_KEY = process.env.LM_STUDIO_API_KEY || '';

async function callLLM(messages, maxTokens = 4096) {
  const headers = { 'Content-Type': 'application/json' };
  if (LM_STUDIO_API_KEY) headers['Authorization'] = `Bearer ${LM_STUDIO_API_KEY}`;

  // Suppress thinking with empty think tags
  const patched = [
    ...messages,
    { role: 'assistant', content: '<think>\n</think>\n', prefix: true },
  ];

  const body = {
    messages: patched,
    stream: false,
    max_tokens: maxTokens,
  };
  if (LM_STUDIO_MODEL) body.model = LM_STUDIO_MODEL;

  const res = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM error: ${res.status}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  const text = msg?.content?.trim() || '';
  // Strip any <think>...</think> blocks
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

async function findCommonsImage(query) {
  try {
    const params = new URLSearchParams({
      action: 'query', generator: 'search', gsrsearch: `${query} Japan`,
      gsrlimit: '8', gsrnamespace: '6', prop: 'imageinfo',
      iiprop: 'url|mime', iiurlwidth: '600', format: 'json', origin: '*',
    });
    const res = await fetch(`${COMMONS_API}?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    for (const page of Object.values(data.query?.pages || {})) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      if (!info.mime?.startsWith('image/') || info.mime === 'image/svg+xml') continue;
      return info.thumburl || info.url || null;
    }
    return null;
  } catch { return null; }
}

// --- Description generation ---

app.post('/api/cards/describe', async (req, res) => {
  const { title, category, address } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  // Get Google Places data + Tavily in parallel
  const [place, webContext] = await Promise.all([
    enrichPlace(title),
    tavilySearch(`${title} Japan travel guide`),
  ]);

  let context = '';
  if (place) {
    context += `\nGOOGLE PLACES: ${place.name}, ${place.address}. Rating: ${place.rating || 'N/A'}.`;
    if (place.summary) context += ` "${place.summary}"`;
  }
  if (webContext) context += `\n\nWEB RESEARCH:\n${webContext}`;

  const prompt = `Write a concise 1-2 sentence description of "${title}"${address ? ` (${address})` : ''} in Japan for a trip planning board. Category: ${category || 'attraction'}. Be vivid and practical — what makes it worth visiting. No markdown, just plain text.${context}`;

  try {
    const description = await callLLM([
      { role: 'system', content: 'You are a concise Japan travel expert. Use the research provided to write an accurate, current description. Respond with only the description, nothing else.' },
      { role: 'user', content: prompt },
    ], 120);
    res.json({ description, place });
  } catch {
    res.status(502).json({ error: 'LLM unavailable' });
  }
});

// --- Image backfill ---

app.post('/api/cards/backfill-images', async (req, res) => {
  const cards = db.prepare("SELECT * FROM cards WHERE image_url IS NULL OR image_url = ''").all();
  const results = [];
  const errors = [];

  for (const card of cards) {
    try {
      // Try enrichPlace first (findplacefromtext), then autocomplete, then simplified name
      let place = await enrichPlace(card.title);
      if (!place || !place.image_url) {
        place = await autocompletePlaceSearch(card.title);
      }
      if (!place || !place.image_url) {
        // Try simplified: strip parenthetical, take first 3-4 words
        const clean = card.title.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*[:–—].*/, '').trim();
        const short = clean.split(/\s+/).slice(0, 4).join(' ');
        if (short !== card.title) {
          place = await autocompletePlaceSearch(short);
        }
      }
      if (!place || !place.image_url) {
        // Last resort: use address if available
        if (card.address) {
          place = await autocompletePlaceSearch(card.address);
        }
      }
      if (!place || !place.image_url) {
        errors.push({ id: card.id, title: card.title, reason: 'no photo found' });
        continue;
      }

      // Update image_url and any other missing fields
      const updates = { image_url: place.image_url };
      if (!card.place_id && place.place_id) updates.place_id = place.place_id;
      if (!card.lat && place.lat) updates.lat = place.lat;
      if (!card.lng && place.lng) updates.lng = place.lng;
      if (!card.rating && place.rating) updates.rating = place.rating;
      if (!card.opening_hours && place.opening_hours) updates.opening_hours = place.opening_hours;
      if (card.price_level == null && place.price_level != null) updates.price_level = place.price_level;

      const sets = Object.keys(updates).map(k => `${k} = ?`);
      sets.push("updated_at = datetime('now')");
      const vals = Object.values(updates);
      vals.push(card.id);
      db.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

      results.push({ id: card.id, title: card.title, image_url: place.image_url });
    } catch (err) {
      errors.push({ id: card.id, title: card.title, reason: err.message });
    }
  }

  res.json({ backfilled: results.length, total: cards.length, results, errors });
});

// --- Backfill Google Places data (opening hours, price level) ---

app.post('/api/cards/backfill-hours', async (req, res) => {
  const cards = db.prepare("SELECT * FROM cards WHERE opening_hours IS NULL AND title IS NOT NULL").all();
  const results = [];

  for (const card of cards) {
    try {
      await enrichCardPlaceData(card);
      const updated = db.prepare('SELECT place_id, opening_hours, price_level FROM cards WHERE id = ?').get(card.id);
      if (updated?.opening_hours) {
        results.push({ id: card.id, title: card.title, price_level: updated.price_level });
      }
    } catch {}
  }

  res.json({ backfilled: results.length, total: cards.length, results });
});

// --- Backfill ratings + missing fields from Google Places ---

app.post('/api/cards/backfill-ratings', async (req, res) => {
  const cards = db.prepare("SELECT * FROM cards WHERE rating IS NULL AND title IS NOT NULL").all();
  const results = [];
  const errors = [];

  for (const card of cards) {
    try {
      let detail = null;
      if (card.place_id) {
        detail = await placeDetails(card.place_id);
      }
      if (!detail) {
        const place = await enrichPlace(card.title) || await autocompletePlaceSearch(card.title);
        if (place) {
          detail = place;
          if (!card.place_id && place.place_id) {
            db.prepare("UPDATE cards SET place_id = ? WHERE id = ?").run(place.place_id, card.id);
          }
        }
      }
      if (!detail || !detail.rating) {
        errors.push({ id: card.id, title: card.title });
        continue;
      }

      const updates = {};
      if (detail.rating) updates.rating = detail.rating;
      if (!card.opening_hours && (detail.opening_hours || detail.opening_hours_json)) {
        updates.opening_hours = typeof detail.opening_hours === 'string' ? detail.opening_hours : JSON.stringify(detail.opening_hours);
      }
      if (card.price_level == null && detail.price_level != null) updates.price_level = detail.price_level;
      if (!card.link_url && (detail.website || detail.url)) updates.link_url = detail.website || detail.url;
      if (!card.image_url && detail.image_url) updates.image_url = detail.image_url;

      const sets = Object.keys(updates).map(k => `${k} = ?`);
      if (!sets.length) { errors.push({ id: card.id, title: card.title }); continue; }
      sets.push("updated_at = datetime('now')");
      db.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?`).run(...Object.values(updates), card.id);
      results.push({ id: card.id, title: card.title, rating: updates.rating });
    } catch (err) {
      errors.push({ id: card.id, title: card.title });
    }
  }

  res.json({ backfilled: results.length, total: cards.length, errors: errors.length, results });
});

// --- Backfill websites from Google Places ---

app.post('/api/cards/backfill-websites', async (req, res) => {
  const cards = db.prepare("SELECT * FROM cards WHERE (link_url IS NULL OR link_url = '') AND place_id IS NOT NULL").all();
  const results = [];

  for (const card of cards) {
    try {
      const detail = await placeDetails(card.place_id);
      const website = detail?.website || detail?.url || '';
      if (website) {
        db.prepare("UPDATE cards SET link_url = ?, updated_at = datetime('now') WHERE id = ?").run(website, card.id);
        results.push({ id: card.id, title: card.title, link_url: website });
      }
    } catch {}
  }

  // Also try cards without place_id
  const noPlaceId = db.prepare("SELECT * FROM cards WHERE (link_url IS NULL OR link_url = '') AND (place_id IS NULL OR place_id = '')").all();
  for (const card of noPlaceId) {
    try {
      const place = await enrichPlace(card.title) || await autocompletePlaceSearch(card.title);
      if (place?.website) {
        const updates = { link_url: place.website };
        if (!card.place_id && place.place_id) updates.place_id = place.place_id;
        const sets = Object.keys(updates).map(k => `${k} = ?`);
        sets.push("updated_at = datetime('now')");
        db.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?`).run(...Object.values(updates), card.id);
        results.push({ id: card.id, title: card.title, link_url: place.website });
      }
    } catch {}
  }

  res.json({ backfilled: results.length, total: cards.length + noPlaceId.length, results });
});

// --- Generate ideas via LLM ---

app.post('/api/cards/generate', async (req, res) => {
  const { destination, dateFrom, dateTo, adults, children, prompt, nearLat, nearLng, nearName } = req.body;

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendStatus = (status) => res.write(`data: ${JSON.stringify({ status })}\n\n`);
  const sendDone = (ideas) => { res.write(`data: ${JSON.stringify({ done: true, ideas })}\n\n`); res.end(); };
  const sendError = (error) => { res.write(`data: ${JSON.stringify({ error })}\n\n`); res.end(); };

  const childrenDesc = children?.length
    ? `${children.length} children (ages: ${children.join(', ')})`
    : 'no children';

  // Fetch existing card titles to avoid duplicates
  sendStatus('Checking existing ideas...');
  const existing = db.prepare('SELECT title FROM cards').all().map(c => c.title);
  const existingList = existing.length
    ? `\n\nWE ALREADY HAVE THESE — do NOT suggest them or anything too similar:\n${existing.map(t => `- ${t}`).join('\n')}`
    : '';

  const dest = destination || 'Japan';
  const userPrompt = prompt || '';

  // Step 1: Classify intent
  sendStatus('Understanding what you\'re looking for...');
  const classifyRaw = await callLLM([
    { role: 'system', content: 'You classify user intent for a Japan trip planner. Return ONLY a JSON object with two fields: "categories" (array from: restaurant, attraction, experience, hotel, shopping, transport) and "count" (number 8-15). No explanation.' },
    { role: 'user', content: `User query: "${userPrompt}"\n\nWhich categories match? Broad/empty = all categories. Specific (food = restaurant, sightseeing = attraction+experience, accommodation = hotel) = only relevant ones.` },
  ], 500);

  let categories = ['restaurant', 'attraction', 'experience', 'hotel', 'shopping', 'transport'];
  let totalCount = 10;
  try {
    // Strip thinking, then extract JSON
    const cleaned = classifyRaw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(fixQuotes(jsonMatch[0]));
      if (Array.isArray(parsed.categories) && parsed.categories.length > 0) {
        categories = parsed.categories.filter(c =>
          ['restaurant', 'attraction', 'experience', 'hotel', 'shopping', 'transport'].includes(c)
        );
        if (categories.length === 0) categories = ['restaurant', 'attraction', 'experience', 'hotel', 'shopping', 'transport'];
      }
      if (parsed.count >= 3 && parsed.count <= 20) totalCount = parsed.count;
    }
  } catch {
    // Fall back to all categories
  }

  const catInstruction = categories.length === 6
    ? `Generate ${totalCount} ideas spread across these categories: restaurant, attraction, experience, hotel, shopping, transport.`
    : `Generate ${totalCount} ideas focused on: ${categories.join(', ')}. Spread them evenly across these categories.`;

  // Step 2: Search Tavily
  sendStatus(`Searching for ${categories.join(', ')} ideas...`);

  const searchArea = nearName ? `near ${nearName} ${dest}` : dest;
  const webContext = await tavilySearch(
    `best ${categories.join(' ')} in ${searchArea} ${dateFrom || ''} ${userPrompt}`,
    5
  );
  const webBlock = webContext ? `\n\nWEB RESEARCH (use this for current, accurate suggestions):\n${webContext}` : '';

  const nearContext = nearLat && nearLng && nearName
    ? `\n\nPROXIMITY CONSTRAINT: ALL suggestions must be within easy walking distance (under 1km) of "${nearName}" (${nearLat}, ${nearLng}). Only suggest places that are genuinely nearby in that specific neighborhood.`
    : '';

  const llmPrompt = `You are a Japan travel expert. Generate trip ideas for a group visiting Japan.

TRIP DETAILS:
- Destination: ${dest}
- Dates: ${dateFrom || 'flexible'} to ${dateTo || 'flexible'}
- Group: ${adults} adults, ${childrenDesc}
- Preferences: ${userPrompt || 'No specific preferences given'}${nearContext}${existingList}${webBlock}

${catInstruction}

For EACH idea return a JSON object with these fields:
- "title": short name of the place
- "category": one of restaurant/attraction/experience/hotel/shopping/transport
- "description": 2 vivid sentences about why it's worth it
- "address": full address or area in Japan
- "timing": when to go, how long to spend, any booking lead time

Return ONLY a JSON array of objects. No markdown, no explanation, no wrapping — just the raw JSON array starting with [ and ending with ].`;

  try {
    sendStatus('Generating ideas...');
    const raw = await callLLM([
      { role: 'system', content: 'You are a JSON API. Return only valid JSON arrays of objects. Each object must have: title, category, description, address, timing. No markdown fences, no strings-in-arrays, no commentary. Output raw JSON only.' },
      { role: 'user', content: llmPrompt },
    ], 8192);

    // Extract JSON array from response (handle markdown fences if model wraps it)
    let jsonStr = raw;
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    const arrMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrMatch) jsonStr = arrMatch[0];

    // Parse ideas — handle all the ways the LLM might mangle JSON
    let ideas;
    try {
      ideas = robustParseIdeas(jsonStr);
    } catch (e) {
      return sendError('LLM returned invalid JSON');
    }

    if (!ideas.length) {
      return sendError('No ideas parsed from LLM response');
    }

    sendStatus(`Found ${ideas.length} ideas, verifying against Google Places...`);

    // Enrich each idea via Google Places — drop ideas that can't be verified
    const results = [];
    for (let i = 0; i < ideas.length; i++) {
      const idea = ideas[i];
      if (!idea.title) continue;
      const category = ['restaurant', 'attraction', 'experience', 'hotel', 'shopping', 'transport'].includes(idea.category)
        ? idea.category : 'attraction';

      sendStatus(`Verifying ${idea.title}... (${i + 1}/${ideas.length})`);
      const place = await enrichPlace(idea.title) || await autocompletePlaceSearch(idea.title);

      if (!place || !place.image_url) {
        // Skip unverified places — they're likely LLM hallucinations
        continue;
      }

      results.push({
        title: idea.title,
        description: idea.description || place.summary || '',
        address: place.address || idea.address || '',
        image_url: place.image_url,
        lat: place.lat || null,
        lng: place.lng || null,
        website: place.website || '',
        rating: place.rating || null,
        opening_hours: place.opening_hours || null,
        price_level: place.price_level ?? null,
        place_id: place.place_id || null,
        category,
        timing: idea.timing || '',
      });
    }

    sendDone(results);
  } catch (err) {
    sendError(err.message);
  }
});

// --- Bulk create cards ---

app.post('/api/cards/bulk', async (req, res) => {
  const { cards: items } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'cards array required' });

  const stmt = db.prepare(`
    INSERT INTO cards (title, description, address, lat, lng, image_url, link_url, category, timing,
      rating, opening_hours, price_level, place_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const created = [];
  const skipped = [];
  for (const item of items) {
    if (!item.title) continue;

    // Use provided data or enrich via Google Places
    let { lat, lng, image_url, address, rating, opening_hours, price_level, place_id } = item;
    let link_url = item.link_url || item.website || '';
    if (!place_id && GOOGLE_MAPS_API_KEY) {
      const place = await enrichPlace(item.title) || await autocompletePlaceSearch(item.title);
      if (place) {
        place_id = place.place_id;
        if (!lat && place.lat) lat = place.lat;
        if (!lng && place.lng) lng = place.lng;
        if (!image_url && place.image_url) image_url = place.image_url;
        if (!address && place.address) address = place.address;
        if (!rating && place.rating) rating = place.rating;
        if (!opening_hours && place.opening_hours) opening_hours = place.opening_hours;
        if (price_level == null && place.price_level != null) price_level = place.price_level;
        if (!link_url && place.website) link_url = place.website;
      } else {
        skipped.push(item.title);
        continue; // Skip cards that can't be verified against Google Places
      }
    }

    const info = stmt.run(
      item.title,
      item.description || null,
      address || null,
      lat || null,
      lng || null,
      image_url || null,
      link_url || null,
      item.category || 'attraction',
      item.timing || null,
      rating || null,
      opening_hours || null,
      price_level ?? null,
      place_id || null,
    );
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(info.lastInsertRowid);
    created.push(card);
  }

  res.status(201).json({ created: created.length, skipped, cards: created });
});

// --- Itinerary enrichment (SSE) ---

app.post('/api/itinerary/enrich', async (req, res) => {
  const { card_ids } = req.body;
  if (!card_ids?.length) return res.status(400).json({ error: 'card_ids required' });

  // Check cache
  const cacheKey = JSON.stringify([...card_ids].sort((a, b) => a - b));
  const cached = db.prepare('SELECT content FROM itinerary_cache WHERE cache_key = ?').get(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify({ delta: cached.content })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  // Build prompt from cards
  const placeholders = card_ids.map(() => '?').join(',');
  const cards = db.prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`).all(...card_ids);

  const cardList = cards.map(c => {
    let entry = `### ${c.title}\n- **Category:** ${c.category}`;
    if (c.description) entry += `\n- **Description:** ${c.description}`;
    if (c.timing) entry += `\n- **Timing:** ${c.timing}`;
    if (c.david_note) entry += `\n- **David's note:** ${c.david_note}`;
    if (c.jen_note) entry += `\n- **Jen's note:** ${c.jen_note}`;
    return entry;
  }).join('\n\n');

  const systemPrompt = `You are a Japan travel expert helping a couple plan a detailed trip itinerary.
You have deep knowledge of Japanese culture, logistics, booking requirements, seasonal considerations, and practical travel details.
Be specific, honest about effort involved, and format your output in clean markdown.`;

  const userPrompt = `We're planning a trip to Japan. Below are the places and experiences we've approved.

For each item provide:
- **What to expect**: vivid, honest description of the experience
- **Best timing**: time of day, season, how long to spend, crowd notes
- **How to book**: platform, how far ahead, any reservation apps (Tableall, official sites, etc.)
- **Practical tips**: cash vs card, dress code, etiquette, language notes, what to bring
- **Combine with**: 1–2 nearby things worth pairing in the same outing

After all items:

## Suggested Day-by-Day Flow
Recommended sequence minimising transit and maximising experience, with rough timing per day.

## Logistics Notes
IC card, JR Pass recommendation, airport transfers, which neighbourhoods to base in.

---

OUR APPROVED ITINERARY ITEMS:

${cardList}`;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const body = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: '<think>\n</think>\n', prefix: true },
      ],
      stream: true,
    };
    if (LM_STUDIO_MODEL) body.model = LM_STUDIO_MODEL;

    const headers = { 'Content-Type': 'application/json' };
    if (LM_STUDIO_API_KEY) headers['Authorization'] = `Bearer ${LM_STUDIO_API_KEY}`;

    const upstream = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      res.write(`data: ${JSON.stringify({ error: `LM Studio error: ${upstream.status} ${errText}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    let fullContent = '';
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          }
        } catch {
          // skip malformed JSON chunks
        }
      }
    }

    // Cache result
    if (fullContent) {
      db.prepare('INSERT OR REPLACE INTO itinerary_cache (cache_key, content) VALUES (?, ?)').run(cacheKey, fullContent);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// --- Itinerary CRUD ---

app.post('/api/itineraries', (req, res) => {
  const { card_ids, name, mode } = req.body;
  if (!card_ids?.length) return res.status(400).json({ error: 'card_ids required' });

  const itinMode = mode === 'v2' ? 'v2' : 'v1';

  // Determine version number (increment from max version for same card set)
  const cardIdsJson = JSON.stringify([...card_ids].sort((a, b) => a - b));
  const existing = db.prepare('SELECT MAX(version) as maxVer FROM itineraries').get();
  const version = (existing?.maxVer || 0) + 1;

  const stmt = db.prepare(`
    INSERT INTO itineraries (version, name, card_ids, mode, phase)
    VALUES (?, ?, ?, ?, 'draft')
  `);
  const info = stmt.run(version, name || `v${version}`, cardIdsJson, itinMode);
  const itinerary = db.prepare('SELECT * FROM itineraries WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(itinerary);
});

app.get('/api/itineraries', (req, res) => {
  const rows = db.prepare('SELECT id, version, name, mode, phase, optimization, created_at, updated_at FROM itineraries ORDER BY created_at DESC').all();
  res.json(rows);
});

app.get('/api/itineraries/:id', (req, res) => {
  const itinerary = db.prepare('SELECT * FROM itineraries WHERE id = ?').get(req.params.id);
  if (!itinerary) return res.status(404).json({ error: 'not found' });

  const days = db.prepare('SELECT * FROM itinerary_days WHERE itinerary_id = ? ORDER BY day_number').all(req.params.id);
  // Parse JSON fields
  for (const day of days) {
    try { day.stops = JSON.parse(day.stops_json); } catch { day.stops = []; }
    try {
      const legsData = JSON.parse(day.legs_json || '{}');
      if (legsData.legs) { day.legs = legsData.legs; day.waypoints = legsData.waypoints || []; }
      else if (Array.isArray(legsData)) { day.legs = legsData; day.waypoints = []; }
      else { day.legs = []; day.waypoints = []; }
    } catch { day.legs = []; day.waypoints = []; }
  }

  let cardIds;
  try { cardIds = JSON.parse(itinerary.card_ids); } catch { cardIds = []; }
  let proposal;
  try { proposal = JSON.parse(itinerary.proposal_json || 'null'); } catch { proposal = null; }
  let final_data;
  try { final_data = JSON.parse(itinerary.final_json || 'null'); } catch { final_data = null; }

  // Collect card IDs from slots too (LLM-created cards may not be in card_ids)
  const slotCardIds = new Set();
  for (const day of days) {
    for (const stop of (day.stops || [])) {
      if (stop.card_id) slotCardIds.add(stop.card_id);
    }
  }
  const allCardIds = [...new Set([...cardIds, ...slotCardIds])];

  // Include actual card data so frontend doesn't depend on current approvedCards
  let cards = [];
  if (allCardIds.length) {
    const placeholders = allCardIds.map(() => '?').join(',');
    cards = db.prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`).all(...allCardIds);
  }

  res.json({ ...itinerary, card_ids: cardIds, proposal, final_data, days, cards });
});

app.patch('/api/itineraries/:id', (req, res) => {
  const itinerary = db.prepare('SELECT * FROM itineraries WHERE id = ?').get(req.params.id);
  if (!itinerary) return res.status(404).json({ error: 'not found' });

  const allowed = ['name', 'optimization', 'phase'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(req.body[key]);
    }
  }
  if (!sets.length) return res.json(itinerary);

  sets.push("updated_at = datetime('now')");
  params.push(req.params.id);
  db.prepare(`UPDATE itineraries SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM itineraries WHERE id = ?').get(req.params.id));
});

app.delete('/api/itineraries/:id', (req, res) => {
  const info = db.prepare('DELETE FROM itineraries WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: true });
});

// --- V2: Skeleton generation ---

function generateSlotTemplate(dayType, flights) {
  const id = () => Math.random().toString(36).slice(2, 10);
  const returnFlight = flights?.find(f => f.direction === 'return');
  const makeSlots = (count) =>
    Array.from({ length: count }, (_, i) => ({ slot_id: id(), card_id: null, order: i }));

  switch (dayType) {
    case 'arrival':      return makeSlots(2);
    case 'jet_lag':      return makeSlots(4);
    case 'departure': {
      const depHour = returnFlight?.departure_time ? parseInt(returnFlight.departure_time.split(':')[0]) : 0;
      return depHour >= 15 ? makeSlots(1) : [];
    }
    case 'travel':       return makeSlots(2);
    default:             return makeSlots(5); // normal
  }
}

app.post('/api/itineraries/:id/skeleton', (req, res) => {
  const itinId = Number(req.params.id);
  const itinerary = db.prepare('SELECT * FROM itineraries WHERE id = ?').get(itinId);
  if (!itinerary) return res.status(404).json({ error: 'not found' });
  if (itinerary.mode !== 'v2') return res.status(400).json({ error: 'skeleton only for v2 itineraries' });

  let cardIds;
  try { cardIds = JSON.parse(itinerary.card_ids); } catch { cardIds = []; }

  const placeholders = cardIds.length ? cardIds.map(() => '?').join(',') : '0';
  const cards = cardIds.length ? db.prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`).all(...cardIds) : [];

  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of settingsRows) {
    try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
  }

  const flights = db.prepare('SELECT * FROM flights ORDER BY departure_time').all();
  const hotels = cards.filter(c => c.category === 'hotel');
  const firstHotel = hotels[0] || null;

  const skeleton = buildDaySkeleton(cards, hotels, flights, settings);
  if (!skeleton) return res.status(400).json({ error: 'Could not build skeleton — check trip dates' });

  // Clear any existing days
  db.prepare('DELETE FROM itinerary_days WHERE itinerary_id = ?').run(itinId);

  const dayStmt = db.prepare(`
    INSERT INTO itinerary_days (itinerary_id, day_number, date, title, hotel_id, stops_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const daysOut = [];
  for (const day of skeleton.days) {
    const slots = generateSlotTemplate(day.type, flights);
    const hotelId = firstHotel ? firstHotel.id : null;
    const title = day.type === 'normal' ? `Day ${day.day}` : `Day ${day.day} (${day.type})`;
    dayStmt.run(itinId, day.day, day.date, title, hotelId, JSON.stringify(slots));
    daysOut.push({
      day_number: day.day,
      date: day.date,
      title,
      type: day.type,
      hotel_id: hotelId,
      slots,
    });
  }

  // Update phase
  db.prepare("UPDATE itineraries SET phase = 'skeleton', updated_at = datetime('now') WHERE id = ?").run(itinId);

  res.json({
    days: daysOut,
    hotels: hotels.map(h => ({ id: h.id, title: h.title, address: h.address, lat: h.lat, lng: h.lng })),
  });
});

// --- V2: Update day slots ---

app.patch('/api/itineraries/:id/days/:dayNum/slots', (req, res) => {
  const itinId = Number(req.params.id);
  const dayNum = Number(req.params.dayNum);
  const { slots } = req.body;
  if (!Array.isArray(slots)) return res.status(400).json({ error: 'slots array required' });

  const day = db.prepare('SELECT * FROM itinerary_days WHERE itinerary_id = ? AND day_number = ?').get(itinId, dayNum);
  if (!day) return res.status(404).json({ error: 'day not found' });

  // Clear cached routes so next load recomputes with new slot order
  db.prepare('UPDATE itinerary_days SET stops_json = ?, legs_json = NULL WHERE id = ?').run(JSON.stringify(slots), day.id);
  res.json({ ok: true, slots });
});

// --- V2: Update legs (hotel assignments) ---

app.patch('/api/itineraries/:id/legs', (req, res) => {
  const itinId = Number(req.params.id);
  const { legs } = req.body;
  if (!Array.isArray(legs)) return res.status(400).json({ error: 'legs array required' });

  const days = db.prepare('SELECT * FROM itinerary_days WHERE itinerary_id = ? ORDER BY day_number').all(itinId);
  if (!days.length) return res.status(404).json({ error: 'no days found' });

  const updateStmt = db.prepare('UPDATE itinerary_days SET hotel_id = ? WHERE itinerary_id = ? AND day_number = ?');
  const updateMany = db.transaction((legs) => {
    for (const leg of legs) {
      for (let d = leg.startDay; d <= leg.endDay; d++) {
        updateStmt.run(leg.hotel_id, itinId, d);
      }
    }
  });
  updateMany(legs);

  const updated = db.prepare('SELECT * FROM itinerary_days WHERE itinerary_id = ? ORDER BY day_number').all(itinId);
  for (const day of updated) {
    try { day.stops = JSON.parse(day.stops_json); } catch { day.stops = []; }
  }
  res.json({ days: updated });
});

// --- V2: LLM slot suggestions ---

app.post('/api/itineraries/:id/days/:dayNum/suggest', async (req, res) => {
  const itinId = Number(req.params.id);
  const dayNum = Number(req.params.dayNum);
  const { slots: requestedSlots, anchor_lat, anchor_lng, placed_card_ids } = req.body;

  const itinerary = db.prepare('SELECT * FROM itineraries WHERE id = ?').get(itinId);
  if (!itinerary) return res.status(404).json({ error: 'not found' });

  const day = db.prepare('SELECT * FROM itinerary_days WHERE itinerary_id = ? AND day_number = ?').get(itinId, dayNum);
  if (!day) return res.status(404).json({ error: 'day not found' });

  let currentSlots;
  try { currentSlots = JSON.parse(day.stops_json); } catch { currentSlots = []; }

  // Load context
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of settingsRows) {
    try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
  }

  const hotel = day.hotel_id ? db.prepare('SELECT * FROM cards WHERE id = ?').get(day.hotel_id) : null;
  const hotelCity = hotel?.lat && hotel?.lng ? nearestCity(hotel.lat, hotel.lng) : (settings.destination || 'the area');

  // Build context of what's already scheduled
  let cardIds;
  try { cardIds = JSON.parse(itinerary.card_ids); } catch { cardIds = []; }
  const allCards = cardIds.length ? db.prepare(`SELECT * FROM cards WHERE id IN (${cardIds.map(() => '?').join(',')})`).all(...cardIds) : [];
  const placedSet = new Set(placed_card_ids || []);
  const unplacedCards = allCards.filter(c => !placedSet.has(c.id) && c.category !== 'hotel');
  const scheduledInDay = currentSlots.filter(s => s.card_id).map(s => {
    const c = allCards.find(card => card.id === s.card_id);
    return c ? c.title : 'Unknown';
  });

  // Build the user's request per slot
  const slotRequests = (requestedSlots || []).map(s => s.slot_type).join(', ');

  const unplacedList = unplacedCards.map(c => `${c.title} [${c.category}]${c.address ? ` @ ${c.address}` : ''}`).join('\n');

  // Build anchor description for LLM
  let anchorDesc = '';
  if (anchor_lat && anchor_lng) {
    const anchorCard = allCards.find(c => c.lat && c.lng &&
      Math.abs(Number(c.lat) - anchor_lat) < 0.001 && Math.abs(Number(c.lng) - anchor_lng) < 0.001);
    if (anchorCard) {
      anchorDesc = `- The traveler will be coming from: ${anchorCard.title}${anchorCard.address ? ` (${anchorCard.address})` : ''}`;
    } else if (hotel && Math.abs(Number(hotel.lat) - anchor_lat) < 0.01 && Math.abs(Number(hotel.lng) - anchor_lng) < 0.01) {
      anchorDesc = `- The traveler will be starting from their hotel: ${hotel.title}${hotel.address ? ` (${hotel.address})` : ''}`;
    }
  } else if (hotel?.address) {
    anchorDesc = `- The traveler will be starting from their hotel: ${hotel.title} (${hotel.address})`;
  }

  const prompt = `The traveler is asking for: "${slotRequests}"

Suggest exactly 5 REAL places in ${hotelCity} that match this request. Every suggestion must directly relate to what they asked for.

Context:
- Hotel: ${hotel?.title || 'Unknown'}${hotel?.address ? ` (${hotel.address})` : ''}
- Already scheduled today: ${scheduledInDay.length ? scheduledInDay.join(', ') : 'Nothing yet'}
- Travelers: ${settings.adults || 2} adults${(settings.children || []).length ? `, children ages: ${settings.children.join(', ')}` : ''}
${anchorDesc}
${unplacedList ? `\nTheir saved ideas (prefer these when they match the request):\n${unplacedList}` : ''}

RULES:
- EVERY suggestion must match "${slotRequests}". If they ask for ramen, suggest ramen restaurants. If they ask for parks, suggest parks. Never suggest unrelated places.
- Use the EXACT official name as it appears on Google Maps (e.g. "Ichiran Shinjuku" not "Popular Ramen Spot").
- All suggestions within 2-3km of the hotel or previous activity.
- Write 2-3 sentences describing what makes each place special.
- Include full street address.

Return JSON only:
{
  "suggestions": {
    "0": [
      { "title": "Exact Google Maps Name", "category": "attraction|restaurant|experience", "description": "2-3 sentences", "address": "Full street address" }
    ]
  }
}`;

  try {
    const response = await callLLM([
      { role: 'system', content: `You are a local expert for ${hotelCity}. You suggest ONLY real, specific establishments that match exactly what the traveler asks for. If they want ramen, every suggestion is a ramen restaurant. If they want museums, every suggestion is a museum. Never suggest unrelated places. Respond with valid JSON only.` },
      { role: 'user', content: prompt },
    ], 4096);

    let parsed;
    try {
      const jsonStr = response.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      return res.status(500).json({ error: 'Failed to parse LLM response' });
    }

    // Enrich suggestions with lat/lng via Google Places, then filter by distance
    const suggestions = parsed.suggestions || {};
    const anchorForFilter = (anchor_lat && anchor_lng)
      ? { lat: anchor_lat, lng: anchor_lng }
      : (hotel?.lat && hotel?.lng ? { lat: Number(hotel.lat), lng: Number(hotel.lng) } : null);

    for (const slotIdx of Object.keys(suggestions)) {
      const opts = suggestions[slotIdx];
      if (!Array.isArray(opts)) continue;
      for (let i = 0; i < opts.length; i++) {
        try {
          // Pass hotel coords as region for location bias, city name for search context
          const regionHint = (hotel?.lat && hotel?.lng) ? `${hotel.lat},${hotel.lng}` : hotelCity;
          const place = await enrichPlace(opts[i].title, regionHint);
          if (place) {
            opts[i].lat = place.lat;
            opts[i].lng = place.lng;
            console.log(`[suggest] enriched "${opts[i].title}" → "${place.name}" lat=${place.lat} lng=${place.lng}`);
            if (place.image_url) opts[i].image_url = place.image_url;
            if (place.address) opts[i].address = place.address;
            if (place.rating) opts[i].rating = place.rating;
            if (place.name) opts[i].place_name = place.name;
            if (place.place_id) opts[i].place_id = place.place_id;
            if (place.opening_hours) opts[i].opening_hours = place.opening_hours;
            if (place.price_level != null) opts[i].price_level = place.price_level;
            if (place.summary) opts[i].summary = place.summary;
            if (place.website) opts[i].website = place.website;
            // Use richer description from Google if LLM description is short
            if (place.summary && (!opts[i].description || opts[i].description.length < place.summary.length)) {
              opts[i].description = place.summary;
            }
          }
        } catch (enrichErr) {
          console.warn(`enrichPlace failed for "${opts[i].title}":`, enrichErr.message);
        }
      }

      // Filter out places too far from anchor and sort by distance
      if (anchorForFilter) {
        suggestions[slotIdx] = opts
          .filter(o => {
            if (!o.lat || !o.lng) return true; // keep un-geocoded ones at the end
            const dist = haversineKm(anchorForFilter.lat, anchorForFilter.lng, o.lat, o.lng);
            o._dist_km = Math.round(dist * 10) / 10;
            return dist < 10; // drop anything >10km away
          })
          .sort((a, b) => (a._dist_km ?? 999) - (b._dist_km ?? 999));
      }
    }

    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Airport-city mapping ---
const AIRPORT_CITIES = {
  NRT: 'Tokyo', HND: 'Tokyo',
  KIX: 'Osaka', ITM: 'Osaka',
  NGO: 'Nagoya', CTS: 'Sapporo',
  FUK: 'Fukuoka', OKA: 'Okinawa',
  HIJ: 'Hiroshima', KMQ: 'Kanazawa',
  SDJ: 'Sendai', KOJ: 'Kagoshima',
};

function airportCity(code) {
  if (!code) return null;
  return AIRPORT_CITIES[code.toUpperCase().trim()] || null;
}

// --- LLM transit route helper ---

// Simple reverse-geocode: lat/lng → nearest known city, fallback to settings.destination
function nearestCity(lat, lng) {
  const cities = [
    { name: 'Tokyo', lat: 35.6812, lng: 139.7671 },
    { name: 'Osaka', lat: 34.6937, lng: 135.5023 },
    { name: 'Kyoto', lat: 35.0116, lng: 135.7681 },
    { name: 'Nara', lat: 34.6851, lng: 135.8048 },
    { name: 'Kobe', lat: 34.6901, lng: 135.1956 },
    { name: 'Yokohama', lat: 35.4437, lng: 139.6380 },
    { name: 'Hiroshima', lat: 34.3853, lng: 132.4553 },
    { name: 'Fukuoka', lat: 33.5904, lng: 130.4017 },
    { name: 'Sapporo', lat: 43.0618, lng: 141.3545 },
    { name: 'Nagoya', lat: 35.1815, lng: 136.9066 },
    { name: 'Kamakura', lat: 35.3197, lng: 139.5466 },
    { name: 'Hakone', lat: 35.2326, lng: 139.1070 },
    { name: 'Narita', lat: 35.7720, lng: 140.3929 },
    { name: 'Uji', lat: 34.8843, lng: 135.8004 },
  ];
  let best = cities[0], bestDist = Infinity;
  for (const c of cities) {
    const d = Math.sqrt((lat - c.lat) ** 2 + (lng - c.lng) ** 2);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  // If nearest known city is >100km away, fall back to destination setting
  if (bestDist > 0.9) { // ~100km in degrees
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'destination'").get();
      if (row) return JSON.parse(row.value);
    } catch {}
  }
  return best.name;
}

// Ask the LLM for the best transit route between two points, then geocode the stations
async function getTransitRoute(from, to) {
  const fromCity = nearestCity(from.lat, from.lng);
  const toCity = nearestCity(to.lat, to.lng);
  const cityNote = fromCity === toCity
    ? `Both locations are in ${fromCity}.`
    : `Origin is in ${fromCity}, destination is in ${toCity}.`;

  const prompt = `What is the best public transit route from "${from.name}" in ${fromCity} to "${to.name}" in ${toCity}?

${cityNote}

Return ONLY a JSON object (no markdown, no commentary):
{
  "summary": "Take [line] from [station] to [station]",
  "duration_mins": 25,
  "stations": [
    {"name": "Station Name", "line": "Line Name"},
    {"name": "Station Name", "line": "Line Name"}
  ]
}

Rules:
- "${from.name}" is in ${fromCity} — find the nearest station in ${fromCity}
- "${to.name}" is in ${toCity} — find the nearest station in ${toCity}
- Include any transfer stations
- duration_mins is the estimated total time including walking to/from stations
- Keep it to the most practical single route, not alternatives`;

  try {
    const raw = await callLLM([
      { role: 'system', content: `You are a public transit expert. The origin is in ${fromCity} and destination is in ${toCity}. Return only valid JSON.` },
      { role: 'user', content: prompt },
    ], 500);

    let transitData;
    try {
      let jsonStr = raw;
      const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();
      const objMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objMatch) jsonStr = objMatch[0];
      transitData = JSON.parse(jsonStr);
    } catch {
      return null;
    }

    // Geocode each station to get coordinates
    const stationPoints = [];
    // Start with origin point
    stationPoints.push({ lat: from.lat, lng: from.lng });

    for (const station of (transitData.stations || [])) {
      const stationCity = station.city || toCity || fromCity;
      const loc = await geocode(`${station.name} station ${stationCity}`);
      if (loc) {
        stationPoints.push({ lat: loc.lat, lng: loc.lng, name: station.name, line: station.line });
      }
    }

    // End with destination point
    stationPoints.push({ lat: to.lat, lng: to.lng });

    // Build a simple encoded polyline from the station coords
    const polyline = encodePolyline(stationPoints);

    return {
      duration: transitData.duration_mins ? `${transitData.duration_mins} mins` : 'unknown',
      duration_value: (transitData.duration_mins || 0) * 60,
      distance: null,
      polyline,
      mode: 'transit',
      summary: transitData.summary || '',
      stations: stationPoints,
      status: 'OK',
    };
  } catch {
    return null;
  }
}

// Encode an array of {lat, lng} into a Google-compatible encoded polyline
function encodePolyline(points) {
  let encoded = '';
  let prevLat = 0, prevLng = 0;
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    encoded += encodeValue(lat - prevLat);
    encoded += encodeValue(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return encoded;
}

function encodeValue(value) {
  let v = value < 0 ? ~(value << 1) : (value << 1);
  let encoded = '';
  while (v >= 0x20) {
    encoded += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  encoded += String.fromCharCode(v + 63);
  return encoded;
}

// --- LLM card ID remapping helper ---
// The LLM sometimes invents sequential IDs (1,2,3...) instead of using the real DB IDs.
// This function remaps them back to the real IDs by matching order of appearance.
function remapCardIds(llmIds, realIds) {
  const realSet = new Set(realIds);
  const allValid = llmIds.every(id => realSet.has(id));
  if (allValid) return llmIds; // LLM used correct IDs

  // Build a mapping: LLM assigned them in the order they appeared in the prompt
  // The prompt lists cards in the same order as realIds, so map by position
  const llmUnique = [...new Set(llmIds)];
  const mapping = {};
  for (let i = 0; i < llmUnique.length && i < realIds.length; i++) {
    mapping[llmUnique[i]] = realIds[i];
  }
  return llmIds.map(id => mapping[id] ?? id);
}

function remapProposal(proposal, realIds) {
  if (!proposal?.days) return proposal;
  // Collect all card IDs from both card_ids and stops arrays
  const allLlmIds = proposal.days.flatMap(d => {
    const fromCardIds = d.card_ids || [];
    const fromStops = (d.stops || []).filter(s => s.card_id).map(s => s.card_id);
    return [...fromCardIds, ...fromStops];
  });
  const realSet = new Set(realIds);
  if (allLlmIds.every(id => realSet.has(id))) return proposal; // Already correct

  // Remap: collect all LLM IDs in order, map to real IDs in order
  const llmOrdered = [];
  const seen = new Set();
  for (const id of allLlmIds) {
    if (!seen.has(id)) { llmOrdered.push(id); seen.add(id); }
  }
  const mapping = {};
  for (let i = 0; i < llmOrdered.length && i < realIds.length; i++) {
    mapping[llmOrdered[i]] = realIds[i];
  }

  for (const day of proposal.days) {
    day.card_ids = (day.card_ids || []).map(id => mapping[id] ?? id);
    // Also remap inside stops array
    for (const stop of (day.stops || [])) {
      if (stop.card_id) stop.card_id = mapping[stop.card_id] ?? stop.card_id;
    }
    if (day.hotel_id) day.hotel_id = mapping[day.hotel_id] ?? day.hotel_id;
  }
  return proposal;
}

function remapFinalData(finalData, realIds) {
  if (!finalData?.days) return finalData;
  const allLlmIds = finalData.days.flatMap(d => (d.stops || []).map(s => s.card_id));
  const realSet = new Set(realIds);
  if (allLlmIds.every(id => realSet.has(id))) return finalData; // Already correct

  const llmOrdered = [];
  const seen = new Set();
  for (const id of allLlmIds) {
    if (!seen.has(id)) { llmOrdered.push(id); seen.add(id); }
  }
  const mapping = {};
  for (let i = 0; i < llmOrdered.length && i < realIds.length; i++) {
    mapping[llmOrdered[i]] = realIds[i];
  }

  for (const day of finalData.days) {
    for (const stop of (day.stops || [])) {
      stop.card_id = mapping[stop.card_id] ?? stop.card_id;
    }
    if (day.hotel_id) day.hotel_id = mapping[day.hotel_id] ?? day.hotel_id;
  }
  return finalData;
}

// --- Deterministic Itinerary Pipeline ---

// Default durations by category (minutes)
const DURATION_DEFAULTS = {
  attraction: 90, restaurant: 60, hotel: 30, experience: 90,
  transport: 0, shopping: 45, museum: 120,
};

// Price level mapping (Google Places 0-4 → label)
const PRICE_LABELS = ['free', 'budget', 'moderate', 'expensive', 'expensive'];

// Phase 1: Build day skeleton deterministically (no LLM)
function buildDaySkeleton(cards, hotels, flights, settings) {
  const dateFrom = settings.dateFrom ? new Date(settings.dateFrom) : null;
  const dateTo = settings.dateTo ? new Date(settings.dateTo) : null;
  if (!dateFrom || !dateTo) return null;

  const totalDays = Math.round((dateTo - dateFrom) / (1000 * 60 * 60 * 24)) + 1;
  if (totalDays < 1 || totalDays > 60) return null;

  // Identify flights
  const outbound = flights.find(f => f.direction === 'outbound');
  const returnFlight = flights.find(f => f.direction === 'return');
  const returnCity = returnFlight ? airportCity(returnFlight.departure_airport) : null;

  // Pre-group non-hotel cards by nearest hotel
  const nonHotelCards = cards.filter(c => c.category !== 'hotel');
  const hotelGroups = {};
  for (const h of hotels) hotelGroups[h.id] = { hotel: h, cards: [], city: (h.lat && h.lng) ? nearestCity(h.lat, h.lng) : null };
  for (const c of nonHotelCards) {
    if (!c.lat || !c.lng || !hotels.length) {
      hotelGroups[hotels[0]?.id]?.cards.push(c);
      continue;
    }
    let bestHotel = hotels[0], bestDist = Infinity;
    for (const h of hotels) {
      if (!h.lat || !h.lng) continue;
      const d = haversineKm(c.lat, c.lng, h.lat, h.lng);
      if (d < bestDist) { bestDist = d; bestHotel = h; }
    }
    hotelGroups[bestHotel.id].cards.push(c);
  }

  // Separate restaurants from activities per hotel group
  const restaurantsByHotel = {};
  const activitiesByHotel = {};
  for (const [hid, g] of Object.entries(hotelGroups)) {
    restaurantsByHotel[hid] = g.cards.filter(c => c.category === 'restaurant');
    activitiesByHotel[hid] = g.cards.filter(c => c.category !== 'restaurant');
  }

  // Determine hotel schedule: which hotel for which day range
  // For multi-hotel: split days proportionally by number of activities per hotel
  const hotelSchedule = []; // [{ hotel_id, startDay, endDay, city }]
  if (hotels.length <= 1) {
    hotelSchedule.push({ hotel_id: hotels[0]?.id || null, startDay: 1, endDay: totalDays, city: hotelGroups[hotels[0]?.id]?.city });
  } else {
    // Distribute days proportional to activity count, with at least 2 days per hotel
    const totalActivities = Object.values(activitiesByHotel).reduce((s, a) => s + a.length, 0) || 1;
    let dayOffset = 1;
    const hotelList = hotels.filter(h => hotelGroups[h.id]); // in order
    for (let i = 0; i < hotelList.length; i++) {
      const h = hotelList[i];
      const actCount = (activitiesByHotel[h.id] || []).length;
      const proportion = actCount / totalActivities;
      let dayCount = Math.max(2, Math.round(proportion * (totalDays - hotelList.length))); // reserve 1 travel day per switch
      if (i === hotelList.length - 1) dayCount = totalDays - dayOffset + 1; // last hotel gets remaining days
      hotelSchedule.push({
        hotel_id: h.id,
        startDay: dayOffset,
        endDay: dayOffset + dayCount - 1,
        city: hotelGroups[h.id]?.city,
      });
      dayOffset += dayCount;
    }
  }

  // Build day objects
  const days = [];
  for (let d = 1; d <= totalDays; d++) {
    const date = new Date(dateFrom);
    date.setDate(date.getDate() + d - 1);
    const dateStr = date.toISOString().split('T')[0];

    // Find which hotel segment this day belongs to
    const segment = hotelSchedule.find(s => d >= s.startDay && d <= s.endDay) || hotelSchedule[hotelSchedule.length - 1];
    const prevSegment = hotelSchedule.find(s => s.endDay === d - 1 && s.hotel_id !== segment.hotel_id);

    // Determine day type
    let type = 'normal';
    let availableHours = 10; // 9am-7pm
    let maxActivities = 3;

    if (d === 1) {
      type = 'arrival';
      availableHours = 3; // late afternoon only
      maxActivities = 1;
    } else if (d === 2) {
      type = 'jet_lag';
      availableHours = 6;
      maxActivities = 2;
    } else if (d === totalDays) {
      type = 'departure';
      availableHours = returnFlight?.departure_time ? 3 : 0; // morning only if afternoon flight
      maxActivities = returnFlight?.departure_time && parseInt(returnFlight.departure_time.split(':')[0]) >= 15 ? 1 : 0;
    } else if (prevSegment) {
      // Hotel switch day = travel day
      type = 'travel';
      availableHours = 4; // morning only before train
      maxActivities = 1;
    } else if (returnCity && d === totalDays - 1 && segment.city && segment.city !== returnCity) {
      // Day before departure: need to travel back to departure city
      type = 'travel';
      availableHours = 4;
      maxActivities = 1;
    }

    // Children adjustments
    const childAges = settings.children || [];
    if (childAges.some(a => a < 5) && type === 'normal') {
      maxActivities = Math.min(maxActivities, 2);
      availableHours = Math.min(availableHours, 8);
    }

    days.push({
      day: d,
      date: dateStr,
      hotel_id: segment.hotel_id,
      type,
      availableHours,
      maxActivities,
      restaurant_card_ids: [],
      candidate_activity_ids: (activitiesByHotel[segment.hotel_id] || []).map(c => c.id),
    });
  }

  // Distribute restaurant cards across normal/full days for this hotel
  for (const [hid, restaurants] of Object.entries(restaurantsByHotel)) {
    const eligibleDays = days.filter(d => d.hotel_id === Number(hid) && ['normal', 'jet_lag'].includes(d.type));
    let ri = 0;
    for (const r of restaurants) {
      if (eligibleDays.length === 0) break;
      const targetDay = eligibleDays[ri % eligibleDays.length];
      targetDay.restaurant_card_ids.push(r.id);
      ri++;
    }
  }

  // Build distance matrix per hotel group (for LLM context)
  const distanceMatrices = {};
  for (const [hid, g] of Object.entries(hotelGroups)) {
    const allCards = g.cards.filter(c => c.lat && c.lng);
    if (allCards.length < 2) continue;
    const matrix = [];
    for (let i = 0; i < allCards.length; i++) {
      for (let j = i + 1; j < allCards.length; j++) {
        const dist = haversineKm(allCards[i].lat, allCards[i].lng, allCards[j].lat, allCards[j].lng);
        if (dist > 0.5) { // Only include non-trivial distances
          matrix.push({ from: allCards[i].id, to: allCards[j].id, km: Math.round(dist * 10) / 10 });
        }
      }
    }
    if (matrix.length) distanceMatrices[hid] = matrix;
  }

  return { days, hotelSchedule, hotelGroups, distanceMatrices, returnCity };
}

// Phase 3: Assemble timed schedule from LLM assignments (no LLM)
function assembleSchedule(skeleton, assignments, mealSuggestions, cardMap) {
  const result = [];
  const assignMap = {};
  for (const a of (assignments || [])) assignMap[a.day] = a;

  const mealMap = {};
  for (const m of (mealSuggestions || [])) {
    if (!mealMap[m.day]) mealMap[m.day] = {};
    mealMap[m.day][m.slot] = m.suggestion;
  }

  for (const day of skeleton.days) {
    const assignment = assignMap[day.day] || {};
    const activityIds = assignment.card_ids || [];
    const dayMeals = mealMap[day.day] || {};

    // Determine start time based on day type
    let startHour = 9;
    if (day.type === 'arrival') startHour = 16;
    else if (day.type === 'travel') startHour = 8;
    else if (day.type === 'departure') startHour = 8;

    const stops = [];
    let currentMinutes = startHour * 60; // Track time in minutes from midnight

    // Helper: format minutes to HH:MM
    const fmtTime = (mins) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    // Helper: get duration for a card
    const getDuration = (card) => {
      if (!card) return 60;
      return DURATION_DEFAULTS[card.category] || 90;
    };

    // Helper: build note from real data
    const buildNote = (card) => {
      const parts = [];
      if (card.opening_hours) {
        try {
          const oh = JSON.parse(card.opening_hours);
          // Find today's hours from weekday_text
          if (oh.weekday_text && oh.weekday_text.length) {
            const dayOfWeek = new Date(day.date).getDay();
            // weekday_text is Mon-Sun (0-6), JS getDay is Sun=0
            const idx = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            if (oh.weekday_text[idx]) parts.push(oh.weekday_text[idx]);
          }
        } catch {}
      }
      if (card.price_level !== null && card.price_level !== undefined) {
        parts.push(PRICE_LABELS[card.price_level] || '');
      }
      if (card.timing) parts.push(card.timing);
      return parts.filter(Boolean).join('. ') || null;
    };

    // Schedule activities with lunch and dinner interspersed
    let lunchPlaced = false;
    let dinnerPlaced = false;

    for (let i = 0; i < activityIds.length; i++) {
      const card = cardMap[activityIds[i]];
      if (!card) continue;

      // Check if we should insert lunch before this activity
      if (!lunchPlaced && currentMinutes >= 11.5 * 60 && currentMinutes < 14 * 60) {
        const lunchCard = day.restaurant_card_ids.length ? cardMap[day.restaurant_card_ids[0]] : null;
        stops.push({
          card_id: lunchCard?.id || null,
          suggested_time: fmtTime(Math.max(currentMinutes, 12 * 60)),
          duration_mins: 60,
          slot_type: 'lunch',
          suggestion: lunchCard ? null : (dayMeals.lunch || 'Local restaurant near activities'),
          note: lunchCard ? buildNote(lunchCard) : null,
        });
        currentMinutes = Math.max(currentMinutes, 12 * 60) + 60 + 15; // lunch + transit gap
        lunchPlaced = true;
      }

      // Schedule the activity
      const duration = getDuration(card);
      stops.push({
        card_id: card.id,
        suggested_time: fmtTime(currentMinutes),
        duration_mins: duration,
        slot_type: 'activity',
        note: buildNote(card),
        cost_level: card.price_level !== null && card.price_level !== undefined ? PRICE_LABELS[card.price_level] : null,
      });
      currentMinutes += duration + 20; // activity + transit gap
    }

    // Insert lunch if not yet placed (early in the day or no activities before noon)
    if (!lunchPlaced && day.type !== 'departure') {
      const lunchTime = Math.max(currentMinutes, 12 * 60);
      if (lunchTime < 14.5 * 60) {
        const lunchCard = day.restaurant_card_ids.length ? cardMap[day.restaurant_card_ids[0]] : null;
        stops.push({
          card_id: lunchCard?.id || null,
          suggested_time: fmtTime(lunchTime),
          duration_mins: 60,
          slot_type: 'lunch',
          suggestion: lunchCard ? null : (dayMeals.lunch || 'Local restaurant near activities'),
          note: lunchCard ? buildNote(lunchCard) : null,
        });
        currentMinutes = lunchTime + 60 + 15;
        lunchPlaced = true;
      }
    }

    // Dinner
    if (!dinnerPlaced && day.type !== 'departure') {
      const dinnerTime = Math.max(currentMinutes, 18 * 60);
      const dinnerCard = day.restaurant_card_ids.length > 1 ? cardMap[day.restaurant_card_ids[1]] :
        (day.restaurant_card_ids.length === 1 && !lunchPlaced ? cardMap[day.restaurant_card_ids[0]] : null);
      stops.push({
        card_id: dinnerCard?.id || null,
        suggested_time: fmtTime(Math.min(dinnerTime, 19.5 * 60)),
        duration_mins: 75,
        slot_type: 'dinner',
        suggestion: dinnerCard ? null : (dayMeals.dinner || 'Dinner near hotel'),
        note: dinnerCard ? buildNote(dinnerCard) : null,
      });
    }

    // Sort stops by time
    stops.sort((a, b) => (a.suggested_time || '').localeCompare(b.suggested_time || ''));

    // Add order field
    stops.forEach((s, i) => { s.order = i; });

    // Calculate walking estimate from card distances
    let walkingKm = 0;
    const stopCards = stops.filter(s => s.card_id).map(s => cardMap[s.card_id]).filter(c => c?.lat && c?.lng);
    for (let i = 1; i < stopCards.length; i++) {
      walkingKm += haversineKm(stopCards[i-1].lat, stopCards[i-1].lng, stopCards[i].lat, stopCards[i].lng);
    }

    result.push({
      day: day.day,
      date: day.date,
      title: assignment.title || `Day ${day.day}`,
      hotel_id: day.hotel_id,
      stops,
      pacing: assignment.pacing || (day.type === 'arrival' || day.type === 'departure' ? 'light' : 'moderate'),
      summary: assignment.summary || null,
      rationale: assignment.rationale || null,
      estimated_walking_km: Math.round(walkingKm * 10) / 10,
      estimated_transit_mins: Math.round(walkingKm * 8), // rough: 8 min per km by transit
    });
  }

  return result;
}

// --- Itinerary Propose ---

app.post('/api/itineraries/:id/propose', async (req, res) => {
  const itinId = Number(req.params.id);
  const itinerary = db.prepare('SELECT * FROM itineraries WHERE id = ?').get(itinId);
  if (!itinerary) return res.status(404).json({ error: 'not found' });

  let cardIds;
  try { cardIds = JSON.parse(itinerary.card_ids); } catch { cardIds = []; }
  if (!cardIds.length) return res.status(400).json({ error: 'no cards in itinerary' });

  const placeholders = cardIds.map(() => '?').join(',');
  const cards = db.prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`).all(...cardIds);
  const cardMap = {};
  for (const c of cards) cardMap[c.id] = c;

  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of settingsRows) {
    try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
  }

  const flights = db.prepare('SELECT * FROM flights ORDER BY departure_time').all();
  const hotels = cards.filter(c => c.category === 'hotel');

  // SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify({ status: 'Building day structure...' })}\n\n`);

  try {
    // === PHASE 1: Build skeleton deterministically ===
    const skeleton = buildDaySkeleton(cards, hotels, flights, settings);
    if (!skeleton) {
      res.write(`data: ${JSON.stringify({ error: 'Could not build skeleton — check trip dates' })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    res.write(`data: ${JSON.stringify({ status: 'Assigning activities to days...' })}\n\n`);

    // === PHASE 2: Focused LLM call — just assign activities to days ===
    // Build compact card list for LLM (only activity cards, grouped by hotel)
    let activityList = '';
    for (const [hid, g] of Object.entries(skeleton.hotelGroups)) {
      const activities = g.cards.filter(c => c.category !== 'restaurant');
      if (!activities.length) continue;
      const city = g.city || 'unknown';
      activityList += `\n[${city} - near ${g.hotel.title}]\n`;
      for (const c of activities) {
        let entry = `ID=${c.id}: ${c.title} [${c.category}]`;
        if (c.description) entry += ` — ${c.description}`;
        const notes = [c.david_note, c.jen_note].filter(Boolean);
        if (notes.length) entry += ` (Notes: ${notes.join('; ')})`;
        activityList += entry + '\n';
      }
    }

    // Build compact day skeleton for LLM
    let skeletonText = '';
    for (const d of skeleton.days) {
      const segment = skeleton.hotelSchedule.find(s => d.day >= s.startDay && d.day <= s.endDay);
      skeletonText += `Day ${d.day} (${d.date}): ${d.type.toUpperCase()}, hotel=${segment?.city || '?'}, max ${d.maxActivities} activities\n`;
    }

    // Compact distance info
    let distText = '';
    for (const [hid, matrix] of Object.entries(skeleton.distanceMatrices)) {
      for (const { from, to, km } of matrix.slice(0, 20)) { // limit to top 20
        const fc = cardMap[from], tc = cardMap[to];
        if (fc && tc) distText += `${fc.title} ↔ ${tc.title}: ${km}km\n`;
      }
    }

    const systemPrompt = `You are a Japan travel planner. Assign activity cards to days. The day structure, hotels, travel days, and meals are already handled — you just pick which activities go on which day.

Return ONLY valid JSON (no markdown fences):
{
  "assignments": [
    { "day": 3, "card_ids": [16, 62], "title": "Theme title", "pacing": "moderate", "summary": "One-line overview", "rationale": "Why grouped" }
  ],
  "meal_suggestions": [
    { "day": 3, "slot": "lunch", "suggestion": "Specific restaurant or food area recommendation" },
    { "day": 3, "slot": "dinner", "suggestion": "Specific restaurant recommendation near activities" }
  ]
}

Rules:
- Every activity ID must appear in exactly one day's card_ids
- Respect the max activities per day shown in the skeleton
- Group nearby activities on the same day (use distances below)
- arrival/jet_lag/travel/departure days: assign 0-1 lightweight activities only
- Prioritize cards with personal notes — give them prime days
- meal_suggestions: suggest a specific restaurant name and cuisine for each day's lunch and dinner (for days without a pre-assigned restaurant)
- pacing: "light", "moderate", "full", or "intense"`;

    const userPrompt = `GROUP: ${settings.adults || 2} adults${settings.children?.length ? `, children ages ${settings.children.join(', ')}` : ''}

DAY SKELETON:
${skeletonText}
ACTIVITIES TO ASSIGN:
${activityList}
${distText ? `DISTANCES:\n${distText}` : ''}
Assign all activities to days. Return JSON.`;

    const raw = await callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], 4096);

    // Parse the LLM response
    let llmResult;
    try {
      let jsonStr = raw;
      const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();
      const objMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objMatch) jsonStr = objMatch[0];
      llmResult = JSON.parse(jsonStr);
    } catch {
      res.write(`data: ${JSON.stringify({ error: 'Failed to parse LLM response' })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // Remap IDs if LLM invented sequential ones
    const allLlmIds = (llmResult.assignments || []).flatMap(a => a.card_ids || []);
    const realSet = new Set(cardIds);
    if (!allLlmIds.every(id => realSet.has(id))) {
      const llmOrdered = [...new Set(allLlmIds)];
      const nonHotelIds = cardIds.filter(id => !hotels.some(h => h.id === id));
      const mapping = {};
      for (let i = 0; i < llmOrdered.length && i < nonHotelIds.length; i++) {
        mapping[llmOrdered[i]] = nonHotelIds[i];
      }
      for (const a of (llmResult.assignments || [])) {
        a.card_ids = (a.card_ids || []).map(id => mapping[id] ?? id);
      }
    }

    res.write(`data: ${JSON.stringify({ status: 'Assembling schedule...' })}\n\n`);

    // === PHASE 3: Assemble timed schedule deterministically ===
    const assembledDays = assembleSchedule(skeleton, llmResult.assignments, llmResult.meal_suggestions, cardMap);

    // Build proposal in the format ProposalReview expects
    const proposal = {
      days: assembledDays.map(d => ({
        day: d.day,
        title: d.title,
        hotel_id: d.hotel_id,
        stops: d.stops,
        card_ids: d.stops.filter(s => s.card_id).map(s => s.card_id),
        rationale: d.rationale,
        pacing: d.pacing,
        summary: d.summary,
        estimated_walking_km: d.estimated_walking_km,
        estimated_transit_mins: d.estimated_transit_mins,
      })),
      optimization_options: [
        { key: 'minimal_walking', label: 'Minimize Walking', description: 'Prioritize subway/train connections' },
        { key: 'cultural_flow', label: 'Cultural Flow', description: 'Group by theme — temples one day, food another' },
        { key: 'balanced', label: 'Balanced Pace', description: 'Mix of walking and transit, varied activities' },
      ],
    };

    // Save proposal to itinerary
    db.prepare(`UPDATE itineraries SET proposal_json = ?, phase = 'proposal', updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(proposal), itinId);

    // Create itinerary_days rows
    db.prepare('DELETE FROM itinerary_days WHERE itinerary_id = ?').run(itinId);
    const dayStmt = db.prepare(`
      INSERT INTO itinerary_days (itinerary_id, day_number, title, hotel_id, stops_json, pacing, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const day of assembledDays) {
      dayStmt.run(itinId, day.day, day.title, day.hotel_id || null, JSON.stringify(day.stops), day.pacing || null, day.summary || null);
    }

    res.write(`data: ${JSON.stringify({ proposal, status: 'done' })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// --- Itinerary Finalize (Phase 2 LLM) ---

// Haversine distance in km
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const la1 = Number(lat1), lo1 = Number(lon1), la2 = Number(lat2), lo2 = Number(lon2);
  if (isNaN(la1) || isNaN(lo1) || isNaN(la2) || isNaN(lo2)) return 999;
  const dLat = (la2 - la1) * Math.PI / 180;
  const dLon = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.post('/api/itineraries/:id/finalize', (req, res) => {
  const itinId = Number(req.params.id);
  const { optimization, dayHotels } = req.body;
  const itinerary = db.prepare('SELECT * FROM itineraries WHERE id = ?').get(itinId);
  if (!itinerary) return res.status(404).json({ error: 'not found' });

  let proposal;
  try { proposal = JSON.parse(itinerary.proposal_json); } catch {
    return res.status(400).json({ error: 'no proposal to finalize' });
  }

  // Apply user's hotel assignments (overrides LLM proposal)
  if (dayHotels && proposal.days) {
    for (const day of proposal.days) {
      if (dayHotels[day.day] !== undefined) {
        day.hotel_id = dayHotels[day.day];
      }
    }
    db.prepare(`UPDATE itineraries SET proposal_json = ? WHERE id = ?`)
      .run(JSON.stringify(proposal), itinId);
  }

  let cardIds;
  try { cardIds = JSON.parse(itinerary.card_ids); } catch { cardIds = []; }
  const placeholders = cardIds.map(() => '?').join(',');
  const cards = db.prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`).all(...cardIds);
  const cardMap = {};
  for (const c of cards) cardMap[c.id] = c;

  // Load settings for trip dates
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of settingsRows) {
    try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
  }

  // Finalize: preserve LLM's time-ordered stops (with timing and meal data)
  db.prepare('DELETE FROM itinerary_days WHERE itinerary_id = ?').run(itinId);
  const dayStmt = db.prepare(`
    INSERT INTO itinerary_days (itinerary_id, day_number, date, title, hotel_id, stops_json, pacing, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const startDate = settings.dateFrom ? new Date(settings.dateFrom) : null;

  for (const day of (proposal.days || [])) {
    // Use the new stops array if available, else fall back to card_ids
    let stops;
    if (day.stops && Array.isArray(day.stops)) {
      // Preserve LLM's time-ordered stops with all metadata
      stops = day.stops.map((s, order) => ({
        card_id: s.card_id || null,
        order,
        suggested_time: s.suggested_time || null,
        duration_mins: s.duration_mins || null,
        slot_type: s.slot_type || 'activity',
        suggestion: s.suggestion || null,
        note: s.note || null,
        cost_level: s.cost_level || null,
        booking: s.booking || null,
      }));
    } else {
      // Legacy card_ids format — nearest-neighbor ordering as fallback
      const hotelCard = day.hotel_id ? cardMap[day.hotel_id] : null;
      const stopCards = (day.card_ids || []).map(cid => cardMap[cid]).filter(Boolean);
      let ordered = [];
      if (hotelCard?.lat && hotelCard?.lng && stopCards.length > 1) {
        const remaining = [...stopCards];
        let current = { lat: hotelCard.lat, lng: hotelCard.lng };
        while (remaining.length > 0) {
          let bestIdx = 0, bestDist = Infinity;
          for (let i = 0; i < remaining.length; i++) {
            if (!remaining[i].lat || !remaining[i].lng) continue;
            const d = haversineKm(current.lat, current.lng, remaining[i].lat, remaining[i].lng);
            if (d < bestDist) { bestDist = d; bestIdx = i; }
          }
          const next = remaining.splice(bestIdx, 1)[0];
          ordered.push(next);
          if (next.lat && next.lng) current = { lat: next.lat, lng: next.lng };
        }
      } else {
        ordered = stopCards;
      }
      stops = ordered.map((card, order) => ({ card_id: card.id, order }));
    }

    // Compute date for this day
    let dayDate = null;
    if (startDate) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + day.day - 1);
      dayDate = d.toISOString().split('T')[0];
    }

    dayStmt.run(
      itinId,
      day.day,
      dayDate,
      day.title || `Day ${day.day}`,
      day.hotel_id || null,
      JSON.stringify(stops),
      day.pacing || null,
      day.summary || null
    );
  }

  // Save final data
  db.prepare(`UPDATE itineraries SET optimization = ?, phase = 'final', updated_at = datetime('now') WHERE id = ?`)
    .run(optimization || 'balanced', itinId);

  res.json({ ok: true });
});

// --- Per-Day Load: routes only (SSE for progress, returns legs at end) ---

app.post('/api/itineraries/:id/days/:dayNum/load', async (req, res) => {
  const { id, dayNum } = req.params;
  const itinerary = db.prepare('SELECT * FROM itineraries WHERE id = ?').get(id);
  if (!itinerary) return res.status(404).json({ error: 'itinerary not found' });

  const dayRow = db.prepare('SELECT * FROM itinerary_days WHERE itinerary_id = ? AND day_number = ?').get(id, dayNum);
  if (!dayRow) return res.status(404).json({ error: 'day not found' });

  // If already loaded, return cached data
  if (dayRow.legs_json && dayRow.legs_json !== '[]' && dayRow.legs_json !== '{}') {
    try {
      const cached = JSON.parse(dayRow.legs_json);
      // New format has { legs, waypoints }, old format is just an array
      if (cached.legs && cached.waypoints) return res.json(cached);
      if (Array.isArray(cached) && cached.length) return res.json({ legs: cached, waypoints: [] });
    } catch {}
  }

  let stops;
  try { stops = JSON.parse(dayRow.stops_json); } catch { stops = []; }

  // Load all cards for this itinerary
  let allCardIds;
  try { allCardIds = JSON.parse(itinerary.card_ids); } catch { allCardIds = []; }
  const allPlaceholders = allCardIds.map(() => '?').join(',');
  const allCards = allCardIds.length ? db.prepare(`SELECT * FROM cards WHERE id IN (${allPlaceholders})`).all(...allCardIds) : [];
  const cardMap = {};
  for (const c of allCards) cardMap[c.id] = c;

  // Use this day's assigned hotel (multi-hotel support)
  const hotelCard = dayRow.hotel_id ? cardMap[dayRow.hotel_id] : allCards.find(c => c.category === 'hotel' && c.lat && c.lng);

  // Check context: hotel change, first day (arrival), last day (departure)
  const allDayRows = db.prepare('SELECT * FROM itinerary_days WHERE itinerary_id = ? ORDER BY day_number').all(id);
  const prevDay = [...allDayRows].reverse().find(d => d.day_number < parseInt(dayNum) && d.hotel_id) || null;
  const prevHotelCard = prevDay?.hotel_id ? cardMap[prevDay.hotel_id] : null;
  const isHotelChange = prevHotelCard && hotelCard && prevHotelCard.id !== hotelCard.id;
  const isFirstDay = allDayRows[0]?.day_number === parseInt(dayNum);
  const isLastDay = allDayRows[allDayRows.length - 1]?.day_number === parseInt(dayNum);

  // Load flights for airport routing
  const flights = db.prepare('SELECT * FROM flights ORDER BY departure_time').all();
  const outboundFlight = flights.find(f => f.direction === 'outbound');
  const returnFlight = flights.find(f => f.direction === 'return');

  // Build waypoints based on day type
  const namedWaypoints = [];

  // Starting point
  if (isFirstDay && outboundFlight?.arrival_airport) {
    // Arrival day: Airport → Hotel (check in, drop bags) → stops → Hotel
    namedWaypoints.push({ lat: null, lng: null, name: `${outboundFlight.arrival_airport} Airport`, address: `${outboundFlight.arrival_airport} Airport` });
    if (hotelCard?.lat && hotelCard?.lng) {
      namedWaypoints.push({ lat: hotelCard.lat, lng: hotelCard.lng, name: `${hotelCard.title} (check-in)` });
    }
  } else if (isHotelChange) {
    // Travel day: origin hotel → morning stops → origin hotel (bags) → new hotel
    namedWaypoints.push({ lat: prevHotelCard.lat, lng: prevHotelCard.lng, name: prevHotelCard.title });
  } else if (hotelCard?.lat && hotelCard?.lng) {
    // Normal day: start from today's hotel
    namedWaypoints.push({ lat: hotelCard.lat, lng: hotelCard.lng, name: hotelCard.title });
  }

  // Stops
  for (const s of stops) {
    const card = cardMap[s.card_id];
    if (card?.lat && card?.lng) namedWaypoints.push({ lat: card.lat, lng: card.lng, name: card.title });
  }

  // End point
  if (isHotelChange) {
    // Travel day: stops → origin hotel (pick up bags) → destination hotel
    if (prevHotelCard?.lat && prevHotelCard?.lng) {
      const lastWp = namedWaypoints[namedWaypoints.length - 1];
      const isLastWpOriginHotel = lastWp && lastWp.lat === prevHotelCard.lat && lastWp.lng === prevHotelCard.lng;
      if (!isLastWpOriginHotel) {
        namedWaypoints.push({ lat: prevHotelCard.lat, lng: prevHotelCard.lng, name: `${prevHotelCard.title} (pick up bags)` });
      }
    }
    if (hotelCard?.lat && hotelCard?.lng) {
      namedWaypoints.push({ lat: hotelCard.lat, lng: hotelCard.lng, name: `${hotelCard.title} (check-in)` });
    }
  } else if (isLastDay && returnFlight?.departure_airport) {
    // Departure day: stops → Hotel (bags) → Airport
    if (hotelCard?.lat && hotelCard?.lng) {
      const lastWp = namedWaypoints[namedWaypoints.length - 1];
      const isLastWpHotel = lastWp && hotelCard && lastWp.lat === hotelCard.lat && lastWp.lng === hotelCard.lng;
      if (!isLastWpHotel) {
        namedWaypoints.push({ lat: hotelCard.lat, lng: hotelCard.lng, name: `${hotelCard.title} (pick up bags)` });
      }
    }
    namedWaypoints.push({ lat: null, lng: null, name: `${returnFlight.departure_airport} Airport`, address: `${returnFlight.departure_airport} Airport` });
  } else if (hotelCard?.lat && hotelCard?.lng) {
    // Normal: end at today's hotel
    namedWaypoints.push({ lat: hotelCard.lat, lng: hotelCard.lng, name: hotelCard.title });
  }

  // Geocode any waypoints that only have an address (airports)
  for (const wp of namedWaypoints) {
    if (!wp.lat && wp.address) {
      const loc = await geocode(wp.address);
      if (loc) { wp.lat = loc.lat; wp.lng = loc.lng; }
    }
  }

  // Filter out waypoints we couldn't geocode
  const validWaypoints = namedWaypoints.filter(wp => wp.lat && wp.lng);

  const legs = [];
  if (validWaypoints.length >= 2) {
    for (let i = 0; i < validWaypoints.length - 1; i++) {
      const from = validWaypoints[i];
      const to = validWaypoints[i + 1];
      const routes = [];
      const origin = `${from.lat},${from.lng}`;
      const dest = `${to.lat},${to.lng}`;

      // Always get walking route (even if long)
      try {
        const walkParams = new URLSearchParams({
          origin, destination: dest, mode: 'walking', key: GOOGLE_MAPS_API_KEY,
        });
        const walkRes = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${walkParams}`);
        if (walkRes.ok) {
          const walkData = await walkRes.json();
          const wRoute = walkData.routes?.[0];
          const wLeg = wRoute?.legs?.[0];
          if (wLeg) {
            routes.push({
              mode: 'walking',
              duration: wLeg.duration?.text || 'unknown',
              duration_value: wLeg.duration?.value || 0,
              distance: wLeg.distance?.text || 'unknown',
              polyline: wRoute.overview_polyline?.points || null,
            });
          }
        }
      } catch {}

      // Also get transit route via LLM (station-to-station)
      try {
        const transitLeg = await getTransitRoute(from, to);
        if (transitLeg && transitLeg.duration !== 'unknown') {
          routes.push(transitLeg);
        }
      } catch {}

      if (routes.length === 0) {
        routes.push({ duration: 'unknown', distance: 'unknown', polyline: null, mode: 'walking' });
      }
      legs.push({ routes, from: { name: from.name }, to: { name: to.name } });
    }
  }

  // Build waypoint markers for the map (name + lat/lng + type)
  // Only mark last waypoint as "destination" if it's a different location from origin
  const first = validWaypoints[0];
  const last = validWaypoints[validWaypoints.length - 1];
  const lastIsDifferent = first && last && (
    Math.abs(first.lat - last.lat) > 0.01 || Math.abs(first.lng - last.lng) > 0.01
  );
  const waypoints = validWaypoints.map((wp, i) => ({
    lat: wp.lat, lng: wp.lng, name: wp.name,
    type: i === 0 ? 'origin'
      : (i === validWaypoints.length - 1 && lastIsDifferent) ? 'destination'
      : 'stop',
  }));

  // Save legs + waypoints
  const payload = { legs, waypoints };
  db.prepare('UPDATE itinerary_days SET legs_json = ? WHERE id = ?')
    .run(JSON.stringify(payload), dayRow.id);

  res.json(payload);
});

// --- Per-Day Enrichment (SSE) - legacy, kept for backward compat ---

app.post('/api/itineraries/:id/days/:dayNum/enrich', async (req, res) => {
  const { id, dayNum } = req.params;
  const itinerary = db.prepare('SELECT * FROM itineraries WHERE id = ?').get(id);
  if (!itinerary) return res.status(404).json({ error: 'itinerary not found' });

  const dayRow = db.prepare('SELECT * FROM itinerary_days WHERE itinerary_id = ? AND day_number = ?').get(id, dayNum);
  if (!dayRow) return res.status(404).json({ error: 'day not found' });

  // If already enriched, return cached
  if (dayRow.enrichment_status === 'done' && dayRow.enrichment_md) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify({ delta: dayRow.enrichment_md })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  let stops;
  try { stops = JSON.parse(dayRow.stops_json); } catch { stops = []; }
  // Filter to stops with card_ids for DB lookup, but keep all stops for the schedule
  const cardIds = stops.map(s => s.card_id).filter(Boolean);
  if (!stops.length) return res.status(400).json({ error: 'no stops in this day' });

  let cards = [];
  if (cardIds.length) {
    const placeholders = cardIds.map(() => '?').join(',');
    cards = db.prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`).all(...cardIds);
  }

  // Load flights for day 1 / last day context
  const flights = db.prepare('SELECT * FROM flights ORDER BY departure_time').all();
  const allDays = db.prepare('SELECT day_number FROM itinerary_days WHERE itinerary_id = ? ORDER BY day_number').all(id);
  const isFirstDay = parseInt(dayNum) === allDays[0]?.day_number;
  const isLastDay = parseInt(dayNum) === allDays[allDays.length - 1]?.day_number;

  let extraContext = '';

  // Hotel context — use this day's assigned hotel
  let allCardIds;
  try { allCardIds = JSON.parse(itinerary.card_ids); } catch { allCardIds = []; }
  if (allCardIds.length) {
    const allPlaceholders = allCardIds.map(() => '?').join(',');
    const allCards = db.prepare(`SELECT * FROM cards WHERE id IN (${allPlaceholders})`).all(...allCardIds);
    const hotelCard = dayRow.hotel_id ? allCards.find(c => c.id === dayRow.hotel_id) : allCards.find(c => c.category === 'hotel');
    if (hotelCard) {
      extraContext += `\n\nHOTEL: The group is staying at ${hotelCard.title}${hotelCard.address ? ` (${hotelCard.address})` : ''} tonight. This day starts and ends at this hotel.`;
    }
  }

  if (isFirstDay) {
    const outbound = flights.find(f => f.direction === 'outbound');
    if (outbound) extraContext += `\n\nFLIGHT CONTEXT: You arrive on ${outbound.airline || ''} ${outbound.flight_number || ''} at ${outbound.arrival_airport || ''} at ${outbound.arrival_time || ''}. Account for jet lag, immigration, and transit to the city.`;
  }
  if (isLastDay) {
    const returnFlight = flights.find(f => f.direction === 'return');
    if (returnFlight) extraContext += `\n\nFLIGHT CONTEXT: Return flight ${returnFlight.airline || ''} ${returnFlight.flight_number || ''} departs ${returnFlight.departure_airport || ''} at ${returnFlight.departure_time || ''}. Plan time to get to the airport and check in.`;
  }

  // Include computed route data if available
  let routeContext = '';
  if (dayRow.legs_json) {
    try {
      const routeData = JSON.parse(dayRow.legs_json);
      if (routeData.legs && routeData.legs.length) {
        routeContext = '\n\nCOMPUTED ROUTES BETWEEN STOPS (use these for accurate transit directions):';
        const wpNames = (routeData.waypoints || []).map(w => w.name);
        routeData.legs.forEach((leg, i) => {
          const fromName = wpNames[i] || `Stop ${i}`;
          const toName = wpNames[i + 1] || `Stop ${i + 1}`;
          routeContext += `\n- ${fromName} → ${toName}: ${leg.mode || 'unknown'}, ${leg.duration || 'unknown'}`;
          if (leg.summary) routeContext += ` (${leg.summary})`;
        });
      }
    } catch {}
  }

  // Build stop list — now includes meal suggestions (card_id=null) and timing
  const stopList = stops.map((s, i) => {
    if (s.card_id) {
      const card = cards.find(c => c.id === s.card_id);
      if (!card) return '';
      let entry = `${i + 1}. **${card.title}** [${card.category}]`;
      if (s.suggested_time) entry += ` — arrive ~${s.suggested_time}`;
      if (s.duration_mins) entry += `, spend ~${s.duration_mins} mins`;
      if (s.slot_type && s.slot_type !== 'activity') entry += ` (${s.slot_type})`;
      if (card.address) entry += `\n   Address: ${card.address}`;
      if (card.description) entry += `\n   ${card.description}`;
      const personalNotes = [card.david_note, card.jen_note].filter(Boolean);
      if (personalNotes.length) entry += `\n   Personal context: ${personalNotes.join('; ')}`;
      if (card.link_url) entry += `\n   Reference: ${card.link_url}`;
      if (s.note) entry += `\n   Note: ${s.note}`;
      return entry;
    } else if (s.suggestion) {
      // LLM-suggested meal/experience (no card)
      let entry = `${i + 1}. **${s.slot_type?.toUpperCase() || 'MEAL'} BREAK**`;
      if (s.suggested_time) entry += ` — ~${s.suggested_time}`;
      if (s.duration_mins) entry += `, ~${s.duration_mins} mins`;
      entry += `\n   Suggestion: ${s.suggestion}`;
      if (s.note) entry += `\n   Note: ${s.note}`;
      return entry;
    }
    return '';
  }).filter(Boolean).join('\n\n');

  const systemPrompt = `You are a Japan travel expert writing a vivid, practical, hour-by-hour day guide. Write like a knowledgeable friend walking them through the day. Use markdown formatting.`;

  const userPrompt = `Write a detailed, time-stamped guide for Day ${dayNum}: "${dayRow.title}"
${dayRow.date ? `Date: ${dayRow.date}` : ''}

SCHEDULED STOPS (in chronological order):
${stopList}
${extraContext}
${routeContext}

Write the guide as a flowing narrative schedule. For each time block:

**[TIME] Stop/Activity Name**
- What to expect (2-3 vivid sentences)
- Practical tips (cash vs card, etiquette, what to wear/bring, how to book)
- Timing notes (crowds, opening hours, seasonal considerations)

**[TIME] Getting to next stop**
- Specific transit directions (use the computed routes above if available)
- What you'll pass along the way

For MEAL stops (lunch/dinner):
- If a specific restaurant is in the schedule, describe it and what to order
- If it's a suggestion, give 2-3 specific restaurant options with what they're known for
- Include price range and reservation tips

End with:
- A "Day Summary" with total walking estimate and key reminders
- One local insider tip for the area`;

  // SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  db.prepare('UPDATE itinerary_days SET enrichment_status = ? WHERE id = ?').run('streaming', dayRow.id);

  try {
    const body = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: '<think>\n</think>\n', prefix: true },
      ],
      stream: true,
    };
    if (LM_STUDIO_MODEL) body.model = LM_STUDIO_MODEL;

    const headers = { 'Content-Type': 'application/json' };
    if (LM_STUDIO_API_KEY) headers['Authorization'] = `Bearer ${LM_STUDIO_API_KEY}`;

    const upstream = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      db.prepare('UPDATE itinerary_days SET enrichment_status = ? WHERE id = ?').run('error', dayRow.id);
      res.write(`data: ${JSON.stringify({ error: `LLM error: ${upstream.status}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    let fullContent = '';
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let streamBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      streamBuffer += decoder.decode(value, { stream: true });
      const lines = streamBuffer.split('\n');
      streamBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          }
        } catch {}
      }
    }

    // Strip think tags and save
    fullContent = fullContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    db.prepare('UPDATE itinerary_days SET enrichment_md = ?, enrichment_status = ? WHERE id = ?')
      .run(fullContent, 'done', dayRow.id);

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    db.prepare('UPDATE itinerary_days SET enrichment_status = ? WHERE id = ?').run('error', dayRow.id);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// --- Flights CRUD ---

app.get('/api/flights', (req, res) => {
  res.json(db.prepare('SELECT * FROM flights ORDER BY departure_time').all());
});

app.post('/api/flights', (req, res) => {
  const { direction, airline, flight_number, departure_airport, arrival_airport, departure_time, arrival_time, departure_tz, arrival_tz, notes } = req.body;
  if (!direction || !['outbound', 'return'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be "outbound" or "return"' });
  }

  const stmt = db.prepare(`
    INSERT INTO flights (direction, airline, flight_number, departure_airport, arrival_airport, departure_time, arrival_time, departure_tz, arrival_tz, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(direction, airline || null, flight_number || null, departure_airport || null, arrival_airport || null, departure_time || null, arrival_time || null, departure_tz || null, arrival_tz || null, notes || null);
  res.status(201).json(db.prepare('SELECT * FROM flights WHERE id = ?').get(info.lastInsertRowid));
});

app.patch('/api/flights/:id', (req, res) => {
  const flight = db.prepare('SELECT * FROM flights WHERE id = ?').get(req.params.id);
  if (!flight) return res.status(404).json({ error: 'not found' });

  const allowed = ['direction', 'airline', 'flight_number', 'departure_airport', 'arrival_airport', 'departure_time', 'arrival_time', 'departure_tz', 'arrival_tz', 'notes'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(req.body[key]);
    }
  }
  if (!sets.length) return res.json(flight);

  params.push(req.params.id);
  db.prepare(`UPDATE flights SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM flights WHERE id = ?').get(req.params.id));
});

app.delete('/api/flights/:id', (req, res) => {
  const info = db.prepare('DELETE FROM flights WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: true });
});

const PORT = process.env.PORT || 3737;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
