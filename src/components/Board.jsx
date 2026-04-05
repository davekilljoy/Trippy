import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Star, X, Landmark, UtensilsCrossed, Hotel, Sparkles, TrainFront, ShoppingBag, MapPin, LayoutGrid, List } from 'lucide-react';

const CATEGORY_ICONS = {
  attraction: Landmark,
  restaurant: UtensilsCrossed,
  hotel: Hotel,
  experience: Sparkles,
  transport: TrainFront,
  shopping: ShoppingBag,
};
import IdeaCard from './IdeaCard.jsx';
import ProximityMap from './ProximityMap.jsx';
import { haversine, formatDistance, formatTravelTime } from '../lib/geo.js';
import './Board.css';

const CATEGORIES = ['attraction', 'restaurant', 'hotel', 'experience', 'shopping'];

const CATEGORY_COLORS = {
  attraction: 'var(--cat-attraction)',
  restaurant: '#b5291c',
  hotel: 'var(--accent)',
  experience: '#5b7a3a',
  shopping: '#8b5e9b',
};

function useIsMobile(breakpoint = 700) {
  const [mobile, setMobile] = useState(() => window.innerWidth <= breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e) => setMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return mobile;
}

export default function Board({ cards, onAdd, onAddPlace, onEdit, onDelete, onStar, onAnchorChange, onShowMapChange, onBoundsChange, pickerIdeas }) {
  const isMobile = useIsMobile();
  const [disabledCats, setDisabledCats] = useState(new Set());
  const [starredOnly, setStarredOnly] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [listView, setListView] = useState(false);
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

  // Notify parent of map visibility
  useEffect(() => {
    onShowMapChange?.(showMap);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Category + starred filter
  const catFiltered = cards.filter(c => {
    if (disabledCats.size > 0 && disabledCats.has(c.category)) return false;
    if (starredOnly && !c.starred) return false;
    return true;
  });

  const toggleCat = useCallback((cat) => {
    setDisabledCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // Pass disabled categories to map for POI styling
  const disabledCatsArray = useMemo(() => [...disabledCats], [disabledCats]);

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
    setShowMap(m => {
      const next = !m;
      onShowMapChange?.(next);
      return next;
    });
  }, [onShowMapChange]);

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
            onStar={() => onStar(card.id)}
            distanceBadge={badge}
            isAnchor={card.id === anchorId}
          />
        </div>
      );
    })
  );

  const renderList = () => (
    displayCards.map(card => {
      const dist = card._dist != null && card._dist > 0 ? card._dist : null;
      const badge = dist != null ? `${formatDistance(dist)} · ${formatTravelTime(dist)}` : null;
      const CatIcon = CATEGORY_ICONS[card.category] || MapPin;
      const canAnchor = card.lat && card.lng;
      return (
        <div
          key={card.id}
          className={`list-row ${card.id === anchorId ? 'list-row--anchor' : ''} ${canAnchor ? 'map-card-clickable' : ''}`}
          onClick={canAnchor ? (e) => {
            if (e.target.closest('button')) return;
            handleSelectAnchor(card.id);
          } : undefined}
        >
          {card.image_url
            ? <img src={card.image_url} alt="" className="list-row-img" />
            : <span className="list-row-img list-row-img--placeholder"><CatIcon size={16} /></span>
          }
          <div className="list-row-info">
            <div className="list-row-top">
              <span className="list-row-title">{card.title}</span>
              <span className="list-row-cat"><CatIcon size={12} /></span>
              {card.rating && <span className="list-row-rating">{card.rating}★</span>}
              {badge && <span className="list-row-dist">{badge}</span>}
            </div>
            {card.address && <span className="list-row-addr">{card.address}</span>}
            {card.description && <span className="list-row-desc">{card.description}</span>}
            {card.timing && <span className="list-row-timing">{card.timing}</span>}
          </div>
          <button
            className="list-row-star"
            onClick={(e) => { e.stopPropagation(); onStar(card.id); }}
          >
            <Star size={14} fill={card.starred ? 'currentColor' : 'none'} />
          </button>
        </div>
      );
    })
  );

  // On mobile, map is always on
  const effectiveShowMap = isMobile || showMap;

  // Mobile: render toolbar + map-first layout with bottom panel
  if (isMobile) {
    return (
      <div className="board board--mobile">
        {/* Toolbar: + button right-aligned, filters scrollable below */}
        <div className="board-toolbar-mobile">
          <div className="board-toolbar-top">
            <div className="filter-pills filter-pills--scroll">
              {CATEGORIES.map(cat => {
                const Icon = CATEGORY_ICONS[cat];
                const active = !disabledCats.has(cat);
                return (
                  <button
                    key={cat}
                    className={`pill ${active ? 'active' : ''}`}
                    onClick={() => toggleCat(cat)}
                    style={active ? { background: CATEGORY_COLORS[cat], borderColor: CATEGORY_COLORS[cat], color: '#fff' } : undefined}
                  >
                    {Icon && <Icon size={14} />}<span className="pill-label">{cat}</span>
                  </button>
                );
              })}
              <button
                className={`pill pill-near ${anchorId ? 'active' : ''}`}
                onClick={() => anchorId ? handleClearNear() : setNearOpen(o => !o)}
              >
                {anchorCard
                  ? <>Near {anchorCard.title.length > 12 ? anchorCard.title.slice(0, 12) + '…' : anchorCard.title}</>
                  : 'Nearest'
                }
                {anchorId && <span className="near-clear" onClick={(e) => { e.stopPropagation(); handleClearNear(); }}><X size={12} /></span>}
              </button>
              <button
                className={`pill pill-starred ${starredOnly ? 'active' : ''}`}
                onClick={() => setStarredOnly(s => !s)}
              >
                <Star size={14} fill="currentColor" /><span className="pill-label">Starred</span>
              </button>
            </div>
            <button className="add-btn-mobile" onClick={onAdd}>+</button>
          </div>
        </div>

        {/* Full-screen map */}
        <div className="board-map-full">
          <ProximityMap
            cards={catFiltered}
            anchorId={anchorId}
            onSelectAnchor={handleSelectAnchor}
            onAddPlace={onAddPlace}
            hiddenCategories={disabledCatsArray}
            onBoundsChange={onBoundsChange}
            pickerIdeas={pickerIdeas}
          />
        </div>

        {/* Bottom panel — slides up when a marker is tapped */}
        {anchorId && (
          <div className="mobile-panel">
            <div className="mobile-panel-handle" onClick={handleClearNear}>
              <span className="mobile-panel-bar" />
            </div>
            <div className="mobile-panel-header">
              <span className="mobile-panel-title">
                Near {anchorCard?.title || 'selected'}
              </span>
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
            </div>
            <div className="mobile-panel-list">
              {displayCards.filter(c => c.id !== anchorId).length === 0 ? (
                <div className="board-empty"><p>No places within this radius.</p></div>
              ) : (
                displayCards.filter(c => c.id !== anchorId).map(card => {
                  const dist = card._dist != null && card._dist > 0 ? card._dist : null;
                  const badge = dist != null ? `${formatDistance(dist)} · ${formatTravelTime(dist)}` : null;
                  return (
                    <div
                      key={card.id}
                      className="mobile-panel-item"
                      onClick={() => onEdit(card)}
                    >
                      {card.image_url && <img src={card.image_url} alt="" className="mobile-panel-img" />}
                      <div className="mobile-panel-info">
                        <span className="mobile-panel-name">{card.title}</span>
                        {badge && <span className="mobile-panel-dist">{badge}</span>}
                        {card.timing && <span className="mobile-panel-tip">{card.timing}</span>}
                        <span className="mobile-panel-cat">{(() => { const Icon = CATEGORY_ICONS[card.category] || MapPin; return <Icon size={10} />; })()}</span>
                      </div>
                      <button
                        className="mobile-panel-star"
                        onClick={(e) => { e.stopPropagation(); onStar(card.id); }}
                      >
                        <Star size={14} fill={card.starred ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Desktop layout (unchanged)
  return (
    <div className={`board ${showMap ? 'board--with-map' : ''}`}>
      <div className="board-toolbar">
        <button
          className="view-toggle"
          onClick={() => setListView(v => !v)}
          title={listView ? 'Card view' : 'List view'}
        >
          {listView ? <LayoutGrid size={16} /> : <List size={16} />}
        </button>
        <div className="filter-pills">
          {CATEGORIES.map(cat => {
            const Icon = CATEGORY_ICONS[cat];
            const active = !disabledCats.has(cat);
            return (
              <button
                key={cat}
                className={`pill ${active ? 'active' : ''}`}
                onClick={() => toggleCat(cat)}
                style={active ? { background: CATEGORY_COLORS[cat], borderColor: CATEGORY_COLORS[cat], color: '#fff' } : undefined}
              >
                {Icon && <Icon size={12} />} {cat}
              </button>
            );
          })}

          <button
            className={`pill pill-starred ${starredOnly ? 'active' : ''}`}
            onClick={() => setStarredOnly(s => !s)}
          >
            <Star size={12} fill="currentColor" /> Starred
          </button>

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
              {anchorId && <span className="near-clear" onClick={(e) => { e.stopPropagation(); handleClearNear(); }}><X size={12} /></span>}
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
                    <span className="near-dropdown-cat">{(() => { const Icon = CATEGORY_ICONS[c.category] || MapPin; return <Icon size={10} />; })()}</span>
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
            {listView ? (
              <div className="board-list">{renderList()}</div>
            ) : (
              <div className="masonry masonry--map-mode">{renderCards()}</div>
            )}
          </div>
          <div className="board-map-panel">
            <ProximityMap
              cards={catFiltered}
              anchorId={anchorId}
              onSelectAnchor={handleSelectAnchor}
              onAddPlace={onAddPlace}
              hiddenCategories={disabledCatsArray}
              onBoundsChange={onBoundsChange}
              pickerIdeas={pickerIdeas}
            />
          </div>
        </div>
      ) : listView ? (
        <div className="board-list">{renderList()}</div>
      ) : (
        <div className="masonry">
          {renderCards()}
        </div>
      )}
    </div>
  );
}
