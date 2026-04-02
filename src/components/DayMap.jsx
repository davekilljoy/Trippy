import { useEffect, useRef, useMemo, useCallback } from 'react';
import { Map, Marker, useMap } from '@vis.gl/react-google-maps';
import './DayMap.css';

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

// Draw polylines on the map — uses encoded polylines if available, falls back to straight lines
function RoutePolylines({ legs, positions }) {
  const map = useMap();
  const polylinesRef = useRef([]);

  useEffect(() => {
    if (!map) return;

    // Clear old polylines
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];

    const hasEncodedPolylines = legs?.some(l => l.polyline);

    if (hasEncodedPolylines) {
      for (const leg of legs) {
        if (!leg.polyline) continue;
        const path = decodePolyline(leg.polyline);
        if (!path.length) continue;

        const polyline = new google.maps.Polyline({
          path,
          strokeColor: '#12100e',
          strokeOpacity: 0.6,
          strokeWeight: 3,
          map,
        });
        polylinesRef.current.push(polyline);
      }
    } else if (positions?.length > 1) {
      // Fallback: draw dashed straight lines between stops
      const polyline = new google.maps.Polyline({
        path: positions,
        strokeColor: '#12100e',
        strokeOpacity: 0.4,
        strokeWeight: 2,
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.4, scale: 3 },
          offset: '0',
          repeat: '12px',
        }],
        strokeOpacity: 0,
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

// Create numbered marker icon as a data URL SVG
function numberedIcon(n) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
    <circle cx="14" cy="14" r="13" fill="%2312100e" stroke="%23f2ece0" stroke-width="2"/>
    <text x="14" y="18" text-anchor="middle" fill="%23f2ece0" font-family="monospace" font-size="11" font-weight="bold">${n}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${svg}`;
}

// Hotel marker icon (gold)
function hotelIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
    <circle cx="14" cy="14" r="13" fill="%239a7c3f" stroke="%23f2ece0" stroke-width="2"/>
    <text x="14" y="19" text-anchor="middle" fill="%23f2ece0" font-family="monospace" font-size="13" font-weight="bold">H</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${svg}`;
}

// Destination marker (red — airport or destination hotel)
function destinationIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
    <circle cx="14" cy="14" r="13" fill="%23b5291c" stroke="%23f2ece0" stroke-width="2"/>
    <text x="14" y="19" text-anchor="middle" fill="%23f2ece0" font-family="monospace" font-size="12" font-weight="bold">D</text>
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

      {legs && legs.length > 0 && (
        <div className="day-legs">
          {legs.map((leg, i) => {
            const hasHotel = !!hotel;
            const fromLabel = hasHotel && i === 0 ? 'H' : hasHotel ? i : i + 1;
            const toLabel = hasHotel && i === legs.length - 1 ? 'H' : hasHotel ? i + 1 : i + 2;
            return (
              <div key={i} className={`day-leg ${leg.mode === 'transit' ? 'transit' : ''}`}>
                <span className="leg-num">{fromLabel} → {toLabel}</span>
                <span className="leg-duration">{leg.duration}</span>
                {leg.distance && <span className="leg-distance">{leg.distance}</span>}
                {leg.summary && <span className="leg-summary">{leg.summary}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
