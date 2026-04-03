import { useState, useEffect, useCallback } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import Board from './components/Board.jsx';
import ItineraryPanel from './components/ItineraryPanel.jsx';
import CardModal from './components/CardModal.jsx';
import IdeaPicker from './components/IdeaPicker.jsx';
import TripDetailsModal from './components/TripDetailsModal.jsx';
import { fetchCards, fetchSettings, saveSettings, createCard, updateCard, deleteCard, toggleApproval, bulkCreateCards, generateIdeas, fetchFlights, createFlight, updateFlight, deleteFlight } from './lib/api.js';
import { inferCategory } from './lib/places.js';

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

function formatFlightTime(isoStr) {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('en-GB', {
      day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    });
  } catch { return null; }
}

function countDays(from, to) {
  if (!from || !to) return null;
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  const diff = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : null;
}

function formatTravellers(adults, children) {
  const parts = [`${adults} Adult${adults !== 1 ? 's' : ''}`];
  if (children.length) parts.push(`${children.length} Child${children.length !== 1 ? 'ren' : ''}`);
  return parts.join(', ');
}

export default function App() {
  const [view, setView] = useState('board');
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

  // Generate bar + picker state
  const [genPrompt, setGenPrompt] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genStatus, setGenStatus] = useState('');
  const [pickerIdeas, setPickerIdeas] = useState(null);
  const [followUpLoading, setFollowUpLoading] = useState(false);

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
  }, [loadCards, loadFlights]);

  // Save settings to server on change (debounced)
  useEffect(() => {
    if (!settingsLoaded) return;
    const timer = setTimeout(() => {
      saveSettings({ destination, dateFrom, dateTo, adults, children });
    }, 500);
    return () => clearTimeout(timer);
  }, [destination, dateFrom, dateTo, adults, children, settingsLoaded]);

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

  const handleApprove = async (id, person) => {
    await toggleApproval(id, person);
    await loadCards();
  };

  const tripParams = () => {
    const params = { destination, dateFrom, dateTo, adults, children };
    if (anchorCard && anchorCard.lat && anchorCard.lng) {
      params.nearLat = anchorCard.lat;
      params.nearLng = anchorCard.lng;
      params.nearName = anchorCard.title;
    }
    return params;
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!genPrompt.trim() || genLoading) return;
    setGenLoading(true);
    setGenStatus('Starting...');
    try {
      const result = await generateIdeas(
        { ...tripParams(), prompt: genPrompt },
        (status) => setGenStatus(status),
      );
      setPickerIdeas(result.ideas || []);
      setGenStatus('');
      setGenPrompt('');
    } catch (err) {
      setGenStatus(`Error: ${err.message}`);
      setTimeout(() => setGenStatus(''), 4000);
    } finally {
      setGenLoading(false);
    }
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

  const approvedCards = cards.filter(c => c.david_approved && c.jen_approved);
  const pendingCards = cards.filter(c => !(c.david_approved && c.jen_approved));

  const outboundFlight = flights.find(f => f.direction === 'outbound');
  const returnFlight = flights.find(f => f.direction === 'return');

  return (
    <APIProvider apiKey={GOOGLE_MAPS_KEY}>
      <header className="app-header">
        <h1 className="app-title">Japlanner <span>日本の旅</span></h1>
        <div className="header-details" onClick={() => setShowTripModal(true)}>
          {/* Arrive */}
          <span className="header-chip">
            <span className="header-label">Arrive</span>
            {outboundFlight
              ? <>{outboundFlight.arrival_airport || '?'} {formatFlightTime(outboundFlight.arrival_time) || '—'}</>
              : <span className="header-muted">—</span>
            }
          </span>
          <span className="header-sep">·</span>
          {/* Days */}
          <span className="header-chip">
            {countDays(dateFrom, dateTo)
              ? <>{countDays(dateFrom, dateTo)} days</>
              : <span className="header-muted">— days</span>
            }
          </span>
          <span className="header-sep">·</span>
          {/* Locations */}
          <span className="header-chip">{destination || <span className="header-muted">No destination</span>}</span>
          <span className="header-sep">·</span>
          {/* Travellers */}
          <span className="header-chip">{formatTravellers(adults, children)}</span>
          <span className="header-sep">·</span>
          {/* Depart */}
          <span className="header-chip">
            <span className="header-label">Depart</span>
            {returnFlight
              ? <>{returnFlight.departure_airport || '?'} {formatFlightTime(returnFlight.departure_time) || '—'}</>
              : <span className="header-muted">—</span>
            }
          </span>
          <span className="header-edit-hint">Edit</span>
        </div>
        <nav className="app-nav">
          <button
            className={`nav-btn ${view === 'board' ? 'active' : ''}`}
            onClick={() => setView('board')}
          >
            Board
          </button>
          <button
            className={`nav-btn ${view === 'itinerary' ? 'active' : ''}`}
            onClick={() => setView('itinerary')}
          >
            Itinerary
          </button>
        </nav>
      </header>

      {view === 'board' ? (
        <Board
          cards={cards}
          approvedCount={approvedCards.length}
          totalCount={cards.length}
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
            // Re-fetch after background description generation completes
            setTimeout(loadCards, 4000);
          }}
          onEdit={(card) => setModal({ mode: 'edit', card })}
          onDelete={handleDelete}
          onApprove={handleApprove}
          onAnchorChange={setAnchorCard}
        />
      ) : (
        <ItineraryPanel
          approvedCards={approvedCards}
          pendingCards={pendingCards}
          flights={flights}
          onEditFlight={() => setShowTripModal(true)}
          onDeleteFlight={handleDeleteFlight}
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

      {/* Trip details modal */}
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

      {/* Idea picker panel */}
      {pickerIdeas && (
        <IdeaPicker
          ideas={pickerIdeas}
          loading={followUpLoading}
          followUpLoading={followUpLoading}
          onAdd={handleAddSelected}
          onFollowUp={handleFollowUp}
          onClose={() => setPickerIdeas(null)}
        />
      )}

      {/* Floating generate bar — only on Board view */}
      {view === 'board' && !pickerIdeas && (
        <div className="gen-bar">
          {genLoading ? (
            <div className="gen-bar-loading">
              <div className="gen-spinner" />
              <span className="gen-status">{genStatus}</span>
            </div>
          ) : (
            <form className="gen-bar-form" onSubmit={handleGenerate}>
              {anchorCard && (
                <span className="gen-near-pill">
                  Near {anchorCard.title.length > 20 ? anchorCard.title.slice(0, 20) + '…' : anchorCard.title}
                </span>
              )}
              <input
                type="text"
                value={genPrompt}
                onChange={e => setGenPrompt(e.target.value)}
                placeholder={anchorCard ? `Ideas near ${anchorCard.title.split(' ').slice(0, 3).join(' ')}...` : 'Find itinerary ideas...'}
                className="gen-input"
              />
              <button type="submit" className="gen-submit" disabled={!genPrompt.trim()}>Generate</button>
            </form>
          )}
          {genStatus && !genLoading && (
            <span className="gen-done-status">{genStatus}</span>
          )}
        </div>
      )}
    </APIProvider>
  );
}
