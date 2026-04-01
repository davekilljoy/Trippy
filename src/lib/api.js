const BASE = '/api';

export async function fetchSettings() {
  const res = await fetch(`${BASE}/settings`);
  if (!res.ok) return {};
  return res.json();
}

export async function saveSettings(settings) {
  await fetch(`${BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

export async function fetchCards(params = {}) {
  const url = new URL(`${BASE}/cards`, window.location.origin);
  if (params.category) url.searchParams.set('category', params.category);
  if (params.approved) url.searchParams.set('approved', params.approved);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch cards');
  return res.json();
}

export async function createCard(data) {
  const res = await fetch(`${BASE}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create card');
  return res.json();
}

export async function updateCard(id, data) {
  const res = await fetch(`${BASE}/cards/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update card');
  return res.json();
}

export async function deleteCard(id) {
  const res = await fetch(`${BASE}/cards/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete card');
  return res.json();
}

export async function toggleApproval(id, person) {
  const res = await fetch(`${BASE}/cards/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ person }),
  });
  if (!res.ok) throw new Error('Failed to toggle approval');
  return res.json();
}

export async function generateDescription(title, category, address) {
  const res = await fetch(`${BASE}/cards/describe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, category, address }),
  });
  if (!res.ok) return '';
  const data = await res.json();
  // Returns { description, place } — place has image_url, address, lat, lng etc.
  return data;
}

export async function generateIdeas(params, onStatus) {
  const res = await fetch(`${BASE}/cards/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) throw new Error('Failed to generate ideas');

  const reader = res.body.getReader();
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
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      try {
        const parsed = JSON.parse(payload);
        if (parsed.status && onStatus) onStatus(parsed.status);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.done) return { ideas: parsed.ideas || [] };
      } catch (e) {
        if (e.message && !e.message.includes('JSON')) throw e;
      }
    }
  }
  return { ideas: [] };
}

export async function getDirections(waypoints) {
  const res = await fetch(`${BASE}/directions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ waypoints }),
  });
  if (!res.ok) return { legs: [] };
  return res.json();
}

export async function geocodeCards() {
  const res = await fetch(`${BASE}/cards/geocode`, { method: 'POST' });
  if (!res.ok) return {};
  return res.json();
}

export async function bulkCreateCards(cards) {
  const res = await fetch(`${BASE}/cards/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cards }),
  });
  if (!res.ok) throw new Error('Failed to create cards');
  return res.json();
}

export async function* streamItinerary(cardIds) {
  const res = await fetch(`${BASE}/itinerary/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card_ids: cardIds }),
  });

  if (!res.ok) throw new Error('Failed to start enrichment');

  const reader = res.body.getReader();
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
      if (payload === '[DONE]') return;

      try {
        const parsed = JSON.parse(payload);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.delta) yield parsed.delta;
      } catch (e) {
        if (e.message.startsWith('LM Studio') || e.message.startsWith('Failed')) throw e;
      }
    }
  }
}
