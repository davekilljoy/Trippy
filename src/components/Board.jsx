import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import IdeaCard from './IdeaCard.jsx';
import ProximityMap from './ProximityMap.jsx';
import { haversine, formatDistance, formatTravelTime } from '../lib/geo.js';
import './Board.css';

const CATEGORIES = ['attraction', 'restaurant', 'hotel', 'experience', 'transport', 'shopping'];

export default function Board({ cards, approvedCount, totalCount, onAdd, onAddPlace, onEdit, onDelete, onApprove, onAnchorChange }) {
  const [disabledCats, setDisabledCats] = useState(new Set());
  const [showMap, setShowMap] = useState(true);
  const [anchorId, setAnchorId] = useState(null);
  const [radiusKm, setRadiusKm] = useState(1.5);
  const [nearOpen, setNearOpen] = useState(false);
  const nearRef = useRef(null);

  // Notify parent of anchor changes
  useEffect(() => {
    if (!onAnchorChange) return;
    const card = anchorId ? cards.find(c => c.id === anchorId) : null;
    onAnchorChange(card || null);
  }, [anchorId, cards, onAnchorChange]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!nearOpen) return;
    const handler = (e) => {
      if (nearRef.current && !nearRef.current.contains(e.target)) setNearOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [nearOpen]);

  // Cards with coordinates for the Near dropdown
  const geoCards = useMemo(() => cards.filter(c => c.lat && c.lng), [cards]);

  // Category toggle filter
  const catFiltered = disabledCats.size === 0
    ? cards
    : cards.filter(c => !disabledCats.has(c.category));

  const toggleCat = useCallback((cat) => {
    setDisabledCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // Which single filter is active (for map POI styling) — only when exactly one category is enabled
  const activeFilter = useMemo(() => {
    const enabled = CATEGORIES.filter(c => !disabledCats.has(c));
    return enabled.length === 1 ? enabled[0] : 'all';
  }, [disabledCats]);

  const anchorCard = anchorId ? cards.find(c => c.id === anchorId) : null;

  // Compute distances, then filter by radius + sort
  const displayCards = useMemo(() => {
    if (!anchorCard || !anchorCard.lat || !anchorCard.lng) {
      return catFiltered.map(c => ({ ...c, _dist: null }));
    }

    const withDist = catFiltered.map(c => {
      if (c.id === anchorCard.id) return { ...c, _dist: -1 };
      if (!c.lat || !c.lng) return { ...c, _dist: null };
      return { ...c, _dist: haversine(anchorCard.lat, anchorCard.lng, c.lat, c.lng) };
    });

    // Filter by radius (keep anchor, drop cards outside radius or without coords)
    const inRadius = withDist.filter(c =>
      c._dist === -1 || (c._dist != null && c._dist <= radiusKm)
    );

    return inRadius.sort((a, b) => {
      if (a._dist === -1) return -1;
      if (b._dist === -1) return 1;
      return a._dist - b._dist;
    });
  }, [catFiltered, anchorCard, radiusKm]);

  const handleSelectAnchor = useCallback((cardId) => {
    setAnchorId(prev => prev === cardId ? null : cardId);
    setNearOpen(false);
  }, []);

  const handleToggleMap = useCallback(() => {
    setShowMap(m => !m);
  }, []);

  const handleClearNear = useCallback(() => {
    setAnchorId(null);
    setNearOpen(false);
  }, []);

  const renderCards = () => (
    displayCards.map(card => {
      const dist = card._dist != null && card._dist > 0 ? card._dist : null;
      const badge = dist != null ? `${formatDistance(dist)} · ${formatTravelTime(dist)}` : null;
      const canAnchor = card.lat && card.lng;
      return (
        <div
          key={card.id}
          className={canAnchor ? 'map-card-clickable' : ''}
          onClick={canAnchor ? (e) => {
            if (e.target.closest('button, a, .card-menu')) return;
            handleSelectAnchor(card.id);
          } : undefined}
        >
          <IdeaCard
            card={card}
            onEdit={() => onEdit(card)}
            onDelete={() => onDelete(card.id)}
            onApprove={(person) => onApprove(card.id, person)}
            distanceBadge={badge}
            isAnchor={card.id === anchorId}
          />
        </div>
      );
    })
  );

  return (
    <div className={`board ${showMap ? 'board--with-map' : ''}`}>
      <div className="board-toolbar">
        <div className="filter-pills">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`pill ${disabledCats.has(cat) ? '' : 'active'}`}
              onClick={() => toggleCat(cat)}
            >
              {cat}
            </button>
          ))}

          {/* Near filter */}
          <div className="near-filter" ref={nearRef}>
            <button
              className={`pill pill-near ${anchorId ? 'active' : ''}`}
              onClick={() => anchorId ? handleClearNear() : setNearOpen(o => !o)}
            >
              {anchorCard
                ? <>Near {anchorCard.title.length > 18 ? anchorCard.title.slice(0, 18) + '…' : anchorCard.title}</>
                : 'Near'
              }
              {anchorId && <span className="near-clear" onClick={(e) => { e.stopPropagation(); handleClearNear(); }}> ×</span>}
            </button>

            {anchorId && (
              <div className="near-radius">
                <input
                  type="range"
                  min={0.3}
                  max={10}
                  step={0.1}
                  value={radiusKm}
                  onChange={e => setRadiusKm(Number(e.target.value))}
                  className="near-slider"
                />
                <span className="near-radius-label">{radiusKm.toFixed(1)}km</span>
              </div>
            )}

            {nearOpen && !anchorId && (
              <div className="near-dropdown">
                <div className="near-dropdown-title">Select anchor place</div>
                {geoCards.map(c => (
                  <button
                    key={c.id}
                    className="near-dropdown-item"
                    onClick={() => handleSelectAnchor(c.id)}
                  >
                    <span className="near-dropdown-name">{c.title}</span>
                    <span className="near-dropdown-cat">{c.category}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="board-actions">
          <button
            className={`pill pill-map ${showMap ? 'active' : ''}`}
            onClick={handleToggleMap}
          >
            Map
          </button>
          <button className="add-btn" onClick={onAdd}>+ Add Idea</button>
        </div>
      </div>

      {displayCards.length === 0 ? (
        <div className="board-empty">
          <p>{anchorId ? 'No places within this radius.' : disabledCats.size > 0 ? 'No ideas match these filters.' : 'No ideas yet. Add your first one!'}</p>
        </div>
      ) : showMap ? (
        <div className="board-map-layout">
          <div className="board-cards-panel">
            <div className="masonry masonry--map-mode">
              {renderCards()}
            </div>
          </div>
          <div className="board-map-panel">
            <ProximityMap
              cards={catFiltered}
              anchorId={anchorId}
              onSelectAnchor={handleSelectAnchor}
              onAddPlace={onAddPlace}
              activeFilter={activeFilter}
            />
          </div>
        </div>
      ) : (
        <div className="masonry">
          {renderCards()}
        </div>
      )}
    </div>
  );
}
