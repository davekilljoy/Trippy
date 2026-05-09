import { useState, useEffect, useCallback, useRef } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { Sun, Moon, Flame } from 'lucide-react';
import Board from './components/Board.jsx';
import ItineraryPanel from './components/ItineraryPanel.jsx';
import CardModal from './components/CardModal.jsx';
import IdeaPicker from './components/IdeaPicker.jsx';
import TripDetailsModal from './components/TripDetailsModal.jsx';
import BookingCalendar from './components/BookingCalendar.jsx';
import { fetchCards, fetchSettings, saveSettings, createCard, updateCard, deleteCard, toggleStar, bulkCreateCards, generateIdeas, fetchFlights, createFlight, updateFlight, deleteFlight, backfillTiming } from './lib/api.js';
import { inferCategory } from './lib/places.js';

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00');
  return isNaN(d) ? null : d;
}

function countDays(from, to) {
  const a = parseDate(from), b = parseDate(to);
  if (!a || !b) return null;
  const diff = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : null;
}

function formatDateRange(from, to) {
  const a = parseDate(from), b = parseDate(to);
  if (!a || !b) return null;
  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();
  if (sameMonth) {
    return `${a.getDate()}–${b.getDate()} ${MONTHS_SHORT[a.getMonth()]}`;
  }
  if (sameYear) {
    return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`;
  }
  return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} ${a.getFullYear()} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`;
}

function formatTravellers(adults, children) {
  const parts = [`${adults} adult${adults !== 1 ? 's' : ''}`];
  if (children.length) parts.push(`${children.length} child${children.length !== 1 ? 'ren' : ''}`);
  return parts.join(' · ');
}

function formatAirportPair(outbound, inbound) {
  const arr = outbound?.arrival_airport;
  const dep = inbound?.departure_airport;
  if (!arr && !dep) return null;
  return `${arr || '?'} → ${dep || '?'}`;
}

const THEMES = [
  { id: 'warm', label: 'Warm', icon: Flame },
  { id: 'minimal', label: 'Minimal', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
];

function ThemePicker({ theme, setTheme }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = THEMES.find(t => t.id === theme) || THEMES[0];

  return (
    <div className="theme-picker" ref={ref}>
      <button className="theme-picker-btn" onClick={() => setOpen(o => !o)} title="Theme">
        <current.icon size={16} />
      </button>
      {open && (
        <div className="theme-picker-menu">
          {THEMES.map(t => (
            <button
              key={t.id}
              className={`theme-picker-option ${theme === t.id ? 'active' : ''}`}
              onClick={() => { setTheme(t.id); setOpen(false); }}
            >
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const VALID_VIEWS = new Set(['board', 'itinerary', 'bookings']);

function readViewFromHash() {
  const h = window.location.hash.replace(/^#\/?/, '');
  return VALID_VIEWS.has(h) ? h : 'board';
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'warm');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  const [view, setView] = useState(readViewFromHash);

  // Sync view <-> hash so refresh + back/forward work
  useEffect(() => {
    const target = view === 'board' ? '' : `#/${view}`;
    if (window.location.hash !== target) {
      window.history.replaceState(null, '', target || window.location.pathname + window.location.search);
    }
  }, [view]);

  useEffect(() => {
    const handler = () => setView(readViewFromHash());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const [cards, setCards] = useState([]);
  const [modal, setModal] = useState(null);
  const [destination, setDestination] = useState('Tokyo, Kyoto');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showTripModal, setShowTripModal] = useState(false);

  // Flights (lifted from ItineraryPanel)
  const [flights, setFlights] = useState([]);

  // Anchor card for proximity context (set by Board)
  const [anchorCard, setAnchorCard] = useState(null);
  const [mapVisible, setMapVisible] = useState(true);
  const [mapBounds, setMapBounds] = useState(null);

  // Generate bar + picker state
  const [genPrompt, setGenPrompt] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genStatus, setGenStatus] = useState('');
  const [pickerIdeas, setPickerIdeas] = useState(null);
  const [followUpLoading, setFollowUpLoading] = useState(false);

  // Cmd+K command palette (desktop only)
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [cmdkInput, setCmdkInput] = useState('');

  // Mobile-collapsed metadata expander
  const [metaOpen, setMetaOpen] = useState(false);

  // Load settings + cards + flights on mount
  const loadCards = useCallback(async () => {
    const data = await fetchCards();
    setCards(data);
  }, []);

  const loadFlights = useCallback(async () => {
    const f = await fetchFlights();
    setFlights(f);
  }, []);

  useEffect(() => {
    loadCards();
    loadFlights();
    fetchSettings().then(s => {
      if (s.destination !== undefined) setDestination(s.destination);
      if (s.dateFrom !== undefined) setDateFrom(s.dateFrom);
      if (s.dateTo !== undefined) setDateTo(s.dateTo);
      if (s.adults !== undefined) setAdults(s.adults);
      if (s.children !== undefined) setChildren(s.children);
      setSettingsLoaded(true);
    });
    backfillTiming().then(r => {
      if (r.backfilled > 0) loadCards();
    }).catch(() => {});
  }, [loadCards, loadFlights]);

  useEffect(() => {
    if (!settingsLoaded) return;
    const timer = setTimeout(() => {
      saveSettings({ destination, dateFrom, dateTo, adults, children });
    }, 500);
    return () => clearTimeout(timer);
  }, [destination, dateFrom, dateTo, adults, children, settingsLoaded]);

  const tripParams = useCallback(() => {
    const params = { destination, dateFrom, dateTo, adults, children };
    if (anchorCard && anchorCard.lat && anchorCard.lng) {
      params.nearLat = anchorCard.lat;
      params.nearLng = anchorCard.lng;
      params.nearName = anchorCard.title;
    } else if (mapBounds && mapVisible) {
      params.boundsNorth = mapBounds.north;
      params.boundsSouth = mapBounds.south;
      params.boundsEast = mapBounds.east;
      params.boundsWest = mapBounds.west;
    }
    return params;
  }, [destination, dateFrom, dateTo, adults, children, anchorCard, mapBounds, mapVisible]);

  // Single source of truth for triggering generation, used by inline gen bar AND Cmd+K.
  const generateFromPrompt = useCallback(async (prompt) => {
    if (!prompt.trim() || genLoading) return;
    if (view !== 'board') setView('board');
    setGenLoading(true);
    setGenStatus('Starting…');
    try {
      const result = await generateIdeas(
        { ...tripParams(), prompt },
        (status) => setGenStatus(status),
      );
      setPickerIdeas(result.ideas || []);
      setGenStatus('');
    } catch (err) {
      setGenStatus(`Error: ${err.message}`);
      setTimeout(() => setGenStatus(''), 4000);
    } finally {
      setGenLoading(false);
    }
  }, [genLoading, tripParams, view]);

  const handleGenerate = async (e) => {
    e.preventDefault();
    const prompt = genPrompt;
    setGenPrompt('');
    await generateFromPrompt(prompt);
  };

  const handleCmdkSubmit = async (e) => {
    e.preventDefault();
    const prompt = cmdkInput;
    setCmdkInput('');
    setCmdkOpen(false);
    await generateFromPrompt(prompt);
  };

  // Cmd/Ctrl+K — toggle palette. Esc — close.
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdkOpen(o => !o);
      } else if (e.key === 'Escape' && cmdkOpen) {
        setCmdkOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [cmdkOpen]);

  // Flight management
  const handleSaveFlight = async (data, existing) => {
    if (existing?.id) {
      await updateFlight(existing.id, data);
    } else {
      await createFlight(data);
    }
    await loadFlights();
  };

  const handleDeleteFlight = async (id) => {
    await deleteFlight(id);
    await loadFlights();
  };

  const handleTripDetailsSave = ({ destination: d, dateFrom: df, dateTo: dt, adults: a, children: c }) => {
    setDestination(d);
    setDateFrom(df);
    setDateTo(dt);
    setAdults(a);
    setChildren(c);
  };

  const handleCreate = async (data) => {
    await createCard(data);
    await loadCards();
    setModal(null);
    setTimeout(loadCards, 5000);
  };

  const handleUpdate = async (id, data) => {
    await updateCard(id, data);
    await loadCards();
    setModal(null);
  };

  const handleDelete = async (id) => {
    await deleteCard(id);
    await loadCards();
  };

  const handleStar = async (id) => {
    await toggleStar(id);
    await loadCards();
  };

  const handleFollowUp = async (followUpPrompt) => {
    setFollowUpLoading(true);
    try {
      const result = await generateIdeas({ ...tripParams(), prompt: followUpPrompt });
      setPickerIdeas(prev => [...(prev || []), ...(result.ideas || [])]);
    } catch {
      // silently fail
    } finally {
      setFollowUpLoading(false);
    }
  };

  const handleAddSelected = async (items) => {
    await bulkCreateCards(items);
    await loadCards();
    setPickerIdeas(null);
  };

  const starredCards = cards.filter(c => c.starred);
  const pendingCards = cards.filter(c => !c.starred);

  const outboundFlight = flights.find(f => f.direction === 'outbound');
  const returnFlight = flights.find(f => f.direction === 'return');

  const days = countDays(dateFrom, dateTo);
  const dateRange = formatDateRange(dateFrom, dateTo);
  const airportPair = formatAirportPair(outboundFlight, returnFlight);

  return (
    <APIProvider apiKey={GOOGLE_MAPS_KEY}>
      <header className="app-header">
        <div className="app-header-row">
          <button
            type="button"
            className="app-title-block"
            onClick={() => {
              // Mobile: tap-to-expand metadata. Desktop: opens trip modal.
              if (window.matchMedia('(max-width: 700px)').matches) {
                setMetaOpen(o => !o);
              } else {
                setShowTripModal(true);
              }
            }}
            aria-label="Trip details"
          >
            <h1 className="app-title">Japlanner <span className="app-title-jp">日本の旅</span></h1>
            <span className="app-meta app-meta--inline">
              {days && <span>{days} days</span>}
              {dateRange && <><span className="app-meta-sep">·</span><span>{dateRange}</span></>}
              {airportPair && <><span className="app-meta-sep">·</span><span>{airportPair}</span></>}
              <span className="app-meta-sep">·</span>
              <span>{formatTravellers(adults, children)}</span>
            </span>
          </button>
          <ThemePicker theme={theme} setTheme={setTheme} />
        </div>

        {/* Mobile-only collapsed metadata; expands on title tap */}
        {metaOpen && (
          <div className="app-meta app-meta--collapsed">
            {dateRange && <span>{dateRange}</span>}
            {days && <><span className="app-meta-sep">·</span><span>{days} days</span></>}
            {airportPair && <><span className="app-meta-sep">·</span><span>{airportPair}</span></>}
            <span className="app-meta-sep">·</span>
            <span>{formatTravellers(adults, children)}</span>
            <button
              type="button"
              className="app-meta-edit"
              onClick={() => { setMetaOpen(false); setShowTripModal(true); }}
            >
              Edit
            </button>
          </div>
        )}

        <nav className="app-nav">
          <button
            className={`nav-tab ${view === 'board' ? 'active' : ''}`}
            onClick={() => setView('board')}
          >
            Board
          </button>
          <button
            className={`nav-tab ${view === 'itinerary' ? 'active' : ''}`}
            onClick={() => setView('itinerary')}
          >
            Itinerary
          </button>
          <button
            className={`nav-tab ${view === 'bookings' ? 'active' : ''}`}
            onClick={() => setView('bookings')}
          >
            Bookings
          </button>
        </nav>
      </header>

      {view === 'board' && (
        <>
          {/* Inline gen bar — sits above the Board canvas, no longer a floating ChatGPT pill */}
          {!pickerIdeas && (
            <div className="gen-bar gen-bar--inline">
              {genLoading ? (
                <div className="gen-bar-loading">
                  <div className="gen-spinner" />
                  <span className="gen-status">{genStatus}</span>
                </div>
              ) : (
                <form className="gen-bar-form" onSubmit={handleGenerate}>
                  {anchorCard && (
                    <span className="gen-near-pill">
                      {anchorCard.title.length > 20 ? anchorCard.title.slice(0, 20) + '…' : anchorCard.title}
                    </span>
                  )}
                  <input
                    type="text"
                    value={genPrompt}
                    onChange={e => setGenPrompt(e.target.value)}
                    placeholder={anchorCard
                      ? `Ideas near ${anchorCard.title.split(' ').slice(0, 3).join(' ')}…`
                      : mapBounds?.areaName
                        ? `Find ideas in ${mapBounds.areaName}…`
                        : 'Type an idea, or describe what you’re looking for…'
                    }
                    className="gen-input"
                  />
                  <button type="submit" className="gen-submit" disabled={!genPrompt.trim()}>
                    Generate
                  </button>
                </form>
              )}
              {genStatus && !genLoading && (
                <span className="gen-done-status">{genStatus}</span>
              )}
            </div>
          )}

          <Board
            cards={cards}
            onAdd={() => setModal({ mode: 'add' })}
            onAddPlace={async (place) => {
              await createCard({
                title: place.name,
                address: place.address,
                lat: place.lat,
                lng: place.lng,
                image_url: place.image_url,
                link_url: place.website,
                rating: place.rating,
                opening_hours: place.opening_hours,
                price_level: place.price_level,
                place_id: place.place_id,
                category: inferCategory(place) || 'attraction',
              });
              await loadCards();
              setTimeout(loadCards, 4000);
              setTimeout(loadCards, 8000);
            }}
            onEdit={(card) => setModal({ mode: 'edit', card })}
            onDelete={handleDelete}
            onStar={handleStar}
            onAnchorChange={setAnchorCard}
            onShowMapChange={setMapVisible}
            onBoundsChange={setMapBounds}
            pickerIdeas={pickerIdeas}
          />
        </>
      )}

      {view === 'itinerary' && (
        <ItineraryPanel
          starredCards={starredCards}
          pendingCards={pendingCards}
          flights={flights}
          dateFrom={dateFrom}
          dateTo={dateTo}
          destination={destination}
          onEditFlight={() => setShowTripModal(true)}
          onDeleteFlight={handleDeleteFlight}
        />
      )}

      {view === 'bookings' && (
        <BookingCalendar
          arrivalDate={dateFrom}
          inline
          onClose={() => setView('board')}
        />
      )}

      {modal && (
        <CardModal
          mode={modal.mode}
          card={modal.card || null}
          onSave={modal.mode === 'add' ? handleCreate : (data) => handleUpdate(modal.card.id, data)}
          onClose={() => setModal(null)}
        />
      )}

      {showTripModal && (
        <TripDetailsModal
          destination={destination}
          dateFrom={dateFrom}
          dateTo={dateTo}
          adults={adults}
          children={children}
          flights={flights}
          onSave={handleTripDetailsSave}
          onSaveFlight={handleSaveFlight}
          onDeleteFlight={handleDeleteFlight}
          onClose={() => setShowTripModal(false)}
        />
      )}

      {pickerIdeas && (
        <IdeaPicker
          ideas={pickerIdeas}
          loading={followUpLoading}
          followUpLoading={followUpLoading}
          onAdd={handleAddSelected}
          onFollowUp={handleFollowUp}
          onClose={() => setPickerIdeas(null)}
          mapVisible={mapVisible}
        />
      )}

      {/* Cmd/Ctrl+K command palette — desktop fast-add. Mobile uses inline gen bar instead. */}
      {cmdkOpen && (
        <div className="cmdk-overlay" onClick={() => setCmdkOpen(false)}>
          <div className="cmdk-card" onClick={e => e.stopPropagation()}>
            <form onSubmit={handleCmdkSubmit}>
              <input
                autoFocus
                type="text"
                value={cmdkInput}
                onChange={e => setCmdkInput(e.target.value)}
                placeholder="Add an idea, or describe what you want…"
                className="cmdk-input"
              />
            </form>
            <div className="cmdk-hint">
              <span>Enter</span> to generate · <span>Esc</span> to close
            </div>
          </div>
        </div>
      )}
    </APIProvider>
  );
}
