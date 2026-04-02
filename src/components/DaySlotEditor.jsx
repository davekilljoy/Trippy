import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import SlotDropZone from './SlotDropZone.jsx';
import DayMap from './DayMap.jsx';
import { haversine, formatDistance, formatTravelTime } from '../lib/geo.js';
import { loadDayRoutes } from '../lib/api.js';
import './DaySlotEditor.css';

export default function DaySlotEditor({
  day,
  cards,
  itineraryId,
  approvedCards,
  placedCardMap,
  hotels,
  onAddSlot,
  onRemoveSlot,
  onSelect,
}) {
  const slots = day.stops || [];

  const hotel = useMemo(() =>
    day.hotel_id ? (hotels || []).find(h => h.id === day.hotel_id) : null,
    [day.hotel_id, hotels]
  );

  // Live route data
  const [routeData, setRouteData] = useState({ legs: [], waypoints: [] });
  const [routeLoading, setRouteLoading] = useState(false);
  const debounceRef = useRef(null);

  // Build map stops + number map from filled slots
  const { mapStops, slotNumbers } = useMemo(() => {
    const stops = [];
    const nums = {};
    let num = 1;
    for (const slot of slots) {
      if (!slot.card_id) continue;
      const card = (cards || []).find(c => c.id === slot.card_id);
      nums[slot.slot_id] = num;
      if (card?.lat && card?.lng) {
        stops.push({ lat: card.lat, lng: card.lng, title: card.title, id: card.id });
      }
      num++;
    }
    return { mapStops: stops, slotNumbers: nums };
  }, [slots, cards]);

  // Filled slot fingerprint for route reload
  const filledFingerprint = useMemo(() =>
    slots.filter(s => s.card_id).map(s => s.card_id).join(','),
    [slots]
  );

  // Load routes when filled slots change (debounced)
  const loadRoutes = useCallback(async () => {
    if (!itineraryId || !day.day_number) return;
    const filledCount = slots.filter(s => s.card_id).length;
    if (filledCount < 1) { setRouteData({ legs: [], waypoints: [] }); return; }
    setRouteLoading(true);
    try {
      const data = await loadDayRoutes(itineraryId, day.day_number);
      setRouteData(data || { legs: [], waypoints: [] });
    } catch {
      setRouteData({ legs: [], waypoints: [] });
    } finally {
      setRouteLoading(false);
    }
  }, [itineraryId, day.day_number, filledFingerprint]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(loadRoutes, 800);
    return () => clearTimeout(debounceRef.current);
  }, [loadRoutes]);

  const hasMapContent = mapStops.length > 0 || (hotel?.lat && hotel?.lng);

  // Compute anchor per slot: previous filled slot's location or hotel
  function getAnchor(slotIdx) {
    for (let i = slotIdx - 1; i >= 0; i--) {
      if (slots[i].card_id) {
        const c = (cards || []).find(card => card.id === slots[i].card_id);
        if (c?.lat && c?.lng) return { lat: Number(c.lat), lng: Number(c.lng), label: c.title };
      }
    }
    if (hotel?.lat && hotel?.lng) return { lat: Number(hotel.lat), lng: Number(hotel.lng), label: hotel.title || 'Hotel' };
    return { lat: null, lng: null, label: null };
  }

  return (
    <div className="day-slot-editor">
      <div className="day-slot-header">
        <span className="day-slot-num">Day {day.day_number}</span>
        {day.date && <span className="day-slot-date">{formatDate(day.date)}</span>}
      </div>

      <div className="day-slot-body">
        <div className="day-slot-list">
          {slots.map((slot, idx) => {
            const card = slot.card_id ? (cards || []).find(c => c.id === slot.card_id) : null;
            const anchor = getAnchor(idx);

            // Find the leg index for this slot pair (count filled slots before this one)
            const filledBefore = slots.slice(0, idx).filter(s => s.card_id).length;
            // Route leg for this transition (leg 0 = hotel→first stop, leg 1 = stop1→stop2, etc.)
            const routeLeg = card && slot.card_id && filledBefore >= 0
              ? routeData.legs[filledBefore] : null;
            const routeOptions = routeLeg?.routes || (routeLeg?.duration ? [routeLeg] : null);

            // Fallback to haversine if no route data
            let travelInfo = null;
            if (routeOptions && routeOptions.length > 0) {
              // Hide walking if > 45 min and there's a transit alternative
              const hasTransit = routeOptions.some(r => r.mode === 'transit');
              const filtered = routeOptions.filter(r => {
                if (r.mode === 'walking' && hasTransit && r.duration_value > 2700) return false;
                return true;
              });
              travelInfo = { routes: filtered.length ? filtered : routeOptions, anchorLabel: anchor.label };
            } else if (card && anchor.lat && anchor.lng && card.lat && card.lng) {
              const dist = haversine(anchor.lat, anchor.lng, Number(card.lat), Number(card.lng));
              if (dist != null && dist > 0.05) {
                travelInfo = {
                  routes: [{ mode: 'walking', duration: formatTravelTime(dist), distance: formatDistance(dist) }],
                  anchorLabel: anchor.label,
                };
              }
            } else if (card && (!card.lat || !card.lng)) {
              travelInfo = { routes: null, anchorLabel: anchor.label, unknown: true };
            }

            return (
              <div key={slot.slot_id}>
                {travelInfo && !travelInfo.unknown && travelInfo.routes && (
                  <div className="slot-travel-info">
                    <span className="slot-travel-line" />
                    <div className="slot-travel-rows">
                      {travelInfo.routes.map((r, ri) => (
                        <div key={ri} className={`slot-travel-row ${r.mode || ''}`}>
                          <span className="slot-travel-mode">{r.mode === 'walking' ? 'Walk' : 'Transit'}</span>
                          {r.duration && <span className="slot-travel-dur">{r.duration}</span>}
                          {r.distance && <span className="slot-travel-dist">{r.distance}</span>}
                          {r.summary && <span className="slot-travel-summary">{r.summary}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <SlotDropZone
                  slot={slot}
                  card={card}
                  dayNum={day.day_number}
                  markerNum={slotNumbers[slot.slot_id] || null}
                  itineraryId={itineraryId}
                  anchorLat={anchor.lat}
                  anchorLng={anchor.lng}
                  anchorLabel={anchor.label}
                  approvedCards={approvedCards}
                  placedCardMap={placedCardMap}
                  hotel={hotel}
                  onRemove={() => onRemoveSlot(slot.slot_id)}
                  onSelect={(c) => onSelect(day.day_number, slot.slot_id, c)}
                />
              </div>
            );
          })}
          <button className="day-slot-add" onClick={onAddSlot}>+ Add Slot</button>
        </div>

        {hasMapContent && (
          <div className="day-slot-map">
            <DayMap
              stops={mapStops}
              legs={routeData.legs}
              hotel={hotel}
              waypoints={routeData.waypoints}
            />
            {routeLoading && <div className="day-slot-map-loading">Loading routes...</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}
