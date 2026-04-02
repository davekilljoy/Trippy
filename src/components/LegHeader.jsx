import { useState } from 'react';
import './LegHeader.css';

export default function LegHeader({ hotel, hotels, days, onHotelChange }) {
  const [showPicker, setShowPicker] = useState(false);

  const startDate = days[0]?.date;
  const endDate = days[days.length - 1]?.date;
  const dateRange = startDate === endDate
    ? formatShort(startDate)
    : `${formatShort(startDate)} — ${formatShort(endDate)}`;

  return (
    <div className="leg-header">
      <div className="leg-hotel-info">
        <span className="leg-hotel-icon">🏨</span>
        <button
          className="leg-hotel-name"
          onClick={() => setShowPicker(p => !p)}
        >
          {hotel?.title || 'No hotel assigned'}
          <span className="leg-hotel-arrow">▾</span>
        </button>
        <span className="leg-date-range">{dateRange}</span>
        <span className="leg-day-count">{days.length} {days.length === 1 ? 'day' : 'days'}</span>
      </div>

      {showPicker && (
        <div className="leg-hotel-picker">
          {hotels.map(h => (
            <button
              key={h.id}
              className={`leg-hotel-option ${h.id === hotel?.id ? 'active' : ''}`}
              onClick={() => { onHotelChange(h.id); setShowPicker(false); }}
            >
              {h.title}
              {h.address && <span className="leg-hotel-addr">{h.address}</span>}
            </button>
          ))}
          <button
            className={`leg-hotel-option ${!hotel ? 'active' : ''}`}
            onClick={() => { onHotelChange(null); setShowPicker(false); }}
          >
            No hotel
          </button>
        </div>
      )}
    </div>
  );
}

function formatShort(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}
