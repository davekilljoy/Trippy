import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Map, Marker, InfoWindow, useMap } from '@vis.gl/react-google-maps';
import './ProximityMap.css';

const CATEGORY_COLORS = {
  attraction: '%2312100e',
  restaurant: '%23b5291c',
  hotel: '%239a7c3f',
  experience: '%235b7a3a',
  transport: '%234a6fa5',
  shopping: '%238b5e9b',
};

const LEGEND_COLORS = {
  attraction: '#12100e',
  restaurant: '#b5291c',
  hotel: '#9a7c3f',
  experience: '#5b7a3a',
  transport: '#4a6fa5',
  shopping: '#8b5e9b',
};

function categoryIcon(category, isAnchor, isStarred) {
  if (isAnchor) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34">
      <circle cx="17" cy="17" r="15" fill="%239a7c3f" stroke="%23f2ece0" stroke-width="2"/>
      <text x="17" y="22" text-anchor="middle" fill="%23f2ece0" font-size="14">★</text>
    </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${svg}`;
  }
  if (isStarred) {
    const fill = CATEGORY_COLORS[category] || '%2312100e';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
      <circle cx="14" cy="14" r="13" fill="${fill}" stroke="%23f2ece0" stroke-width="2"/>
      <text x="14" y="18.5" text-anchor="middle" fill="%23f2ece0" font-size="11">★</text>
    </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${svg}`;
  }
  const fill = CATEGORY_COLORS[category] || '%2312100e';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
    <circle cx="12" cy="12" r="11" fill="${fill}" stroke="%23f2ece0" stroke-width="2"/>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${svg}`;
}

// Auto-fit bounds on initial mount only
function FitBounds({ positions }) {
  const map = useMap();
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!map || positions.length === 0 || fittedRef.current) return;
    fittedRef.current = true;
    const bounds = new google.maps.LatLngBounds();
    positions.forEach(p => bounds.extend(p));
    map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
    const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
      if (map.getZoom() > 16) map.setZoom(16);
    });
    return () => google.maps.event.removeListener(listener);
  }, [map, positions]);
  return null;
}

// Pan + zoom to anchor card when it changes
function PanToAnchor({ anchorCard }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !anchorCard) return;
    const pos = { lat: Number(anchorCard.lat), lng: Number(anchorCard.lng) };
    map.panTo(pos);
    if (map.getZoom() < 14) map.setZoom(14);
  }, [map, anchorCard?.id]);
  return null;
}

const PRICE_LABELS = ['', '$', '$$', '$$$', '$$$$'];

// Map our category filters to Google Maps POI feature types to hide
const CATEGORY_TO_POI_TYPES = {
  restaurant: ['poi.business.food_and_drink'],
  hotel: ['poi.business.lodging'],
  shopping: ['poi.business.shopping'],
  attraction: ['poi.attraction', 'poi.place_of_worship', 'poi.government', 'poi.school'],
  experience: ['poi.sports_complex', 'poi.park'],
  transport: ['transit'],
};

function buildMapStyles(hiddenCategories) {
  if (!hiddenCategories || hiddenCategories.length === 0) return [];

  const styles = [];
  for (const cat of hiddenCategories) {
    const poiTypes = CATEGORY_TO_POI_TYPES[cat] || [];
    for (const type of poiTypes) {
      styles.push(
        { featureType: type, elementType: 'labels', stylers: [{ visibility: 'off' }] },
        { featureType: type, elementType: 'geometry', stylers: [{ visibility: 'off' }] },
      );
    }
  }
  return styles;
}

// Emit viewport bounds + area name on map idle
function ViewportTracker({ onBoundsChange }) {
  const map = useMap();
  const timerRef = useRef(null);
  const geocoderRef = useRef(null);

  useEffect(() => {
    if (!map || !onBoundsChange) return;

    const handler = () => {
      const bounds = map.getBounds();
      if (!bounds) return;
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const centerLat = (ne.lat() + sw.lat()) / 2;
      const centerLng = (ne.lng() + sw.lng()) / 2;
      const boundsObj = {
        north: ne.lat(), south: sw.lat(),
        east: ne.lng(), west: sw.lng(),
        centerLat, centerLng,
      };

      // Debounced reverse geocode for area name
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        try {
          if (!geocoderRef.current) {
            geocoderRef.current = new google.maps.Geocoder();
          }
          const res = await geocoderRef.current.geocode({ location: { lat: centerLat, lng: centerLng } });
          const results = res.results || [];
          // Find locality or sublocality or admin area
          const locality = results.find(r => r.types.includes('locality'))
            || results.find(r => r.types.includes('sublocality'))
            || results.find(r => r.types.includes('administrative_area_level_1'))
            || results.find(r => r.types.includes('postal_town'));
          const areaName = locality
            ? locality.address_components.find(c => c.types.includes('locality'))?.long_name
              || locality.address_components.find(c => c.types.includes('sublocality'))?.long_name
              || locality.address_components.find(c => c.types.includes('administrative_area_level_1'))?.long_name
              || locality.formatted_address.split(',')[0]
            : '';
          onBoundsChange({ ...boundsObj, areaName });
        } catch {
          onBoundsChange({ ...boundsObj, areaName: '' });
        }
      }, 400);
    };

    const listener = google.maps.event.addListener(map, 'idle', handler);
    // Fire once immediately
    handler();
    return () => {
      google.maps.event.removeListener(listener);
      clearTimeout(timerRef.current);
    };
  }, [map, onBoundsChange]);

  return null;
}

function numberedIcon(num) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40">
    <path d="M16 0C7.2 0 0 7.2 0 16c0 12 16 24 16 24s16-12 16-24C32 7.2 24.8 0 16 0z" fill="%239a7c3f"/>
    <circle cx="16" cy="15" r="11" fill="%23f2ece0"/>
    <text x="16" y="19.5" text-anchor="middle" fill="%2312100e" font-size="12" font-weight="700" font-family="sans-serif">${num}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${svg}`;
}

