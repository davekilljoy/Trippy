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

app.post('/api/cards', (req, res) => {
  const { title, description, address, image_url, link_url, category, timing, david_note, jen_note } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  const stmt = db.prepare(`
    INSERT INTO cards (title, description, address, image_url, link_url, category, timing, david_note, jen_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    title,
    description || null,
    address || null,
    image_url || null,
    link_url || null,
    category || 'attraction',
    timing || null,
    david_note || null,
    jen_note || null
  );
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(info.lastInsertRowid);
  // Geocode in background
  geocodeCard(card).catch(() => {});
  res.status(201).json(card);
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

// Google Maps Directions API (returns polylines + duration/distance)
async function fetchDirections(origin, destination) {
  if (!GOOGLE_MAPS_API_KEY) return { duration: 'unknown', distance: 'unknown', polyline: null };

  async function tryMode(mode) {
    const params = new URLSearchParams({
      origin, destination, mode,
      key: GOOGLE_MAPS_API_KEY,
      region: 'jp',
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
      region: 'jp',
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

async function searchPlace(query) {
  if (!GOOGLE_MAPS_API_KEY) return null;
  try {
    const params = new URLSearchParams({
      input: query,
      inputtype: 'textquery',
      fields: 'place_id,name,formatted_address,geometry,photos,types,website,rating',
      key: GOOGLE_MAPS_API_KEY,
      locationbias: 'rectangle:24.0,122.0|46.0,154.0', // Japan bounding box
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
      fields: 'name,formatted_address,geometry,photos,types,website,rating,editorial_summary,url',
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
      components: 'country:jp',
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
async function enrichPlace(title) {
  const place = await searchPlace(`${title} Japan`);
  if (!place) return null;
  const detail = await placeDetails(place.place_id);
  if (!detail) return null;
  const photo = detail.photos?.[0]?.photo_reference;
  return {
    name: detail.name,
    address: detail.formatted_address,
    lat: detail.geometry?.location?.lat,
    lng: detail.geometry?.location?.lng,
    types: detail.types || [],
    website: detail.website || '',
    rating: detail.rating,
    summary: detail.editorial_summary?.overview || '',
    image_url: photo ? `/api/places/photo?ref=${photo}` : '',
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
  const cards = db.prepare("SELECT id, title FROM cards WHERE image_url IS NULL OR image_url = ''").all();
  const results = [];

  for (const card of cards) {
    const url = await findCommonsImage(card.title);
    if (url) {
      db.prepare("UPDATE cards SET image_url = ?, updated_at = datetime('now') WHERE id = ?").run(url, card.id);
      results.push({ id: card.id, title: card.title, image_url: url });
    }
  }

  res.json({ backfilled: results.length, total: cards.length, results });
});

// --- Generate ideas via LLM ---

app.post('/api/cards/generate', async (req, res) => {
  const { destination, dateFrom, dateTo, adults, children, prompt } = req.body;

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

  const webContext = await tavilySearch(
    `best ${categories.join(' ')} in ${dest} ${dateFrom || ''} ${userPrompt}`,
    5
  );
  const webBlock = webContext ? `\n\nWEB RESEARCH (use this for current, accurate suggestions):\n${webContext}` : '';

  const llmPrompt = `You are a Japan travel expert. Generate trip ideas for a group visiting Japan.

TRIP DETAILS:
- Destination: ${dest}
- Dates: ${dateFrom || 'flexible'} to ${dateTo || 'flexible'}
- Group: ${adults} adults, ${childrenDesc}
- Preferences: ${userPrompt || 'No specific preferences given'}${existingList}${webBlock}

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

    sendStatus(`Found ${ideas.length} ideas, fetching details...`);

    // Enrich each idea via Google Places, fall back to Commons for images
    const results = [];
    for (let i = 0; i < ideas.length; i++) {
      const idea = ideas[i];
      if (!idea.title) continue;
      const category = ['restaurant', 'attraction', 'experience', 'hotel', 'shopping', 'transport'].includes(idea.category)
        ? idea.category : 'attraction';

      sendStatus(`Looking up ${idea.title}... (${i + 1}/${ideas.length})`);
      const place = await enrichPlace(idea.title);

      results.push({
        title: idea.title,
        description: idea.description || place?.summary || '',
        address: place?.address || idea.address || '',
        image_url: place?.image_url || await findCommonsImage(idea.title) || '',
        lat: place?.lat || null,
        lng: place?.lng || null,
        website: place?.website || '',
        rating: place?.rating || null,
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

app.post('/api/cards/bulk', (req, res) => {
  const { cards: items } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'cards array required' });

  const stmt = db.prepare(`
    INSERT INTO cards (title, description, address, image_url, category, timing)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const created = [];
  for (const item of items) {
    if (!item.title) continue;
    const info = stmt.run(
      item.title,
      item.description || null,
      item.address || null,
      item.image_url || null,
      item.category || 'attraction',
      item.timing || null,
    );
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(info.lastInsertRowid);
    created.push(card);
    geocodeCard(card).catch(() => {});
  }

  res.status(201).json({ created: created.length, cards: created });
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
  const { card_ids, name } = req.body;
  if (!card_ids?.length) return res.status(400).json({ error: 'card_ids required' });

  // Determine version number (increment from max version for same card set)
  const cardIdsJson = JSON.stringify([...card_ids].sort((a, b) => a - b));
  const existing = db.prepare('SELECT MAX(version) as maxVer FROM itineraries').get();
  const version = (existing?.maxVer || 0) + 1;

  const stmt = db.prepare(`
    INSERT INTO itineraries (version, name, card_ids, phase)
    VALUES (?, ?, ?, 'draft')
  `);
  const info = stmt.run(version, name || `v${version}`, cardIdsJson);
  const itinerary = db.prepare('SELECT * FROM itineraries WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(itinerary);
});

app.get('/api/itineraries', (req, res) => {
  const rows = db.prepare('SELECT id, version, name, phase, optimization, created_at, updated_at FROM itineraries ORDER BY created_at DESC').all();
  res.json(rows);
});

app.get('/api/itineraries/:id', (req, res) => {
  const itinerary = db.prepare('SELECT * FROM itineraries WHERE id = ?').get(req.params.id);
  if (!itinerary) return res.status(404).json({ error: 'not found' });

  const days = db.prepare('SELECT * FROM itinerary_days WHERE itinerary_id = ? ORDER BY day_number').all(req.params.id);
  // Parse JSON fields
  for (const day of days) {
    try { day.stops = JSON.parse(day.stops_json); } catch { day.stops = []; }
    try { day.legs = JSON.parse(day.legs_json || '[]'); } catch { day.legs = []; }
  }

  let cardIds;
  try { cardIds = JSON.parse(itinerary.card_ids); } catch { cardIds = []; }
  let proposal;
  try { proposal = JSON.parse(itinerary.proposal_json || 'null'); } catch { proposal = null; }
  let final_data;
  try { final_data = JSON.parse(itinerary.final_json || 'null'); } catch { final_data = null; }

  // Include actual card data so frontend doesn't depend on current approvedCards
  let cards = [];
  if (cardIds.length) {
    const placeholders = cardIds.map(() => '?').join(',');
    cards = db.prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`).all(...cardIds);
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

// --- LLM transit route helper ---
// Ask the LLM for the best transit route between two points, then geocode the stations
async function getTransitRoute(from, to) {
  const prompt = `What is the best transit route from "${from.name}" (${from.lat},${from.lng}) to "${to.name}" (${to.lat},${to.lng}) in Tokyo/Japan?

Return ONLY a JSON object (no markdown, no commentary):
{
  "summary": "Take Marunouchi Line from Tokyo Station to Shinjuku Station",
  "duration_mins": 25,
  "stations": [
    {"name": "Tokyo Station", "line": "Marunouchi Line"},
    {"name": "Shinjuku Station", "line": "Marunouchi Line"}
  ]
}

Rules:
- Include the starting station (nearest to origin) and ending station (nearest to destination)
- Include any transfer stations
- duration_mins is the estimated total time including walking to/from stations
- Keep it to the most practical single route, not alternatives`;

  try {
    const raw = await callLLM([
      { role: 'system', content: 'You are a Tokyo transit expert. Return only valid JSON.' },
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
      // LLM returned bad JSON, fall back to driving directions
      return fetchDirections(`${from.lat},${from.lng}`, `${to.lat},${to.lng}`);
    }

    // Geocode each station to get coordinates
    const stationPoints = [];
    // Start with origin point
    stationPoints.push({ lat: from.lat, lng: from.lng });

    for (const station of (transitData.stations || [])) {
      const loc = await geocode(`${station.name} station Tokyo Japan`);
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
    // Fall back to driving directions
    return fetchDirections(`${from.lat},${from.lng}`, `${to.lat},${to.lng}`);
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
  const allLlmIds = proposal.days.flatMap(d => d.card_ids || []);
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
  }
  return finalData;
}

// --- Itinerary Propose (Phase 1 LLM) ---

app.post('/api/itineraries/:id/propose', async (req, res) => {
  const itinerary = db.prepare('SELECT * FROM itineraries WHERE id = ?').get(req.params.id);
  if (!itinerary) return res.status(404).json({ error: 'not found' });

  let cardIds;
  try { cardIds = JSON.parse(itinerary.card_ids); } catch { cardIds = []; }
  if (!cardIds.length) return res.status(400).json({ error: 'no cards in itinerary' });

  const placeholders = cardIds.map(() => '?').join(',');
  const cards = db.prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`).all(...cardIds);

  // Load trip settings for date context
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of settingsRows) {
    try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
  }

  // Load flights for context
  const flights = db.prepare('SELECT * FROM flights ORDER BY departure_time').all();

  const cardList = cards.map(c => {
    let entry = `- ID=${c.id}: ${c.title} [${c.category}]`;
    if (c.address) entry += ` @ ${c.address}`;
    if (c.lat && c.lng) entry += ` (${c.lat}, ${c.lng})`;
    if (c.description) entry += ` — ${c.description}`;
    if (c.timing) entry += ` | Timing: ${c.timing}`;
    return entry;
  }).join('\n');

  let flightContext = '';
  if (flights.length) {
    const outbound = flights.find(f => f.direction === 'outbound');
    const returnFlight = flights.find(f => f.direction === 'return');
    if (outbound) flightContext += `\nOutbound flight: ${outbound.airline || ''} ${outbound.flight_number || ''}, departs ${outbound.departure_airport || ''} ${outbound.departure_time || ''}, arrives ${outbound.arrival_airport || ''} ${outbound.arrival_time || ''}`;
    if (returnFlight) flightContext += `\nReturn flight: ${returnFlight.airline || ''} ${returnFlight.flight_number || ''}, departs ${returnFlight.departure_airport || ''} ${returnFlight.departure_time || ''}, arrives ${returnFlight.arrival_airport || ''} ${returnFlight.arrival_time || ''}`;
  }

  const dateInfo = settings.dateFrom && settings.dateTo
    ? `Trip dates: ${settings.dateFrom} to ${settings.dateTo}`
    : 'Trip dates: flexible';

  const systemPrompt = `You are a Japan travel logistics expert. Given a list of approved places with their locations, propose a sensible day-by-day grouping.

CRITICAL: Each place has an ID number (shown as "ID=55" etc). You MUST use these EXACT ID numbers in card_ids. Do NOT invent new IDs or renumber them.

Return ONLY a valid JSON object (no markdown fences, no commentary) with this exact structure:
{
  "days": [
    {
      "day": 1,
      "title": "Short theme title for the day",
      "card_ids": [55, 62, 70],
      "rationale": "Brief explanation of why these are grouped",
      "estimated_walking_km": 3.2,
      "estimated_transit_mins": 25
    }
  ],
  "optimization_options": [
    {
      "key": "minimal_walking",
      "label": "Minimize Walking",
      "description": "Prioritize subway/train connections, limit walking"
    },
    {
      "key": "cultural_flow",
      "label": "Cultural Flow",
      "description": "Group by theme — temples one day, food districts another"
    },
    {
      "key": "balanced",
      "label": "Balanced Pace",
      "description": "Mix of walking and transit, varied activities each day"
    }
  ]
}

Rules:
- card_ids MUST be the exact ID numbers from the input (e.g. ID=55 means use 55)
- Every ID from the input must appear in exactly one day
- Group geographically close places on the same day
- Consider opening hours and logical visit order
- If there is exactly one hotel in the list, assume it is the base for the entire trip — do NOT assign it to a single day. Instead, omit it from day groupings and note it as the accommodation. All days start and end at this hotel.
- Account for jet lag on day 1 if flight info is provided — keep it light
- The last day before a return flight should allow time to get to the airport`;

  const userPrompt = `${dateInfo}
Group: ${settings.adults || 2} adults${settings.children?.length ? `, ${settings.children.length} children (ages: ${settings.children.join(', ')})` : ''}
${flightContext}

APPROVED PLACES:
${cardList}

Propose a day-by-day grouping. Each day should have 2-5 stops. Return the JSON.`;

  // SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify({ status: 'Analyzing your places...' })}\n\n`);

  try {
    const raw = await callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], 4096);

    // Parse the proposal JSON
    let proposal;
    try {
      let jsonStr = raw;
      const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();
      const objMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objMatch) jsonStr = objMatch[0];
      proposal = JSON.parse(jsonStr);
    } catch {
      res.write(`data: ${JSON.stringify({ error: 'Failed to parse proposal from LLM' })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    if (!proposal.days || !Array.isArray(proposal.days)) {
      res.write(`data: ${JSON.stringify({ error: 'Invalid proposal structure' })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // Remap card IDs if LLM invented sequential ones instead of real DB IDs
    remapProposal(proposal, cardIds);

    // Save proposal to itinerary
    db.prepare(`UPDATE itineraries SET proposal_json = ?, phase = 'proposal', updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(proposal), req.params.id);

    // Create itinerary_days rows
    db.prepare('DELETE FROM itinerary_days WHERE itinerary_id = ?').run(req.params.id);
    const dayStmt = db.prepare(`
      INSERT INTO itinerary_days (itinerary_id, day_number, title, stops_json)
      VALUES (?, ?, ?, ?)
    `);
    for (const day of proposal.days) {
      const stops = (day.card_ids || []).map((cid, order) => ({ card_id: cid, order }));
      dayStmt.run(req.params.id, day.day, day.title || `Day ${day.day}`, JSON.stringify(stops));
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

app.post('/api/itineraries/:id/finalize', async (req, res) => {
  const { optimization } = req.body;
  const itinerary = db.prepare('SELECT * FROM itineraries WHERE id = ?').get(req.params.id);
  if (!itinerary) return res.status(404).json({ error: 'not found' });

  let proposal;
  try { proposal = JSON.parse(itinerary.proposal_json); } catch {
    return res.status(400).json({ error: 'no proposal to finalize' });
  }

  let cardIds;
  try { cardIds = JSON.parse(itinerary.card_ids); } catch { cardIds = []; }
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
  let flightContext = '';
  if (flights.length) {
    const outbound = flights.find(f => f.direction === 'outbound');
    const returnFlight = flights.find(f => f.direction === 'return');
    if (outbound) flightContext += `\nOutbound: ${outbound.airline || ''} ${outbound.flight_number || ''}, arrives ${outbound.arrival_airport || ''} at ${outbound.arrival_time || ''}`;
    if (returnFlight) flightContext += `\nReturn: ${returnFlight.airline || ''} ${returnFlight.flight_number || ''}, departs ${returnFlight.departure_airport || ''} at ${returnFlight.departure_time || ''}`;
  }

  // Build detailed card info for each proposed day
  const daysDescription = proposal.days.map(day => {
    const stopDetails = (day.card_ids || []).map(cid => {
      const c = cardMap[cid];
      if (!c) return `- ID=${cid}: [Unknown card]`;
      let entry = `- ID=${c.id}: ${c.title} [${c.category}] @ ${c.address || 'no address'}`;
      if (c.timing) entry += ` | ${c.timing}`;
      return entry;
    }).join('\n');
    return `Day ${day.day} — "${day.title}":\n${stopDetails}`;
  }).join('\n\n');

  const systemPrompt = `You are a Japan travel expert creating a finalized day-by-day itinerary.

CRITICAL: Each place has an ID number (shown as "ID=55" etc). You MUST use these EXACT ID numbers in card_id fields. Do NOT invent new IDs or renumber them.

Return ONLY a valid JSON object (no markdown, no commentary) with this structure:
{
  "days": [
    {
      "day": 1,
      "title": "Day theme title",
      "date": "2025-04-01",
      "stops": [
        {
          "card_id": 55,
          "order": 0,
          "suggested_time": "09:00",
          "duration_mins": 90,
          "note": "Brief practical tip for this stop"
        }
      ]
    }
  ]
}

Rules:
- card_id MUST be the exact ID numbers from the input (e.g. ID=55 means use 55)
- Maintain the same day groupings from the proposal
- Order stops within each day for optimal flow based on the "${optimization || 'balanced'}" optimization
- Include realistic suggested_time values based on opening hours and travel time
- Account for meals (leave gaps for lunch/dinner near restaurant stops)
- If there is a single hotel, it is the base for the entire trip — all days start and end there. Do not include it as a stop; assume transit times are from/to this hotel.
- Day 1 should account for jet lag/arrival time if flight info is provided
- Last day should leave time for airport transfer if return flight info is provided`;

  const userPrompt = `Trip: ${settings.dateFrom || 'flexible'} to ${settings.dateTo || 'flexible'}
Optimization: ${optimization || 'balanced'}
${flightContext}

PROPOSED DAY GROUPINGS:
${daysDescription}

Finalize the schedule with ordered stops and timing. Return the JSON.`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify({ status: 'Building your schedule...' })}\n\n`);

  try {
    const raw = await callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], 4096);

    let finalData;
    try {
      let jsonStr = raw;
      const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();
      const objMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objMatch) jsonStr = objMatch[0];
      finalData = JSON.parse(jsonStr);
    } catch {
      res.write(`data: ${JSON.stringify({ error: 'Failed to parse finalized plan from LLM' })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // Remap card IDs if LLM invented sequential ones instead of real DB IDs
    remapFinalData(finalData, cardIds);

    // Save final data
    db.prepare(`UPDATE itineraries SET final_json = ?, optimization = ?, phase = 'final', updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(finalData), optimization || 'balanced', req.params.id);

    // Update itinerary_days with ordered stops
    db.prepare('DELETE FROM itinerary_days WHERE itinerary_id = ?').run(req.params.id);
    const dayStmt = db.prepare(`
      INSERT INTO itinerary_days (itinerary_id, day_number, date, title, stops_json)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const day of (finalData.days || [])) {
      dayStmt.run(
        req.params.id,
        day.day,
        day.date || null,
        day.title || `Day ${day.day}`,
        JSON.stringify(day.stops || [])
      );
    }

    res.write(`data: ${JSON.stringify({ finalData, status: 'done' })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// --- Per-Day Load: routes only (SSE for progress, returns legs at end) ---

app.post('/api/itineraries/:id/days/:dayNum/load', async (req, res) => {
  const { id, dayNum } = req.params;
  const itinerary = db.prepare('SELECT * FROM itineraries WHERE id = ?').get(id);
  if (!itinerary) return res.status(404).json({ error: 'itinerary not found' });

  const dayRow = db.prepare('SELECT * FROM itinerary_days WHERE itinerary_id = ? AND day_number = ?').get(id, dayNum);
  if (!dayRow) return res.status(404).json({ error: 'day not found' });

  // If already loaded, return cached legs
  if (dayRow.legs_json && dayRow.legs_json !== '[]') {
    let legs; try { legs = JSON.parse(dayRow.legs_json); } catch { legs = []; }
    if (legs.length) return res.json({ legs });
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

  const hotelCard = allCards.find(c => c.category === 'hotel' && c.lat && c.lng);

  // Build waypoints: hotel → stop1 → stop2 → ... → hotel
  const namedWaypoints = [];
  if (hotelCard) namedWaypoints.push({ lat: hotelCard.lat, lng: hotelCard.lng, name: hotelCard.title });
  for (const s of stops) {
    const card = cardMap[s.card_id];
    if (card?.lat && card?.lng) namedWaypoints.push({ lat: card.lat, lng: card.lng, name: card.title });
  }
  if (hotelCard) namedWaypoints.push({ lat: hotelCard.lat, lng: hotelCard.lng, name: hotelCard.title });

  const legs = [];
  if (namedWaypoints.length >= 2) {
    for (let i = 0; i < namedWaypoints.length - 1; i++) {
      const from = namedWaypoints[i];
      const to = namedWaypoints[i + 1];
      try {
        // Try walking first — use if under 30 mins
        const walkResult = await fetchDirections(`${from.lat},${from.lng}`, `${to.lat},${to.lng}`);
        if (walkResult.mode === 'walking' && walkResult.duration_value <= 1800) {
          legs.push(walkResult);
        } else {
          // For longer distances, ask LLM for transit route with station waypoints
          const transitLeg = await getTransitRoute(from, to);
          legs.push(transitLeg);
        }
      } catch {
        legs.push({ duration: 'unknown', distance: 'unknown', polyline: null });
      }
    }
  }

  // Save legs
  db.prepare('UPDATE itinerary_days SET legs_json = ? WHERE id = ?')
    .run(JSON.stringify(legs), dayRow.id);

  res.json({ legs });
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
  const cardIds = stops.map(s => s.card_id);
  if (!cardIds.length) return res.status(400).json({ error: 'no stops in this day' });

  const placeholders = cardIds.map(() => '?').join(',');
  const cards = db.prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`).all(...cardIds);

  // Load flights for day 1 / last day context
  const flights = db.prepare('SELECT * FROM flights ORDER BY departure_time').all();
  const allDays = db.prepare('SELECT day_number FROM itinerary_days WHERE itinerary_id = ? ORDER BY day_number').all(id);
  const isFirstDay = parseInt(dayNum) === allDays[0]?.day_number;
  const isLastDay = parseInt(dayNum) === allDays[allDays.length - 1]?.day_number;

  let extraContext = '';

  // Hotel context — find the single hotel card if it exists
  let allCardIds;
  try { allCardIds = JSON.parse(itinerary.card_ids); } catch { allCardIds = []; }
  if (allCardIds.length) {
    const allPlaceholders = allCardIds.map(() => '?').join(',');
    const allCards = db.prepare(`SELECT * FROM cards WHERE id IN (${allPlaceholders})`).all(...allCardIds);
    const hotels = allCards.filter(c => c.category === 'hotel');
    if (hotels.length === 1) {
      const h = hotels[0];
      extraContext += `\n\nHOTEL: The group is staying at ${h.title}${h.address ? ` (${h.address})` : ''} for the entire trip. All days start and end here. Include transit directions from/to this hotel.`;
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

  const stopList = stops.map((s, i) => {
    const card = cards.find(c => c.id === s.card_id);
    if (!card) return '';
    let entry = `${i + 1}. **${card.title}** [${card.category}]`;
    if (s.suggested_time) entry += ` — arrive ~${s.suggested_time}`;
    if (s.duration_mins) entry += `, spend ~${s.duration_mins} mins`;
    if (card.address) entry += `\n   Address: ${card.address}`;
    if (card.description) entry += `\n   ${card.description}`;
    if (s.note) entry += `\n   Note: ${s.note}`;
    return entry;
  }).filter(Boolean).join('\n\n');

  const systemPrompt = `You are a Japan travel expert writing a vivid, practical day guide. Write in a warm, knowledgeable tone. Use markdown formatting.`;

  const userPrompt = `Write a detailed guide for Day ${dayNum}: "${dayRow.title}"

STOPS FOR THIS DAY:
${stopList}
${extraContext}

For each stop, include:
- A vivid 2-3 sentence description of what to expect
- Best timing tips (crowds, lighting, seasonal notes)
- Practical tips (cash vs card, etiquette, what to wear/bring)
- How to book if needed (apps, websites, walk-in)

Between stops, include:
- How to get there (which train line, which exit, walking directions)
- What you'll pass along the way worth noting

End with:
- A meal recommendation for this day (if no restaurant is already in the stops)
- One insider tip for the area`;

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
