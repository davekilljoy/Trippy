/**
 * Shared geo utilities — single source of truth for distance calculations.
 */

export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius km
  const la1 = Number(lat1), lo1 = Number(lng1), la2 = Number(lat2), lo2 = Number(lng2);
  if (isNaN(la1) || isNaN(lo1) || isNaN(la2) || isNaN(lo2)) return null;
  const dLat = (la2 - la1) * Math.PI / 180;
  const dLng = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(km) {
  if (km == null) return null;
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}

export function formatTravelTime(km) {
  if (km == null) return null;
  const walkMins = Math.round(km / 0.08); // ~5km/h
  const driveMins = Math.round(km / 0.6); // ~36km/h city driving
  if (walkMins <= 20) return `~${Math.max(1, walkMins)} min walk`;
  return `~${Math.max(1, driveMins)} min drive`;
}
