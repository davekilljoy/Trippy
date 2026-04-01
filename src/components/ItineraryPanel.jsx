import { useState, useRef, useCallback } from 'react';
import { streamItinerary, getDirections } from '../lib/api.js';
import DayMap from './DayMap.jsx';
import './ItineraryPanel.css';

export default function ItineraryPanel({ approvedCards, pendingCards }) {
  const [markdown, setMarkdown] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [dayPlan, setDayPlan] = useState(null); // [{ day, stops, legs }]
  const [buildingRoutes, setBuildingRoutes] = useState(false);
  const abortRef = useRef(false);

  const geoCards = approvedCards.filter(c => c.lat && c.lng);
  const ungeoCards = approvedCards.filter(c => !c.lat || !c.lng);

  // Simple proximity grouping: cluster cards by nearest-neighbor, N per day
  const buildDayPlan = useCallback(async () => {
    if (geoCards.length === 0) return;
    setBuildingRoutes(true);

    // Estimate ~4 stops per day
    const stopsPerDay = Math.max(3, Math.min(5, Math.ceil(geoCards.length / Math.max(1, Math.ceil(geoCards.length / 4)))));
    const remaining = [...geoCards];
    const days = [];

    while (remaining.length > 0) {
      const dayStops = [remaining.shift()];
      while (dayStops.length < stopsPerDay && remaining.length > 0) {
        // Find nearest to last added stop
        const last = dayStops[dayStops.length - 1];
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const d = haversine(last.lat, last.lng, remaining[i].lat, remaining[i].lng);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        dayStops.push(remaining.splice(bestIdx, 1)[0]);
      }
      days.push({ day: days.length + 1, stops: dayStops, legs: [] });
    }

    // Fetch transit directions for each day
    for (const day of days) {
      if (day.stops.length < 2) continue;
      const waypoints = day.stops.map(s => ({ lat: s.lat, lng: s.lng }));
      try {
        const result = await getDirections(waypoints);
        day.legs = result.legs || [];
      } catch {}
    }

    setDayPlan(days);
    setBuildingRoutes(false);
  }, [geoCards]);

  const handleBuild = useCallback(async () => {
    if (!approvedCards.length) return;
    setMarkdown('');
    setError(null);
    setStreaming(true);
    setDayPlan(null);
    abortRef.current = false;

    // Build routes in parallel with LLM stream
    buildDayPlan();

    try {
      const ids = approvedCards.map(c => c.id);
      let text = '';
      for await (const delta of streamItinerary(ids)) {
        if (abortRef.current) break;
        text += delta;
        setMarkdown(text);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setStreaming(false);
    }
  }, [approvedCards, buildDayPlan]);

  const handleCopy = () => {
    navigator.clipboard.writeText(markdown);
  };

  return (
    <div className="itinerary-layout">
      <aside className="itinerary-sidebar">
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
          disabled={!approvedCards.length || streaming}
          onClick={handleBuild}
        >
          {streaming ? 'Building...' : 'Build Itinerary'}
        </button>
      </aside>

      <main className="itinerary-main">
        {error && <div className="itinerary-error">{error}</div>}

        {!markdown && !streaming && !error && !dayPlan && (
          <div className="itinerary-placeholder">
            <p>Approve items on the Board, then click <strong>Build Itinerary</strong> to generate a detailed plan with maps and routes.</p>
          </div>
        )}

        {/* Day-by-day maps */}
        {dayPlan && dayPlan.length > 0 && (
          <div className="day-plans">
            {dayPlan.map(day => (
              <div key={day.day} className="day-plan-block">
                <h2 className="day-heading">Day {day.day}</h2>
                <div className="day-stop-list">
                  {day.stops.map((stop, i) => (
                    <div key={stop.id} className="day-stop">
                      <span className="day-stop-num">{i + 1}</span>
                      <div className="day-stop-info">
                        <span className="day-stop-cat">{stop.category}</span>
                        <strong>{stop.title}</strong>
                        {stop.address && <small>{stop.address}</small>}
                      </div>
                      {day.legs[i] && (
                        <span className="day-stop-travel">
                          → {day.legs[i].duration} ({day.legs[i].distance})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <DayMap stops={day.stops} legs={day.legs} />
              </div>
            ))}
          </div>
        )}

        {buildingRoutes && (
          <div className="route-loading">Calculating routes...</div>
        )}

        {ungeoCards.length > 0 && dayPlan && (
          <div className="ungeo-warning">
            {ungeoCards.length} item{ungeoCards.length > 1 ? 's' : ''} couldn't be mapped: {ungeoCards.map(c => c.title).join(', ')}
          </div>
        )}

        {/* LLM markdown output */}
        {(markdown || streaming) && (
          <div className="itinerary-output">
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }} />
            {streaming && <span className="stream-cursor" />}
          </div>
        )}

        {markdown && !streaming && (
          <button className="copy-btn" onClick={handleCopy}>Copy Markdown</button>
        )}
      </main>
    </div>
  );
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function renderMarkdown(md) {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/^---$/gm, '<hr/>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  html = html.replace(/\n{2,}/g, '\n</p><p>\n');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p>\s*<(h[1-3]|ul|hr)/g, '<$1');
  html = html.replace(/<\/(h[1-3]|ul)>\s*<\/p>/g, '</$1>');
  html = html.replace(/<hr\/>\s*<\/p>/g, '<hr/>');
  html = html.replace(/<p>\s*<\/p>/g, '');

  return html;
}
