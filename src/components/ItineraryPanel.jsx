import { useState, useEffect, useCallback, useRef } from 'react';
import { Star, X } from 'lucide-react';
import {
  createItinerary, fetchItineraries, fetchItinerary, deleteItinerary,
  proposeItinerary, finalizeItinerary, loadDayRoutes, generateSkeleton,
} from '../lib/api.js';
import ProposalReview from './ProposalReview.jsx';
import DayCard from './DayCard.jsx';
import FlightCard from './FlightCard.jsx';
import SkeletonBuilder from './SkeletonBuilder.jsx';
import SpotCard from './SpotCard.jsx';
import './ItineraryPanel.css';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatItinDateRange(from, to) {
  if (!from || !to) return null;
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  if (isNaN(a) || isNaN(b)) return null;
  const sameMonth = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  if (sameMonth) return `${a.getDate()}–${b.getDate()} ${MONTHS_SHORT[a.getMonth()]}`;
  if (a.getFullYear() === b.getFullYear()) return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`;
  return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} ${a.getFullYear()} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`;
}

function countItinDays(from, to) {
  if (!from || !to) return null;
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  if (isNaN(a) || isNaN(b)) return null;
  const diff = Math.round((b - a) / 86400000);
  return diff > 0 ? diff : null;
}

export default function ItineraryPanel({ starredCards, pendingCards, flights, dateFrom, dateTo, destination, onEditFlight, onDeleteFlight }) {
  // Itinerary state
  const [versions, setVersions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [itinerary, setItinerary] = useState(null);

  // UI phase: 'idle' | 'proposing' | 'reviewing' | 'finalizing' | 'complete' | 'skeleton' | 'building'
  const [phase, setPhase] = useState('idle');
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);
  const [showModePicker, setShowModePicker] = useState(false);
  const modePickerRef = useRef(null);

  // Load versions on mount
  useEffect(() => {
    loadVersions();
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
      if (data.mode === 'v2' && data.phase === 'skeleton') {
        setPhase('skeleton');
      } else if (data.phase === 'final' && data.days?.length) {
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

  // --- Build new itinerary ---
  const handleBuild = useCallback(async () => {
    if (!starredCards.length) return;
    setError(null);
    setStatus('Creating itinerary...');
    setPhase('proposing');
    setShowModePicker(false);

    try {
      // Create itinerary record
      const cardIds = starredCards.map(c => c.id);
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
  }, [starredCards]);

  // --- Build V2 manual itinerary ---
  const handleBuildV2 = useCallback(async () => {
    if (!starredCards.length) return;
    setError(null);
    setStatus('Creating itinerary...');
    setPhase('proposing');
    setShowModePicker(false);

    try {
      const cardIds = starredCards.map(c => c.id);
      const created = await createItinerary(cardIds, null, 'v2');
      setActiveId(created.id);

      setStatus('Building skeleton...');
      await generateSkeleton(created.id);

      const data = await fetchItinerary(created.id);
      setItinerary(data);
      setPhase('skeleton');
      await loadVersions();
    } catch (err) {
      setError(err.message);
      setPhase('idle');
    } finally {
      setStatus('');
    }
  }, [starredCards]);

  // Close mode picker on outside click
  useEffect(() => {
    if (!showModePicker) return;
    const handler = (e) => {
      if (modePickerRef.current && !modePickerRef.current.contains(e.target)) {
        setShowModePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showModePicker]);

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
      await finalizeItinerary(activeId, optimization, dayHotels);

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
            [day.day_number]: { legs: result.legs || [], waypoints: result.waypoints || [] },
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

  const outboundFlight = flights.find(f => f.direction === 'outbound');
  const returnFlight = flights.find(f => f.direction === 'return');

  // Shared sidebar header: build button + versions
  const sidebarHeader = (
    <>
      <div className="build-btn-wrap" ref={modePickerRef}>
        <button
          className="build-btn"
          disabled={!starredCards.length || phase === 'proposing' || phase === 'finalizing' || phase === 'loading'}
          onClick={() => setShowModePicker(prev => !prev)}
        >
          {phase === 'proposing' || phase === 'finalizing' || phase === 'loading' ? 'Building...' : 'New Itinerary'}
        </button>
        {showModePicker && (
          <div className="mode-picker">
            <button className="mode-option" onClick={handleBuild}>
              <strong>Build with AI</strong>
              <span>LLM plans everything</span>
            </button>
            <button className="mode-option" onClick={handleBuildV2}>
              <strong>Build Manually</strong>
              <span>Drag &amp; drop with AI assist</span>
            </button>
          </div>
        )}
      </div>

      {versions.length > 0 && (
        <div className="sidebar-section">
          <h3 className="sidebar-heading">Versions</h3>
          <div className="version-list">
            {versions.map(v => (
              <div
                key={v.id}
                className={`version-item ${v.id === activeId ? 'active' : ''}`}
                onClick={() => handleSelectVersion(v.id)}
              >
                <span className="version-name">{v.name}</span>
                {v.mode === 'v2' && <span className="version-mode">v2</span>}
                <span className="version-phase">{v.phase}</span>
                <button
                  className="version-delete"
                  onClick={e => { e.stopPropagation(); handleDeleteVersion(v.id); }}
                ><X size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );

  // V2 skeleton: SkeletonBuilder owns the full layout (sidebar + main) inside DndContext
  if (phase === 'skeleton' && itinerary?.mode === 'v2' && itinerary?.days?.length > 0) {
    return (
      <SkeletonBuilder
        itinerary={itinerary}
        starredCards={starredCards}
        headerContent={sidebarHeader}
        onUpdate={async () => {
          const data = await fetchItinerary(activeId);
          setItinerary(data);
        }}
      />
    );
  }

  const itinDateRange = formatItinDateRange(dateFrom, dateTo);
  const itinDays = countItinDays(dateFrom, dateTo);

  const itinHeader = (itinDateRange || itinDays || destination) ? (
    <div className="itinerary-meta">
      {itinDateRange && <span>{itinDateRange}</span>}
      {itinDays && (<><span className="itinerary-meta-sep">·</span><span>{itinDays} days</span></>)}
      {destination && (<><span className="itinerary-meta-sep">·</span><span>{destination}</span></>)}
    </div>
  ) : null;

  // All other phases: standard layout with sidebar + main
  return (
    <div className="itinerary-wrap">
      {itinHeader}
      <div className="itinerary-layout">
      <aside className="itinerary-sidebar">
        {sidebarHeader}

        <div className="sidebar-section">
          <h3 className="sidebar-heading">
            <Star size={12} fill="currentColor" /> Starred <span className="count-badge">{starredCards.filter(c => c.category !== 'hotel').length}</span>
          </h3>
          {starredCards.filter(c => c.category !== 'hotel').length === 0 ? (
            <p className="sidebar-empty">No starred items yet.</p>
          ) : (
            <div className="sidebar-cards">
              {starredCards.filter(c => c.category !== 'hotel').map(c => (
                <SpotCard
                  key={c.id}
                  card={c}
                  variant="compact"
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="itinerary-main">
        {error && <div className="itinerary-error">{error}</div>}

        {status && (phase === 'proposing' || phase === 'finalizing') && (
          <div className="itinerary-status">
            <div className="status-spinner" />
            <span>{status}</span>
          </div>
        )}

        {phase === 'idle' && !itinerary && (
          <div className="itinerary-placeholder">
            <p>Star items on the Board, then click <strong>New Itinerary</strong> to generate a day-by-day plan with maps, routes, and tips.</p>
          </div>
        )}

        {phase === 'reviewing' && itinerary?.proposal && (
          <ProposalReview
            proposal={itinerary.proposal}
            cards={itinerary.cards || starredCards}
            onFinalize={handleFinalize}
          />
        )}

        {(phase === 'loading' || phase === 'complete') && itinerary?.days?.length > 0 && (
          <div className="day-plans">
            {outboundFlight && (
              <FlightCard
                flight={outboundFlight}
                onEdit={() => onEditFlight(outboundFlight)}
                onDelete={onDeleteFlight}
              />
            )}

            {itinerary.days.map(day => {
              const live = dayData[day.day_number];
              if (phase === 'loading' && !live) return null;
              return (
                <DayCard
                  key={day.id}
                  day={day}
                  cards={itinerary.cards || starredCards}
                  itineraryId={activeId}
                  liveData={live || null}
                />
              );
            })}

            {phase === 'loading' && loadingDay && (
              <div className="itinerary-status">
                <div className="status-spinner" />
                <span>Loading Day {loadingDay}...</span>
              </div>
            )}

            {returnFlight && phase === 'complete' && (
              <FlightCard
                flight={returnFlight}
                onEdit={() => onEditFlight(returnFlight)}
                onDelete={onDeleteFlight}
              />
            )}
          </div>
        )}
      </main>
      </div>
    </div>
  );
}
