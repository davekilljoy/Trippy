import { useState, useEffect, useCallback } from 'react';
import {
  createItinerary, fetchItineraries, fetchItinerary, deleteItinerary,
  proposeItinerary, finalizeItinerary, loadDayRoutes,
  fetchFlights, createFlight, updateFlight, deleteFlight,
} from '../lib/api.js';
import ProposalReview from './ProposalReview.jsx';
import DayCard from './DayCard.jsx';
import FlightCard from './FlightCard.jsx';
import FlightForm from './FlightForm.jsx';
import './ItineraryPanel.css';

export default function ItineraryPanel({ approvedCards, pendingCards }) {
  // Itinerary state
  const [versions, setVersions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [itinerary, setItinerary] = useState(null);

  // UI phase: 'idle' | 'proposing' | 'reviewing' | 'finalizing' | 'complete'
  const [phase, setPhase] = useState('idle');
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);

  // Flights
  const [flights, setFlights] = useState([]);
  const [flightModal, setFlightModal] = useState(null); // null | { flight } | {}

  // Load versions + flights on mount
  useEffect(() => {
    loadVersions();
    loadFlights();
  }, []);

  const loadVersions = async () => {
    const v = await fetchItineraries();
    setVersions(v);
    // If there are versions and none active, select the latest
    if (v.length && !activeId) {
      loadItinerary(v[0].id);
    }
  };

  const loadItinerary = async (id) => {
    setActiveId(id);
    setError(null);
    try {
      const data = await fetchItinerary(id);
      setItinerary(data);
      // Determine phase from itinerary state
      if (data.phase === 'final' && data.days?.length) {
        setPhase('complete');
      } else if (data.phase === 'proposal' && data.proposal) {
        setPhase('reviewing');
      } else {
        setPhase('idle');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const loadFlights = async () => {
    const f = await fetchFlights();
    setFlights(f);
  };

  // --- Build new itinerary ---
  const handleBuild = useCallback(async () => {
    if (!approvedCards.length) return;
    setError(null);
    setStatus('Creating itinerary...');
    setPhase('proposing');

    try {
      // Create itinerary record
      const cardIds = approvedCards.map(c => c.id);
      const created = await createItinerary(cardIds);
      setActiveId(created.id);

      // Propose day breakdown
      setStatus('Analyzing your places...');
      const result = await proposeItinerary(created.id, (s) => setStatus(s));

      if (result?.proposal) {
        // Reload full itinerary to get cards included
        const data = await fetchItinerary(created.id);
        setItinerary(data);
        setPhase('reviewing');
      } else {
        setError('No proposal received');
        setPhase('idle');
      }
      await loadVersions();
    } catch (err) {
      setError(err.message);
      setPhase('idle');
    } finally {
      setStatus('');
    }
  }, [approvedCards]);

  // Per-day route data loaded sequentially: { [dayNumber]: { legs } }
  const [dayData, setDayData] = useState({});
  const [loadingDay, setLoadingDay] = useState(null);

  // --- Finalize with optimization, then load routes day by day ---
  const handleFinalize = useCallback(async (optimization, dayHotels) => {
    if (!activeId) return;
    setError(null);
    setStatus('Building your schedule...');
    setPhase('finalizing');
    setDayData({});

    try {
      await finalizeItinerary(activeId, optimization, (s) => setStatus(s), dayHotels);

      // Reload itinerary to get the day structure
      const data = await fetchItinerary(activeId);
      setItinerary(data);
      setPhase('loading');
      setStatus('');
      await loadVersions();

      // Load routes for each day sequentially
      for (const day of (data.days || [])) {
        setLoadingDay(day.day_number);
        try {
          const result = await loadDayRoutes(activeId, day.day_number);
          setDayData(prev => ({
            ...prev,
            [day.day_number]: { legs: result.legs || [] },
          }));
        } catch {
          setDayData(prev => ({
            ...prev,
            [day.day_number]: { legs: [] },
          }));
        }
      }

      setLoadingDay(null);
      setPhase('complete');
    } catch (err) {
      setError(err.message);
      setPhase('reviewing');
    } finally {
      setStatus('');
    }
  }, [activeId]);

  // --- Version management ---
  const handleSelectVersion = (id) => {
    loadItinerary(id);
  };

  const handleDeleteVersion = async (id) => {
    await deleteItinerary(id);
    if (activeId === id) {
      setActiveId(null);
      setItinerary(null);
      setPhase('idle');
    }
    await loadVersions();
  };

  // --- Flight management ---
  const handleSaveFlight = async (data) => {
    if (flightModal?.flight?.id) {
      await updateFlight(flightModal.flight.id, data);
    } else {
      await createFlight(data);
    }
    await loadFlights();
    setFlightModal(null);
  };

  const handleDeleteFlight = async (id) => {
    await deleteFlight(id);
    await loadFlights();
  };

  const outboundFlight = flights.find(f => f.direction === 'outbound');
  const returnFlight = flights.find(f => f.direction === 'return');

  return (
    <div className="itinerary-layout">
      <aside className="itinerary-sidebar">
        {/* Version selector */}
        {versions.length > 0 && (
          <div className="sidebar-section">
            <h3 className="sidebar-heading">Versions</h3>
            <div className="version-list">
              {versions.map(v => (
                <button
                  key={v.id}
                  className={`version-item ${v.id === activeId ? 'active' : ''}`}
                  onClick={() => handleSelectVersion(v.id)}
                >
                  <span className="version-name">{v.name}</span>
                  <span className="version-phase">{v.phase}</span>
                  <button
                    className="version-delete"
                    onClick={e => { e.stopPropagation(); handleDeleteVersion(v.id); }}
                  >×</button>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Flights */}
        <div className="sidebar-section">
          <h3 className="sidebar-heading">
            Flights
            <button className="add-flight-btn" onClick={() => setFlightModal({})}>+ Add</button>
          </h3>
          {flights.length === 0 ? (
            <p className="sidebar-empty">No flights added yet.</p>
          ) : (
            <div className="sidebar-flights">
              {flights.map(f => (
                <div key={f.id} className="sidebar-flight-item">
                  <span className="sidebar-flight-dir">{f.direction === 'outbound' ? '→' : '←'}</span>
                  <span>{f.departure_airport || '?'} — {f.arrival_airport || '?'}</span>
                  <button className="sidebar-flight-edit" onClick={() => setFlightModal({ flight: f })}>Edit</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Approved cards */}
        <div className="sidebar-section">
          <h3 className="sidebar-heading">
            Approved <span className="count-badge">{approvedCards.length}</span>
          </h3>
          {approvedCards.length === 0 ? (
            <p className="sidebar-empty">No items approved by both yet.</p>
          ) : (
            <ul className="sidebar-list">
              {approvedCards.map(c => (
                <li key={c.id} className="sidebar-item approved">
                  <span className="sidebar-cat">{c.category}</span>
                  {c.title}
                  {(!c.lat || !c.lng) && <span className="sidebar-no-geo" title="No location data">?</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Pending cards */}
        <div className="sidebar-section">
          <h3 className="sidebar-heading">
            Pending <span className="count-badge">{pendingCards.length}</span>
          </h3>
          {pendingCards.length === 0 ? (
            <p className="sidebar-empty">All items are approved!</p>
          ) : (
            <ul className="sidebar-list">
              {pendingCards.map(c => (
                <li key={c.id} className="sidebar-item">
                  <span className="sidebar-cat">{c.category}</span>
                  {c.title}
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          className="build-btn"
          disabled={!approvedCards.length || phase === 'proposing' || phase === 'finalizing' || phase === 'loading'}
          onClick={handleBuild}
        >
          {phase === 'proposing' || phase === 'finalizing' || phase === 'loading' ? 'Building...' : 'Build Itinerary'}
        </button>
      </aside>

      <main className="itinerary-main">
        {error && <div className="itinerary-error">{error}</div>}

        {status && (phase === 'proposing' || phase === 'finalizing') && (
          <div className="itinerary-status">
            <div className="status-spinner" />
            <span>{status}</span>
          </div>
        )}

        {/* Idle state */}
        {phase === 'idle' && !itinerary && (
          <div className="itinerary-placeholder">
            <p>Approve items on the Board, then click <strong>Build Itinerary</strong> to generate a day-by-day plan with maps, routes, and tips.</p>
          </div>
        )}

        {/* Phase 1: Reviewing proposal */}
        {phase === 'reviewing' && itinerary?.proposal && (
          <ProposalReview
            proposal={itinerary.proposal}
            cards={itinerary.cards || approvedCards}
            onFinalize={handleFinalize}
          />
        )}

        {/* Day-by-day view: loading sequentially or complete */}
        {(phase === 'loading' || phase === 'complete') && itinerary?.days?.length > 0 && (
          <div className="day-plans">
            {/* Outbound flight */}
            {outboundFlight && (
              <FlightCard
                flight={outboundFlight}
                onEdit={(f) => setFlightModal({ flight: f })}
                onDelete={handleDeleteFlight}
              />
            )}

            {/* Day cards — show each day as it loads */}
            {itinerary.days.map(day => {
              const live = dayData[day.day_number];
              // Don't render days that haven't started loading yet
              if (phase === 'loading' && !live) return null;

              return (
                <DayCard
                  key={day.id}
                  day={day}
                  cards={itinerary.cards || approvedCards}
                  itineraryId={activeId}
                  liveData={live || null}
                />
              );
            })}

            {/* Loading indicator for next day */}
            {phase === 'loading' && loadingDay && (
              <div className="itinerary-status">
                <div className="status-spinner" />
                <span>Loading Day {loadingDay}...</span>
              </div>
            )}

            {/* Return flight */}
            {returnFlight && phase === 'complete' && (
              <FlightCard
                flight={returnFlight}
                onEdit={(f) => setFlightModal({ flight: f })}
                onDelete={handleDeleteFlight}
              />
            )}
          </div>
        )}
      </main>

      {/* Flight form modal */}
      {flightModal && (
        <FlightForm
          flight={flightModal.flight || null}
          onSave={handleSaveFlight}
          onClose={() => setFlightModal(null)}
        />
      )}
    </div>
  );
}
