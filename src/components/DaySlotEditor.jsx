import { useMemo } from 'react';
import SlotDropZone from './SlotDropZone.jsx';
import DayMap from './DayMap.jsx';
import './DaySlotEditor.css';

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const la1 = Number(lat1), lo1 = Number(lng1), la2 = Number(lat2), lo2 = Number(lng2);
  if (isNaN(la1) || isNaN(lo1) || isNaN(la2) || isNaN(lo2)) return 999;
  const dLat = (la2 - la1) * Math.PI / 180;
  const dLng = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const DAY_TYPE_LABELS = {
  arrival: 'Arrival',
  jet_lag: 'Jet Lag',
  departure: 'Departure',
  travel: 'Travel',
  normal: null,
};

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
  const typeLabel = DAY_TYPE_LABELS[day.title?.match(/\((\w+)\)/)?.[1]] || null;

  const hotel = useMemo(() =>
    day.hotel_id ? (hotels || []).find(h => h.id === day.hotel_id) : null,
    [day.hotel_id, hotels]
  );

  // Build map stops + number map from filled slots
  const { mapStops, slotNumbers } = useMemo(() => {
    const stops = [];
    const nums = {}; // slot_id -> marker number
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

  const hasMapContent = mapStops.length > 0 || (hotel?.lat && hotel?.lng);

  // Compute anchor per slot: previous filled slot's location, or hotel
  function getAnchor(slotIdx) {
    for (let i = slotIdx - 1; i >= 0; i--) {
      if (slots[i].card_id) {
        const c = (cards || []).find(card => card.id === slots[i].card_id);
        if (c?.lat && c?.lng) return { lat: Number(c.lat), lng: Number(c.lng) };
      }
    }
    if (hotel?.lat && hotel?.lng) return { lat: Number(hotel.lat), lng: Number(hotel.lng) };
    return { lat: null, lng: null };
  }

  return (
    <div className="day-slot-editor">
      <div className="day-slot-header">
        <span className="day-slot-num">Day {day.day_number}</span>
        {day.date && <span className="day-slot-date">{formatDate(day.date)}</span>}
        {typeLabel && <span className="day-slot-type">{typeLabel}</span>}
      </div>

      <div className="day-slot-body">
        <div className="day-slot-list">
          {slots.map((slot, idx) => {
            const card = slot.card_id ? (cards || []).find(c => c.id === slot.card_id) : null;
            const anchor = getAnchor(idx);

            // Travel info from previous filled slot
            let travelInfo = null;
            if (card && anchor.lat && anchor.lng && card.lat && card.lng) {
              const dist = haversine(anchor.lat, anchor.lng, Number(card.lat), Number(card.lng));
              if (dist > 0.05) { // skip if essentially same location
                const walkMins = Math.round(dist / 0.08); // ~5km/h walking
                const transitMins = Math.round(dist / 0.5); // ~30km/h transit
                travelInfo = {
                  dist,
                  distLabel: dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`,
                  walkLabel: walkMins <= 30 ? `~${walkMins} min walk` : null,
                  transitLabel: `~${transitMins} min transit`,
                };
              }
            }

            return (
              <div key={slot.slot_id}>
                {travelInfo && (
                  <div className="slot-travel-info">
                    <span className="slot-travel-line" />
                    <span className="slot-travel-detail">
                      {travelInfo.distLabel}
                      {travelInfo.walkLabel ? ` · ${travelInfo.walkLabel}` : ` · ${travelInfo.transitLabel}`}
                    </span>
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
                  approvedCards={approvedCards}
                  placedCardMap={placedCardMap}
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
              legs={[]}
              hotel={hotel}
              waypoints={[]}
            />
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
