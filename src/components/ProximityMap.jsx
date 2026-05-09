import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Map, Marker, InfoWindow, useMap } from '@vis.gl/react-google-maps';
import './ProximityMap.css';

function themeColors() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return {
    ink: '%23e8e1d3', paper: '%231a1816', accent: '%23bf9f5e',
    stroke: '%231a1816',
    inkHex: '#e8e1d3', accentHex: '#bf9f5e',
  };
  if (t === 'minimal') return {
    ink: '%231c1d20', paper: '%23ece9e1', accent: '%237a6745',
    stroke: '%23ece9e1',
    inkHex: '#1c1d20', accentHex: '#7a6745',
  };
  return {
    ink: '%2312100e', paper: '%23f2ece0', accent: '%239a7c3f',
    stroke: '%23f2ece0',
    inkHex: '#12100e', accentHex: '#9a7c3f',
  };
}

const POI_COLORS = {
  attraction: '%2312100e',
  restaurant: '%23b5291c',
  experience: '%235b7a3a',
  transport: '%234a6fa5',
  shopping: '%238b5e9b',
};

const POI_COLORS_DARK = {
  attraction: '%234a4a5a',
  restaurant: '%23b5291c',
  experience: '%235b7a3a',
  transport: '%234a6fa5',
  shopping: '%238b5e9b',
};

const POI_LEGEND = {
  attraction: '#12100e',
  restaurant: '#b5291c',
  experience: '#5b7a3a',
  transport: '#4a6fa5',
  shopping: '#8b5e9b',
};

const POI_LEGEND_DARK = {
  attraction: '#4a4a5a',
  restaurant: '#b5291c',
  experience: '#5b7a3a',
  transport: '#4a6fa5',
  shopping: '#8b5e9b',
};

function getCategoryColors() {
  const t = themeColors();
  const isDark = document.documentElement.dataset.theme === 'dark';
  return { ...(isDark ? POI_COLORS_DARK : POI_COLORS), hotel: t.accent };
}

function getLegendColors() {
  const t = themeColors();
  const isDark = document.documentElement.dataset.theme === 'dark';
  return { ...(isDark ? POI_LEGEND_DARK : POI_LEGEND), hotel: t.accentHex };
}

// Simplified SVG path data for category icons (from Lucide, 24x24 viewBox)
const CAT_SVG_PATHS = {
  attraction: '<path d="M10 18v-7"/><path d="M11.12 2.198a2 2 0 0 1 1.76.006l7.866 3.847c.476.233.31.949-.22.949H3.474c-.53 0-.695-.716-.22-.949z"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M2 18h20"/><path d="M6 18v-7"/><rect x="2" y="18" width="20" height="4" rx="1"/>',
  restaurant: '<path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8"/><path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7"/><path d="m2.1 21.8 6.4-6.3"/><path d="m19 5-7 7"/>',
  hotel: '<path d="M10 22v-6.57"/><path d="M12 11h.01"/><path d="M12 7h.01"/><path d="M14 15.43V22"/><path d="M15 16a5 5 0 0 0-6 0"/><path d="M16 11h.01"/><path d="M16 7h.01"/><path d="M8 11h.01"/><path d="M8 7h.01"/><rect x="4" y="2" width="16" height="20" rx="2"/>',
  experience: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>',
  transport: '<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/>',
  shopping: '<path d="M16 10a4 4 0 0 1-8 0"/><path d="M3.103 6.034h17.794"/><path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z"/>',
};

function categoryIcon(category, isAnchor, isStarred) {
  const t = themeColors();
  const catColors = getCategoryColors();
  const iconPath = CAT_SVG_PATHS[category] || '';
  const iconStroke = '%23ffffff';
  if (isAnchor) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34">
      <rect x="1" y="1" width="32" height="32" rx="7" fill="${t.accent}" stroke="${t.stroke}" stroke-width="2"/>
      <g transform="translate(7,7) scale(0.833)" fill="none" stroke="${iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</g>
    </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${svg}`;
  }
  if (isStarred) {
    const fill = catColors[category] || t.ink;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
      <rect x="1" y="1" width="26" height="26" rx="6" fill="${fill}" stroke="${t.stroke}" stroke-width="2"/>
      <g transform="translate(5,5) scale(0.75)" fill="none" stroke="${iconStroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${iconPath}</g>
    </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${svg}`;
  }
  const fill = catColors[category] || t.ink;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22">
    <rect x="1" y="1" width="20" height="20" rx="5" fill="${fill}" stroke="${t.stroke}" stroke-width="2"/>
    <g transform="translate(4,4) scale(0.583)" fill="none" stroke="${iconStroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${iconPath}</g>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${svg}`;
}

