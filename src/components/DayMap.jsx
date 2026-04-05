import { useEffect, useRef, useMemo, useCallback } from 'react';
import { Map, Marker, useMap } from '@vis.gl/react-google-maps';
import './DayMap.css';

const CLEAN_MAP_STYLES = [
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels', stylers: [{ visibility: 'off' }] },
];

const DARK_MAP_STYLES = [
  ...CLEAN_MAP_STYLES,
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8888a0' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#2a2a40' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#252540' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2d2d50' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#6a6a80' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e0e1a' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4a4a60' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#1e1e35' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#7a7a90' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1a2e1a' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#1e1e35' }] },
];

function themeColors() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return {
    ink: '%23e4e4e7', paper: '%230f0f11', accent: '%23a78bfa',
    inkHex: '#e4e4e7', accentHex: '#a78bfa',
  };
  if (t === 'minimal') return {
    ink: '%23111111', paper: '%23ffffff', accent: '%235b21b6',
    inkHex: '#111111', accentHex: '#5b21b6',
  };
  return {
    ink: '%2312100e', paper: '%23f2ece0', accent: '%239a7c3f',
    inkHex: '#12100e', accentHex: '#9a7c3f',
  };
}

// Decode Google encoded polyline to array of {lat, lng}
function decodePolyline(encoded) {
  if (!encoded) return [];
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

// Flatten legs into individual route objects for polyline drawing
function flattenRoutes(legs) {
  const routes = [];
  if (!legs) return routes;
  for (const leg of legs) {
    // New format: leg.routes is an array of route options
    if (leg.routes) {
      for (const r of leg.routes) routes.push(r);
    } else if (leg.polyline) {
      // Old format: leg itself is a route
      routes.push(leg);
    }
  }
  return routes;
}

// Draw polylines on the map — walking routes solid, transit/driving dashed
function RoutePolylines({ legs, positions }) {
  const map = useMap();
  const polylinesRef = useRef([]);

  useEffect(() => {
    if (!map) return;

    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];

    const allRoutes = flattenRoutes(legs);
    const hasPolylines = allRoutes.some(r => r.polyline);

    if (hasPolylines) {
      for (const route of allRoutes) {
        if (!route.polyline) continue;
        const path = decodePolyline(route.polyline);
        if (!path.length) continue;

        const isWalking = route.mode === 'walking';
        const tc = themeColors();
        const polyline = isWalking
          ? new google.maps.Polyline({
              path,
              strokeColor: tc.inkHex,
              strokeOpacity: 0.6,
              strokeWeight: 3,
              map,
            })
          : new google.maps.Polyline({
              path,
              strokeColor: tc.accentHex,
              strokeOpacity: 0,
              strokeWeight: 2,
              icons: [{
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.5, scale: 3 },
                offset: '0',
                repeat: '12px',
              }],
              map,
            });
        polylinesRef.current.push(polyline);
      }
    } else if (positions?.length > 1) {
      const tc = themeColors();
      const polyline = new google.maps.Polyline({
        path: positions,
        strokeColor: tc.inkHex,
        strokeOpacity: 0,
        strokeWeight: 2,
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.4, scale: 3 },
          offset: '0',
          repeat: '12px',
        }],
        map,
      });
      polylinesRef.current.push(polyline);
    }

    return () => {
      polylinesRef.current.forEach(p => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, legs, positions]);

  return null;
}

// Auto-fit bounds to show all stops
function FitBounds({ positions }) {
  const map = useMap();
  const posKey = positions.map(p => `${p.lat},${p.lng}`).join('|');
  useEffect(() => {
    if (!map || positions.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    positions.forEach(p => bounds.extend(p));
    map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
    // Prevent over-zoom on single point
    const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
      if (map.getZoom() > 15) map.setZoom(15);
    });
    return () => google.maps.event.removeListener(listener);
  }, [map, posKey]);
  return null;
}

