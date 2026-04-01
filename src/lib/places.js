let debounceTimer = null;

export async function searchPlaces(query) {
  if (!query || query.length < 2) return [];
  try {
    const res = await fetch(`/api/places/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch { return []; }
}

export function debouncedSearch(query, callback, delay = 350) {
  clearTimeout(debounceTimer);
  if (!query || query.length < 2) {
    callback([]);
    return;
  }
  debounceTimer = setTimeout(async () => {
    const results = await searchPlaces(query);
    callback(results);
  }, delay);
}

const TYPE_MAP = {
  restaurant: ['restaurant', 'cafe', 'food', 'bakery', 'bar', 'meal_delivery', 'meal_takeaway'],
  hotel: ['lodging', 'hotel', 'guest_house'],
  transport: ['transit_station', 'train_station', 'bus_station', 'airport', 'subway_station'],
  shopping: ['shopping_mall', 'store', 'clothing_store', 'department_store', 'market'],
  attraction: ['tourist_attraction', 'museum', 'park', 'place_of_worship', 'art_gallery', 'castle'],
  experience: ['amusement_park', 'spa', 'gym', 'aquarium', 'zoo', 'stadium', 'bowling_alley'],
};

export function inferCategory(place) {
  const types = place.types || [];
  for (const [cat, keywords] of Object.entries(TYPE_MAP)) {
    if (types.some(t => keywords.includes(t))) return cat;
  }
  return null;
}
