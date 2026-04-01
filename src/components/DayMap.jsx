import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './DayMap.css';

// Fix default marker icons in Leaflet + bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function numberIcon(n) {
  return L.divIcon({
    className: 'day-marker',
    html: `<span>${n}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function FitBounds({ positions }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 0) {
      map.fitBounds(positions, { padding: [40, 40] });
    }
  }, [map, positions]);
  return null;
}

export default function DayMap({ stops, legs }) {
  const positions = stops
    .filter(s => s.lat && s.lng)
    .map(s => [s.lat, s.lng]);

  if (positions.length === 0) return null;

  const center = positions[0];

  return (
    <div className="day-map-wrap">
      <MapContainer center={center} zoom={13} className="day-map" scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds positions={positions} />
        {stops.map((stop, i) => (
          stop.lat && stop.lng ? (
            <Marker key={i} position={[stop.lat, stop.lng]} icon={numberIcon(i + 1)}>
              <Popup>
                <strong>{stop.title}</strong>
                {stop.address && <br />}
                {stop.address && <small>{stop.address}</small>}
              </Popup>
            </Marker>
          ) : null
        ))}
        {positions.length > 1 && (
          <Polyline
            positions={positions}
            color="#12100e"
            weight={2}
            dashArray="6 4"
            opacity={0.5}
          />
        )}
      </MapContainer>

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