function numberedIcon(n) {
  const t = themeColors();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
    <circle cx="14" cy="14" r="13" fill="${t.ink}" stroke="${t.paper}" stroke-width="2"/>
    <text x="14" y="18" text-anchor="middle" fill="${t.paper}" font-family="monospace" font-size="11" font-weight="bold">${n}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${svg}`;
}

function hotelIcon() {
  const t = themeColors();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
    <circle cx="14" cy="14" r="13" fill="${t.accent}" stroke="${t.paper}" stroke-width="2"/>
    <text x="14" y="19" text-anchor="middle" fill="${t.paper}" font-family="monospace" font-size="13" font-weight="bold">H</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${svg}`;
}

function destinationIcon() {
  const t = themeColors();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
    <circle cx="14" cy="14" r="13" fill="%23b5291c" stroke="${t.paper}" stroke-width="2"/>
    <text x="14" y="19" text-anchor="middle" fill="${t.paper}" font-family="monospace" font-size="12" font-weight="bold">D</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${svg}`;
}

export default function DayMap({ stops, legs, hotel, waypoints = [] }) {
  const positions = useMemo(() =>
    stops
      .filter(s => s.lat && s.lng)
      .map(s => ({ lat: Number(s.lat), lng: Number(s.lng) })),
    [stops]
  );

  // Include hotel + all waypoints (origin, destination, airport) in bounds fitting
  const allPositions = useMemo(() => {
    const pts = [...positions];
    if (hotel?.lat && hotel?.lng) pts.push({ lat: Number(hotel.lat), lng: Number(hotel.lng) });
    for (const wp of waypoints) {
      if (wp.lat && wp.lng) pts.push({ lat: Number(wp.lat), lng: Number(wp.lng) });
    }
    return pts;
  }, [positions, hotel, waypoints]);

  // Separate out destination waypoints (not the origin hotel — that's already rendered)
  const destinationWaypoints = useMemo(() =>
    waypoints.filter(wp => wp.type === 'destination' && wp.lat && wp.lng),
    [waypoints]
  );

  if (allPositions.length === 0) return null;

  const center = hotel?.lat ? { lat: Number(hotel.lat), lng: Number(hotel.lng) } : allPositions[0];

  return (
    <div className="day-map-wrap">
      <Map
        defaultCenter={center}
        defaultZoom={13}
        className="day-map"
        gestureHandling="cooperative"
        disableDefaultUI={true}
        zoomControl={true}
        styles={document.documentElement.dataset.theme === 'dark' ? DARK_MAP_STYLES : CLEAN_MAP_STYLES}
      >
        <FitBounds positions={allPositions} />
        <RoutePolylines legs={legs} positions={allPositions} />

        {/* Hotel marker */}
        {hotel?.lat && hotel?.lng && (
          <Marker
            key="hotel"
            position={{ lat: Number(hotel.lat), lng: Number(hotel.lng) }}
            title={hotel.title || 'Hotel'}
            icon={{
              url: hotelIcon(),
              scaledSize: { width: 28, height: 28 },
              anchor: { x: 14, y: 14 },
            }}
          />
        )}

        {/* Stop markers */}
        {stops.map((stop, i) => (
          stop.lat && stop.lng ? (
            <Marker
              key={stop.id || i}
              position={{ lat: Number(stop.lat), lng: Number(stop.lng) }}
              title={stop.title || `Stop ${i + 1}`}
              icon={{
                url: numberedIcon(i + 1),
                scaledSize: { width: 28, height: 28 },
                anchor: { x: 14, y: 14 },
              }}
            />
          ) : null
        ))}

        {/* Destination markers (destination hotel, airport) */}
        {destinationWaypoints.map((wp, i) => (
          <Marker
            key={`dest-${i}`}
            position={{ lat: Number(wp.lat), lng: Number(wp.lng) }}
            title={wp.name}
            icon={{
              url: destinationIcon(),
              scaledSize: { width: 28, height: 28 },
              anchor: { x: 14, y: 14 },
            }}
          />
        ))}
      </Map>

    </div>
  );
}
