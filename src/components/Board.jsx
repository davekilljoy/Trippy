import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Star, X, Landmark, UtensilsCrossed, Hotel, Sparkles, TrainFront, ShoppingBag, MapPin, LayoutGrid, List, Map as MapIcon, Eye, Plus, ChevronUp, ChevronDown, ChevronLeft, ExternalLink, Pencil, Compass, Info } from 'lucide-react';

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

// Mobile sheet always reserves at least the peek-state height at the bottom
// of the map. This keeps the "places in view" count honest — cards behind
// the sheet shouldn't count as visible. Must match `.mobile-sheet--peek` height.
const MOBILE_SHEET_PEEK_PX = 132;

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
  const [showPois, setShowPois] = useState(true);
  const [listView, setListView] = useState(false);
  const [anchorId, setAnchorId] = useState(null);
  const [radiusKm, setRadiusKm] = useState(1.5);
  const [nearOpen, setNearOpen] = useState(false);
  const [mapBounds, setMapBounds] = useState(null);
  const nearRef = useRef(null);

  // Mobile sheet state — controls the persistent bottom sheet over the full-screen map.
  // Peek = thin preview of top card; list = scrollable all-cards; detail = single card view;
  // anchor = derived (when anchorId is set, shows nearby places + radius).
  const [sheetMode, setSheetMode] = useState('peek');
  const [selectedCardId, setSelectedCardId] = useState(null);

  const handleBoundsChange = useCallback((bounds) => {
    setMapBounds(bounds);
    onBoundsChange?.(bounds);
  }, [onBoundsChange]);

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

  // Effective map visibility (always on for mobile)
  const mapActive = isMobile || showMap;

  // Compute distances, then filter by radius + sort
  const displayCards = useMemo(() => {
    if (!anchorCard || !anchorCard.lat || !anchorCard.lng) {
      // When the map is showing, scope cards to its visible viewport
      if (mapActive && mapBounds) {
        return catFiltered
          .filter(c => {
            if (!c.lat || !c.lng) return false;
            const lat = Number(c.lat), lng = Number(c.lng);
            return lat >= mapBounds.south && lat <= mapBounds.north
              && lng >= mapBounds.west && lng <= mapBounds.east;
          })
          .map(c => ({ ...c, _dist: null }));
      }
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
  }, [catFiltered, anchorCard, radiusKm, mapActive, mapBounds]);

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

  // --- Mobile sheet flow ---
  // Tapping a marker on mobile (or a list item) opens the detail view rather than entering
  // anchor mode immediately. From detail, the user explicitly chooses "What's around" to anchor.
  const handleMobileSelectCard = useCallback((cardId) => {
    setSelectedCardId(cardId);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedCardId(null);
  }, []);

  const handleAroundCurrent = useCallback(() => {
    setSelectedCardId(prevSel => {
      if (prevSel) setAnchorId(prevSel);
      return null;
    });
  }, []);

  const handleCloseAnchor = useCallback(() => {
    setAnchorId(null);
    setSelectedCardId(null);
    setSheetMode('peek');
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

  // Mobile: render toolbar + map-first layout with persistent bottom sheet
  if (isMobile) {
    const selectedCard = selectedCardId ? cards.find(c => c.id === selectedCardId) : null;
    const peekCard = displayCards[0];
    const sheetState = anchorId ? 'anchor' : (selectedCard ? 'detail' : sheetMode);
    const renderListItem = (card, opts = {}) => {
      const dist = card._dist != null && card._dist > 0 ? card._dist : null;
      const distBadge = dist != null ? `${formatDistance(dist)} · ${formatTravelTime(dist)}` : null;
      return (
        <div
          key={card.id}
          role="button"
          tabIndex={0}
          className="sheet-list-item"
          onClick={() => handleMobileSelectCard(card.id)}
        >
          {card.image_url
            ? <img className="sheet-list-img" src={card.image_url} alt="" />
            : <span className="sheet-list-img sheet-list-img--placeholder">
                {(() => { const Icon = CATEGORY_ICONS[card.category] || MapPin; return <Icon size={18} />; })()}
              </span>
          }
          <div className="sheet-list-info">
            <span className="sheet-list-title">{card.title}</span>
            <span className="sheet-list-meta">
              {distBadge && <span className="sheet-list-dist">{distBadge}</span>}
              {!distBadge && card.rating && <><Star size={10} fill="currentColor" /> {card.rating}</>}
              {!distBadge && card.rating && card.address && <span className="sheet-list-sep">·</span>}
              {!distBadge && card.address && <span className="sheet-list-addr">{card.address}</span>}
            </span>
            {card.description && <span className="sheet-list-desc">{card.description}</span>}
          </div>
          <button
            className="sheet-list-star"
            onClick={(e) => { e.stopPropagation(); onStar(card.id); }}
            aria-label={card.starred ? 'Unstar' : 'Star'}
          >
            <Star size={14} fill={card.starred ? 'currentColor' : 'none'} />
          </button>
        </div>
      );
    };

    return (
      <div className="board board--mobile">
        {/* Toolbar: text-link filters scroll horizontally, + button at right */}
        <div className="board-toolbar-mobile">
          <div className="board-toolbar-top">
            <div className="filter-row--scroll">
              {CATEGORIES.map(cat => {
                const active = !disabledCats.has(cat);
                return (
                  <button
                    key={cat}
                    className={`filter-link ${active ? 'active' : 'disabled'}`}
                    onClick={() => toggleCat(cat)}
                  >
                    <span className="filter-dot" style={{ background: CATEGORY_COLORS[cat] }} />
                    {cat}
                  </button>
                );
              })}
              <span className="filter-link-sep" aria-hidden="true">·</span>
              <button
                className={`filter-link ${starredOnly ? 'active' : ''}`}
                onClick={() => setStarredOnly(s => !s)}
              >
                <Star size={11} fill={starredOnly ? 'currentColor' : 'none'} />
                Starred
              </button>
              <button
                className={`filter-link ${anchorId ? 'active' : ''}`}
                onClick={() => anchorId ? handleClearNear() : setNearOpen(o => !o)}
              >
                {anchorCard
                  ? <>Near {anchorCard.title.length > 12 ? anchorCard.title.slice(0, 12) + '…' : anchorCard.title}</>
                  : 'Near'
                }
                {anchorId && (
                  <span className="near-clear" onClick={(e) => { e.stopPropagation(); handleClearNear(); }}>
                    <X size={11} />
                  </span>
                )}
              </button>
              <button
                className={`filter-link ${showPois ? 'active' : ''}`}
                onClick={() => setShowPois(p => !p)}
              >
                <Eye size={11} /> POIs
              </button>
            </div>
            <button className="add-btn-mobile" onClick={onAdd} aria-label="Add idea">
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Map — fills the upper portion. Marker tap opens the detail sheet, not anchor mode.
            bottomInsetPx tells the map to fit/report bounds excluding the sheet area, so the
            "places in view" count matches what the user actually sees above the sheet. */}
        <div className="board-map-full">
          <ProximityMap
            cards={catFiltered}
            anchorId={anchorId || selectedCardId}
            onSelectAnchor={handleMobileSelectCard}
            onAddPlace={onAddPlace}
            hiddenCategories={disabledCatsArray}
            showPois={showPois}
            onBoundsChange={handleBoundsChange}
            pickerIdeas={pickerIdeas}
            bottomInsetPx={MOBILE_SHEET_PEEK_PX}
          />
        </div>

        {/* Persistent bottom sheet — peek / list / detail / anchor states */}
        <div className={`mobile-sheet mobile-sheet--${sheetState}`}>

          {sheetState === 'peek' && (
            <>
              <button
                type="button"
                className="mobile-sheet-handle"
                onClick={() => setSheetMode('list')}
                aria-label="Expand list"
              >
                <span className="mobile-sheet-bar" />
              </button>
              {peekCard ? (
                <div
                  role="button"
                  tabIndex={0}
                  className="sheet-peek"
                  onClick={() => handleMobileSelectCard(peekCard.id)}
                >
                  {peekCard.image_url
                    ? <img className="sheet-peek-img" src={peekCard.image_url} alt="" />
                    : <span className="sheet-peek-img sheet-peek-img--placeholder">
                        {(() => { const Icon = CATEGORY_ICONS[peekCard.category] || MapPin; return <Icon size={18} />; })()}
                      </span>
                  }
                  <div className="sheet-peek-info">
                    <span className="sheet-peek-title">{peekCard.title}</span>
                    <span className="sheet-peek-meta">
                      {peekCard.rating && <><Star size={10} fill="currentColor" /> {peekCard.rating}</>}
                      {peekCard.rating && peekCard.address && <span className="sheet-list-sep">·</span>}
                      {peekCard.address && <span className="sheet-peek-addr">{peekCard.address}</span>}
                    </span>
                  </div>
                  <span className="sheet-peek-count">
                    <ChevronUp size={14} /> {displayCards.length}
                  </span>
                </div>
              ) : (
                <div className="sheet-peek sheet-peek--empty">
                  No places in this map view. Pan or zoom out.
                </div>
              )}
            </>
          )}

          {sheetState === 'list' && (
            <>
              <button
                type="button"
                className="mobile-sheet-handle"
                onClick={() => setSheetMode('peek')}
                aria-label="Collapse list"
              >
                <span className="mobile-sheet-bar" />
              </button>
              <div className="mobile-sheet-header">
                <span className="sheet-header-title">
                  {displayCards.length} place{displayCards.length === 1 ? '' : 's'} in view
                </span>
                <button
                  type="button"
                  className="sheet-header-btn"
                  onClick={() => setSheetMode('peek')}
                  aria-label="Collapse"
                >
                  <ChevronDown size={16} />
                </button>
              </div>
              <div className="mobile-sheet-list">
                {displayCards.length === 0
                  ? <div className="board-empty"><p>No places in this map view.</p></div>
                  : displayCards.map(card => renderListItem(card))
                }
              </div>
            </>
          )}

          {sheetState === 'detail' && selectedCard && (
            <>
              <div className="mobile-sheet-handle-static">
                <span className="mobile-sheet-bar" />
              </div>
              <div className="mobile-sheet-header">
                <button
                  type="button"
                  className="sheet-header-btn"
                  onClick={handleCloseDetail}
                >
                  <ChevronLeft size={16} /> Back
                </button>
                <button
                  type="button"
                  className="sheet-header-btn"
                  onClick={() => onEdit(selectedCard)}
                  aria-label="Edit"
                >
                  <Pencil size={14} />
                </button>
              </div>
              <div className="mobile-sheet-detail">
                {selectedCard.image_url && (
                  <img className="sheet-detail-img" src={selectedCard.image_url} alt="" />
                )}
                <h2 className="sheet-detail-title">{selectedCard.title}</h2>
                <div className="sheet-detail-meta">
                  {selectedCard.category && (
                    <span className="sheet-detail-cat">
                      <span className="filter-dot" style={{ background: CATEGORY_COLORS[selectedCard.category] }} />
                      {selectedCard.category}
                    </span>
                  )}
                  {selectedCard.rating && (
                    <>
                      <span className="sheet-list-sep">·</span>
                      <span className="sheet-detail-rating">
                        <Star size={11} fill="currentColor" /> {selectedCard.rating}
                      </span>
                    </>
                  )}
                </div>
                {selectedCard.address && (
                  <p className="sheet-detail-addr">{selectedCard.address}</p>
                )}
                {selectedCard.description && (
                  <p className="sheet-detail-desc">{selectedCard.description}</p>
                )}
                {selectedCard.timing && (
                  <p className="sheet-detail-timing">
                    <Info size={13} className="sheet-detail-timing-icon" />
                    {selectedCard.timing}
                  </p>
                )}
                {(selectedCard.david_note || selectedCard.jen_note) && (
                  <div className="sheet-detail-notes">
                    {selectedCard.david_note && (
                      <div className="note">
                        <span className="avatar">D</span>
                        <span className="note-text">{selectedCard.david_note}</span>
                      </div>
                    )}
                    {selectedCard.jen_note && (
                      <div className="note">
                        <span className="avatar jen">J</span>
                        <span className="note-text">{selectedCard.jen_note}</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="sheet-detail-actions">
                  <button
                    type="button"
                    className="sheet-detail-around"
                    onClick={handleAroundCurrent}
                    disabled={!selectedCard.lat || !selectedCard.lng}
                  >
                    <Compass size={14} /> What’s around this
                  </button>
                  <button
                    type="button"
                    className={`sheet-detail-star ${selectedCard.starred ? 'active' : ''}`}
                    onClick={() => onStar(selectedCard.id)}
                  >
                    <Star size={14} fill={selectedCard.starred ? 'currentColor' : 'none'} />
                    {selectedCard.starred ? 'Starred' : 'Star'}
                  </button>
                  {selectedCard.link_url && (
                    <a
                      className="sheet-detail-link"
                      href={selectedCard.link_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink size={14} /> Visit
                    </a>
                  )}
                </div>
              </div>
            </>
          )}

          {sheetState === 'anchor' && anchorCard && (
            <>
              <div className="mobile-sheet-handle-static">
                <span className="mobile-sheet-bar" />
              </div>
              <div className="mobile-sheet-header">
                <button
                  type="button"
                  className="sheet-header-btn"
                  onClick={handleCloseAnchor}
                >
                  <ChevronLeft size={16} /> Back
                </button>
                <span className="sheet-header-title sheet-header-title--anchor">
                  Near {anchorCard.title.length > 18 ? anchorCard.title.slice(0, 18) + '…' : anchorCard.title}
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
              <div className="mobile-sheet-list">
                {displayCards.filter(c => c.id !== anchorId).length === 0
                  ? <div className="board-empty"><p>No places within this radius.</p></div>
                  : displayCards.filter(c => c.id !== anchorId).map(card => renderListItem(card))
                }
              </div>
            </>
          )}

        </div>
      </div>
    );
  }

  // Desktop layout
  return (
    <div className={`board ${showMap ? 'board--with-map' : ''}`}>
      <div className="board-toolbar">
        <div className="toolbar-group toolbar-group--view">
          <button
            className="view-toggle"
            onClick={() => setListView(v => !v)}
            title={listView ? 'Card view' : 'List view'}
          >
            {listView ? <LayoutGrid size={14} /> : <List size={14} />}
          </button>
        </div>

        <div className="toolbar-group toolbar-group--filters">
          {CATEGORIES.map(cat => {
            const active = !disabledCats.has(cat);
            return (
              <button
                key={cat}
                className={`filter-link ${active ? 'active' : 'disabled'}`}
                onClick={() => toggleCat(cat)}
                title={active ? `Hide ${cat}` : `Show ${cat}`}
              >
                <span className="filter-dot" style={{ background: CATEGORY_COLORS[cat] }} />
                {cat}
              </button>
            );
          })}
          <span className="filter-link-sep" aria-hidden="true">·</span>
          <button
            className={`filter-link ${starredOnly ? 'active' : ''}`}
            onClick={() => setStarredOnly(s => !s)}
          >
            <Star size={11} fill={starredOnly ? 'currentColor' : 'none'} />
            Starred
          </button>
          <span className="filter-link-sep" aria-hidden="true">·</span>

          {/* Near anchor filter */}
          <div className="filter-near" ref={nearRef}>
            <button
              className={`filter-link ${anchorId ? 'active' : ''}`}
              onClick={() => anchorId ? handleClearNear() : setNearOpen(o => !o)}
            >
              {anchorCard
                ? <>Near {anchorCard.title.length > 18 ? anchorCard.title.slice(0, 18) + '…' : anchorCard.title}</>
                : 'Near anchor'
              }
              {anchorId && (
                <span className="near-clear" onClick={(e) => { e.stopPropagation(); handleClearNear(); }}>
                  <X size={11} />
                </span>
              )}
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

        <div className="toolbar-group toolbar-group--tools">
          <button
            className={`tool-btn ${showMap ? 'active' : ''}`}
            onClick={handleToggleMap}
            title={showMap ? 'Hide map' : 'Show map'}
          >
            <MapIcon size={14} />
          </button>
          <button
            className={`tool-btn ${showPois ? 'active' : ''}`}
            onClick={() => setShowPois(p => !p)}
            title={showPois ? 'Hide Google POIs' : 'Show Google POIs'}
          >
            <Eye size={14} />
          </button>
          <button className="add-link" onClick={onAdd}>
            <Plus size={14} /> Add idea
          </button>
        </div>
      </div>

      {displayCards.length === 0 ? (
        <div className="board-empty">
          <p>{
            anchorId ? 'No places within this radius.'
            : (mapActive && mapBounds && cards.length > 0) ? 'No ideas in this map view. Pan or zoom out to see more.'
            : disabledCats.size > 0 ? 'No ideas match these filters.'
            : 'No ideas yet. Add your first one!'
          }</p>
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
              showPois={showPois}
              onBoundsChange={handleBoundsChange}
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