// Fit map to picker ideas when they appear
function FitPickerBounds({ ideas }) {
  const map = useMap();
  const prevCountRef = useRef(0);
  useEffect(() => {
    if (!map || !ideas || ideas.length === 0) { prevCountRef.current = 0; return; }
    const geoIdeas = ideas.filter(i => i.lat && i.lng);
    if (geoIdeas.length === 0) { prevCountRef.current = 0; return; }
    // Only refit when ideas change (new count)
    if (geoIdeas.length === prevCountRef.current) return;
    prevCountRef.current = geoIdeas.length;
    const bounds = new google.maps.LatLngBounds();
    geoIdeas.forEach(i => bounds.extend({ lat: Number(i.lat), lng: Number(i.lng) }));
    map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
  }, [map, ideas]);
  return null;
}

export default function ProximityMap({ cards, anchorId, onSelectAnchor, onAddPlace, hiddenCategories, onBoundsChange, pickerIdeas }) {
  const [poiPlace, setPoiPlace] = useState(null);  // { ...placeData, _pos: {lat, lng} }
  const [poiLoading, setPoiLoading] = useState(null); // {lat, lng} while loading
  const [poiAdding, setPoiAdding] = useState(false);

  const geoCards = useMemo(() => cards.filter(c => c.lat && c.lng), [cards]);
  const anchorCard = anchorId ? geoCards.find(c => c.id === anchorId) : null;

  // Existing place_ids to detect duplicates
  const existingPlaceIds = useMemo(() => new Set(cards.map(c => c.place_id).filter(Boolean)), [cards]);

  const handleMapClick = useCallback(async (event) => {
    const { placeId, latLng } = event.detail;
    if (!placeId) {
      setPoiPlace(null);
      setPoiLoading(null);
      return;
    }
    event.stop(); // Prevent default Google info window

    const pos = latLng || { lat: 0, lng: 0 };
    setPoiLoading(pos);
    setPoiPlace(null);
    try {
      const res = await fetch(`/api/places/detail?place_id=${placeId}`);
      if (!res.ok) throw new Error();
      const place = await res.json();
      setPoiPlace({ ...place, _pos: { lat: place.lat || pos.lat, lng: place.lng || pos.lng } });
    } catch {
      setPoiPlace(null);
    } finally {
      setPoiLoading(null);
    }
  }, []);

  const handleAddPlace = useCallback(async () => {
    if (!poiPlace || !onAddPlace) return;
    setPoiAdding(true);
    try {
      await onAddPlace(poiPlace);
      setPoiPlace(null);
    } finally {
      setPoiAdding(false);
    }
  }, [poiPlace, onAddPlace]);

  const positions = useMemo(
    () => geoCards.map(c => ({ lat: Number(c.lat), lng: Number(c.lng) })),
    [geoCards],
  );

  // Categories present in the current set
  const categories = useMemo(() => {
    const cats = new Set(geoCards.map(c => c.category).filter(Boolean));
    return Object.keys(LEGEND_COLORS).filter(c => cats.has(c));
  }, [geoCards]);

  const center = positions.length > 0 ? positions[0] : { lat: 35.68, lng: 139.76 };

  if (geoCards.length === 0 && (!pickerIdeas || pickerIdeas.length === 0)) {
    return (
      <div className="prox-empty">
        <p>No cards with locations to show on the map.</p>
      </div>
    );
  }

  return (
    <div className="prox-wrap">
      <div className="prox-map-container">
      <Map
        defaultCenter={center}
        defaultZoom={13}
        className="prox-map"
        gestureHandling="greedy"
        disableDefaultUI={true}
        zoomControl={true}
        onClick={handleMapClick}
        styles={buildMapStyles(hiddenCategories)}
      >
        <FitBounds positions={positions} />
        <PanToAnchor anchorCard={anchorCard} />
        <ViewportTracker onBoundsChange={onBoundsChange} />

        {geoCards.map(card => {
          const isAnchor = card.id === anchorId;
          const isStarred = !!card.starred;
          const dimmed = (anchorId && !isAnchor) || (pickerIdeas && pickerIdeas.length > 0);
          const size = isAnchor ? 34 : isStarred ? 28 : 24;
          return (
            <Marker
              key={card.id}
              position={{ lat: Number(card.lat), lng: Number(card.lng) }}
              title={card.title}
              onClick={() => onSelectAnchor(card.id)}
              opacity={dimmed && !isStarred ? 0.35 : 1}
              zIndex={isAnchor ? 900 : isStarred ? 800 : 1}
              icon={{
                url: categoryIcon(card.category, isAnchor, isStarred),
                scaledSize: { width: size, height: size },
                anchor: { x: size / 2, y: size / 2 },
              }}
            />
          );
        })}

        {/* Numbered markers for picker ideas */}
        {pickerIdeas && <FitPickerBounds ideas={pickerIdeas} />}
        {pickerIdeas && pickerIdeas.map((idea, i) => {
          if (!idea.lat || !idea.lng) return null;
          return (
            <Marker
              key={`picker-${i}`}
              position={{ lat: Number(idea.lat), lng: Number(idea.lng) }}
              title={`${i + 1}. ${idea.title}`}
              icon={{
                url: numberedIcon(i + 1),
                scaledSize: { width: 32, height: 40 },
                anchor: { x: 16, y: 40 },
              }}
              zIndex={1000 + i}
            />
          );
        })}

        {/* Loading InfoWindow */}
        {poiLoading && (
          <InfoWindow
            position={poiLoading}
            onCloseClick={() => setPoiLoading(null)}
            headerDisabled={true}
          >
            <div className="poi-card poi-card--loading">Loading place...</div>
          </InfoWindow>
        )}

        {/* POI detail InfoWindow */}
        {poiPlace && !poiLoading && (
          <InfoWindow
            position={poiPlace._pos}
            onCloseClick={() => setPoiPlace(null)}
            headerDisabled={true}
          >
            <div className="poi-card">
              {poiPlace.image_url && (
                <img src={poiPlace.image_url} alt="" className="poi-img" />
              )}
              <div className="poi-body">
                <div className="poi-header">
                  <span className="poi-name">{poiPlace.name}</span>
                  {poiPlace.rating && <span className="poi-rating">{poiPlace.rating}★</span>}
                  {poiPlace.price_level > 0 && (
                    <span className="poi-price">{PRICE_LABELS[poiPlace.price_level]}</span>
                  )}
                </div>
                {poiPlace.address && <span className="poi-addr">{poiPlace.address}</span>}
                {poiPlace.summary && <span className="poi-summary">{poiPlace.summary}</span>}
                {existingPlaceIds.has(poiPlace.place_id) ? (
                  <span className="poi-exists">Already on board</span>
                ) : (
                  <button className="poi-add-btn" onClick={handleAddPlace} disabled={poiAdding}>
                    {poiAdding ? 'Adding...' : '+ Add to Board'}
                  </button>
                )}
              </div>
            </div>
          </InfoWindow>
        )}
      </Map>
      </div>

      {categories.length > 0 && (
        <div className="prox-legend">
          {categories.map(cat => (
            <span key={cat} className="prox-legend-item">
              <span className="prox-legend-dot" style={{ background: LEGEND_COLORS[cat] }} />
              {cat}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