// Auto-fit bounds on initial mount only.
// `bottomInsetPx` reserves space at the bottom of the viewport (e.g. for a sheet
// that overlays the map) so all positions land in the visible-to-user area.
function FitBounds({ positions, bottomInsetPx = 0 }) {
  const map = useMap();
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!map || positions.length === 0 || fittedRef.current) return;
    fittedRef.current = true;
    const bounds = new google.maps.LatLngBounds();
    positions.forEach(p => bounds.extend(p));
    map.fitBounds(bounds, { top: 40, right: 40, bottom: 40 + bottomInsetPx, left: 40 });
    const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
      if (map.getZoom() > 16) map.setZoom(16);
    });
    return () => google.maps.event.removeListener(listener);
  }, [map, positions, bottomInsetPx]);
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

// Clean base: hide road icons/signs, transit labels, and non-POI clutter
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
  { elementType: 'geometry', stylers: [{ color: '#1a1816' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1816' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#807868' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#2c2825' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c2825' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a1816' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#36322d' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#6e6659' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f0d0b' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5a5249' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#23201c' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#807868' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1f2218' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#23201c' }] },
];

function buildMapStyles(hiddenCategories, showPois = true) {
  const isDark = document.documentElement.dataset.theme === 'dark';
  const styles = isDark ? [...DARK_MAP_STYLES] : [...CLEAN_MAP_STYLES];

  if (!showPois) {
    styles.push(
      { featureType: 'poi', stylers: [{ visibility: 'off' }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    );
    return styles;
  }

  if (hiddenCategories && hiddenCategories.length > 0) {
    for (const cat of hiddenCategories) {
      const poiTypes = CATEGORY_TO_POI_TYPES[cat] || [];
      for (const type of poiTypes) {
        styles.push(
          { featureType: type, elementType: 'labels', stylers: [{ visibility: 'off' }] },
          { featureType: type, elementType: 'geometry', stylers: [{ visibility: 'off' }] },
        );
      }
    }
  }
  return styles;
}

// Emit viewport bounds + area name on map idle.
// `bottomInsetPx` shrinks the reported southern boundary so cards hidden behind
// an overlay (e.g. mobile bottom sheet) aren't counted as "in view".
function ViewportTracker({ onBoundsChange, bottomInsetPx = 0 }) {
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

      // Crop the bottom of the bounds rectangle by the inset (linear-lat
      // approximation; precision is fine at city scale).
      let southAdjusted = sw.lat();
      if (bottomInsetPx > 0) {
        const totalH = map.getDiv()?.offsetHeight || 0;
        if (totalH > 0) {
          const insetFrac = Math.min(0.9, bottomInsetPx / totalH);
          const latRange = ne.lat() - sw.lat();
          southAdjusted = sw.lat() + latRange * insetFrac;
        }
      }

      const centerLat = (ne.lat() + southAdjusted) / 2;
      const centerLng = (ne.lng() + sw.lng()) / 2;
      const boundsObj = {
        north: ne.lat(), south: southAdjusted,
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
  }, [map, onBoundsChange, bottomInsetPx]);

  return null;
}

function numberedIcon(num) {
  const t = themeColors();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30">
    <rect x="1" y="1" width="28" height="28" rx="6" fill="${t.accent}" stroke="${t.stroke}" stroke-width="2"/>
    <circle cx="15" cy="15" r="10" fill="${t.paper}"/>
    <text x="15" y="19.5" text-anchor="middle" fill="${t.ink}" font-size="12" font-weight="700" font-family="sans-serif">${num}</text>
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

export default function ProximityMap({ cards, anchorId, onSelectAnchor, onAddPlace, hiddenCategories, showPois = true, onBoundsChange, pickerIdeas, bottomInsetPx = 0 }) {
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
  const legendColors = getLegendColors();
  const categories = useMemo(() => {
    const cats = new Set(geoCards.map(c => c.category).filter(Boolean));
    return Object.keys(legendColors).filter(c => cats.has(c));
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
        styles={buildMapStyles(hiddenCategories, showPois)}
      >
        <FitBounds positions={positions} bottomInsetPx={bottomInsetPx} />
        <PanToAnchor anchorCard={anchorCard} />
        <ViewportTracker onBoundsChange={onBoundsChange} bottomInsetPx={bottomInsetPx} />

        {geoCards.map(card => {
          const isAnchor = card.id === anchorId;
          const isStarred = !!card.starred;
          const dimmed = (anchorId && !isAnchor) || (pickerIdeas && pickerIdeas.length > 0);
          const size = isAnchor ? 34 : isStarred ? 28 : 22;
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
                scaledSize: { width: 30, height: 30 },
                anchor: { x: 15, y: 15 },
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
              <span className="prox-legend-dot" style={{ background: legendColors[cat] }} />
              {cat}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
