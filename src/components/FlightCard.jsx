import './FlightCard.css';

export default function FlightCard({ flight, onEdit, onDelete }) {
  const isOutbound = flight.direction === 'outbound';

  return (
    <div className={`flight-card ${isOutbound ? 'outbound' : 'return'}`}>
      <div className="flight-card-header">
        <span className="flight-direction">{isOutbound ? 'Outbound' : 'Return'}</span>
        <div className="flight-card-actions">
          {onEdit && <button className="flight-action" onClick={() => onEdit(flight)}>Edit</button>}
          {onDelete && <button className="flight-action flight-delete" onClick={() => onDelete(flight.id)}>Remove</button>}
        </div>
      </div>

      <div className="flight-route">
        <div className="flight-endpoint">
          <span className="flight-airport">{flight.departure_airport || '???'}</span>
          <span className="flight-time">{formatTime(flight.departure_time)}</span>
          {flight.departure_tz && <span className="flight-tz">{flight.departure_tz}</span>}
        </div>
        <div className="flight-arrow">
          <span className="flight-line" />
          {flight.airline && (
            <span className="flight-airline">
              {flight.airline} {flight.flight_number || ''}
            </span>
          )}
        </div>
        <div className="flight-endpoint">
          <span className="flight-airport">{flight.arrival_airport || '???'}</span>
          <span className="flight-time">{formatTime(flight.arrival_time)}</span>
          {flight.arrival_tz && <span className="flight-tz">{flight.arrival_tz}</span>}
        </div>
      </div>

      {flight.notes && <p className="flight-notes">{flight.notes}</p>}
    </div>
  );
}

function formatTime(isoStr) {
  if (!isoStr) return '--:--';
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('en-GB', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    });
  } catch { return isoStr; }
}
