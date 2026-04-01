import { useEffect, useRef, useMemo } from 'react';
import { Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
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

// Draw polylines on the map
function RoutePolylines({ legs }) {
  const map = useMap();
  const polylinesRef = useRef([]);

  useEffect(() => {
    if (!map || !legs?.length) return;

    // Clear old polylines
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];

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

    return () => {
      polylinesRef.current.forEach(p => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, legs]);

  return null;
}

// Auto-fit bounds to show all stops
function FitBounds({ positions }) {
  const map = useMap();
  useEffect(() => {
    if (!map || positions.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    positions.forEach(p => bounds.extend(p));
    map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
  }, [map, positions]);
  return null;
}

export default function DayMap({ stops, legs }) {
  const positions = useMemo(() =>
    stops
      .filter(s => s.lat && s.lng)
      .map(s => ({ lat: s.lat, lng: s.lng })),
    [stops]
  );

  if (positions.length === 0) return null;

  const center = positions[0];

  return (
    <div className="day-map-wrap">
      <Map
        defaultCenter={center}
        defaultZoom={13}
        className="day-map"
        gestureHandling="cooperative"
        disableDefaultUI={true}
        zoomControl={true}
        mapId="trippy-day-map"
        styles={[
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
        ]}
      >
        <FitBounds positions={positions} />
        <RoutePolylines legs={legs} />
        {stops.map((stop, i) => (
          stop.lat && stop.lng ? (
            <AdvancedMarker key={stop.id || i} position={{ lat: stop.lat, lng: stop.lng }}>
              <div className="day-marker">
                <span>{i + 1}</span>
              </div>
            </AdvancedMarker>
          ) : null
        ))}
      </Map>

      {legs && legs.length > 0 && (
        <div className="day-legs">
          {legs.map((leg, i) => (
            <div key={i} className="day-leg">
              <span className="leg-num">{i + 1} → {i + 2}</span>
              <span className="leg-duration">{leg.duration}</span>
              <span className="leg-distance">{leg.distance}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
