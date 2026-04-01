import { useState, useCallback, useRef } from 'react';
import { streamDayEnrichment } from '../lib/api.js';
import DayMap from './DayMap.jsx';
import './DayCard.css';

export default function DayCard({ day, cards, itineraryId, liveData }) {
  const [enrichment, setEnrichment] = useState(day.enrichment_md || '');
  const [enrichStatus, setEnrichStatus] = useState(day.enrichment_status || 'pending');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef(false);

  // Build card lookup
  const cardMap = {};
  for (const c of cards) cardMap[c.id] = c;

  // Find this day's hotel (multi-hotel: use hotel_id, fallback to single hotel)
  const hotel = (day.hotel_id ? cardMap[day.hotel_id] : cards.find(c => c.category === 'hotel' && c.lat && c.lng)) || null;

  const stops = (day.stops || []).map(s => {
    const card = cardMap[s.card_id];
    if (card) return { ...card, ...s };
    return { id: s.card_id, title: `Stop ${s.order + 1}`, category: '?', ...s };
  });

  // Use live route data if available, otherwise stored
  const legs = liveData?.legs?.length ? liveData.legs : (day.legs || []);
  const waypoints = liveData?.waypoints?.length ? liveData.waypoints : (day.waypoints || []);

  // On-demand enrichment
  const handleEnrich = useCallback(async () => {
    if (streaming) return;
    setStreaming(true);
    setEnrichStatus('streaming');
    setEnrichment('');
    abortRef.current = false;

    try {
      let text = '';
      for await (const delta of streamDayEnrichment(itineraryId, day.day_number)) {
        if (abortRef.current) break;
        text += delta;
        setEnrichment(text);
      }
      setEnrichStatus('done');
    } catch {
      setEnrichStatus('error');
    } finally {
      setStreaming(false);
    }
  }, [itineraryId, day.day_number, streaming]);

  return (
    <div className="day-card">
      <div className="day-card-header">
        <div className="day-card-title-row">
          <span className="day-card-num">Day {day.day_number}</span>
          <h2 className="day-card-title">{day.title}</h2>
          {day.date && <span className="day-card-date">{day.date}</span>}
          {hotel && <span className="day-card-hotel">{hotel.title}</span>}
        </div>
      </div>

      <div className="day-card-stops">
        {stops.map((stop, i) => (
          <div key={stop.id || i} className="day-card-stop">
            <span className="day-card-stop-num">{i + 1}</span>
            <div className="day-card-stop-info">
              <div className="day-card-stop-top">
                <span className="day-card-stop-cat">{stop.category}</span>
                <strong>{stop.title}</strong>
                {stop.suggested_time && (
                  <span className="day-card-stop-time">{stop.suggested_time}</span>
                )}
              </div>
              {stop.address && <small className="day-card-stop-addr">{stop.address}</small>}
              {stop.note && <span className="day-card-stop-note">{stop.note}</span>}
            </div>
            {legs[i] && (
              <div className="day-card-stop-travel">
                <span className="travel-time">→ {legs[i].duration}{legs[i].distance ? ` (${legs[i].distance})` : ''}</span>
                {legs[i].summary && <span className="travel-summary">{legs[i].summary}</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      <DayMap stops={stops} legs={legs} hotel={hotel} waypoints={waypoints} />

      {/* Enrichment: on-demand */}
      <div className="day-card-enrichment">
        {enrichStatus === 'pending' && (
          <button className="enrich-btn" onClick={handleEnrich}>
            Get tips & details for this day
          </button>
        )}
        {enrichStatus === 'error' && (
          <button className="enrich-btn enrich-retry" onClick={handleEnrich}>
            Retry
          </button>
        )}
        {enrichment && (
          <div className="enrich-content">
            <div
              className="markdown-body"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(enrichment) }}
            />
            {streaming && <span className="stream-cursor" />}
          </div>
        )}
      </div>
    </div>
  );
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
