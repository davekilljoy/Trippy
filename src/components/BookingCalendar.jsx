import { useState, useEffect } from 'react';
import { Calendar, AlertCircle, CheckCircle2, ExternalLink, Plane } from 'lucide-react';
import { fetchBookingCalendar } from '../lib/api.js';
import './BookingCalendar.css';

const URGENCY_RANK = { past: 0, critical: 1, high: 2, medium: 3, low: 4 };

const URGENCY_LABEL = {
  past: 'Overdue',
  critical: 'Book now',
  high: 'Book soon',
  medium: 'Plan ahead',
  low: 'Flex',
};

function pickWorstUrgency(items) {
  return items.reduce(
    (worst, i) => (URGENCY_RANK[i.urgency] < URGENCY_RANK[worst] ? i.urgency : worst),
    'low'
  );
}

function formatNodeDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatLongDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function BookingCalendar({ arrivalDate, onClose, inline = false }) {
  const wrapperClass = `booking-calendar${inline ? ' booking-calendar--inline' : ''}`;
  const wrapperClick = inline ? undefined : onClose;
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      if (!arrivalDate) {
        setError('No arrival date set. Please set your trip dates first.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await fetchBookingCalendar(arrivalDate);
        setBookings(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [arrivalDate]);

  if (loading) {
    return (
      <div className={wrapperClass} onClick={wrapperClick}>
        <div className="booking-calendar-inner" onClick={e => e.stopPropagation()}>
          <div className="booking-calendar-loading">Loading booking timeline…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={wrapperClass} onClick={wrapperClick}>
        <div className="booking-calendar-inner" onClick={e => e.stopPropagation()}>
          <div className="booking-calendar-error">
            <AlertCircle size={28} />
            <p>{error}</p>
            <p className="bc-error-hint">Click the trip details to set your arrival date.</p>
            <button className="booking-calendar-close" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  const todayStr = new Date().toISOString().split('T')[0];

  // Group items by deadline date so multiple items on the same date share one node
  const byDate = new Map();
  for (const item of bookings) {
    if (!byDate.has(item.deadline)) byDate.set(item.deadline, []);
    byDate.get(item.deadline).push(item);
  }
  const sortedDates = [...byDate.keys()].sort();
  const overdueDates = sortedDates.filter(d => d < todayStr);
  const upcomingDates = sortedDates.filter(d => d >= todayStr);

  const totalItems = bookings.length;
  const overdueItems = overdueDates.reduce((n, d) => n + byDate.get(d).length, 0);
  const criticalItems = bookings.filter(b => b.urgency === 'critical' && b.daysBefore > 0).length;

  const formattedArrival = formatLongDate(arrivalDate);

  return (
    <div className={wrapperClass} onClick={wrapperClick}>
      <div className="booking-calendar-inner" onClick={e => e.stopPropagation()}>
        <header className="booking-calendar-header">
          <h2><Calendar size={20} /> Booking Timeline</h2>
          <p>Working back from arrival: <strong>{formattedArrival}</strong></p>
          <button className="booking-calendar-close" onClick={onClose}>Close</button>
        </header>

        {totalItems === 0 ? (
          <div className="booking-calendar-empty">
            <CheckCircle2 size={40} />
            <p>No advance bookings required.</p>
          </div>
        ) : (
          <>
            <div className="bc-summary">
              <span className="bc-chip bc-chip--total">{totalItems} items</span>
              {criticalItems > 0 && <span className="bc-chip bc-chip--critical">{criticalItems} urgent</span>}
              {overdueItems > 0 && <span className="bc-chip bc-chip--overdue">{overdueItems} overdue</span>}
            </div>

            <ol className="bc-timeline">
              <li className="bc-node bc-node--today">
                <div className="bc-node-date">
                  <strong>Today</strong>
                  <span className="bc-node-sub">{formatNodeDate(todayStr)}</span>
                </div>
                <div className="bc-node-marker" />
                <div className="bc-node-body">
                  <span className="bc-anchor-label">You are here</span>
                </div>
              </li>

              {overdueDates.length > 0 && (
                <li className="bc-node bc-node--overdue" data-urgency="past">
                  <div className="bc-node-date">
                    <strong>Missed</strong>
                    <span className="bc-node-sub">{overdueItems} item{overdueItems === 1 ? '' : 's'}</span>
                  </div>
                  <div className="bc-node-marker" />
                  <div className="bc-node-body">
                    {overdueDates.flatMap(d => byDate.get(d)).map(item => (
                      <BookingCard key={item.id} item={item} urgency="past" />
                    ))}
                  </div>
                </li>
              )}

              {upcomingDates.map(date => {
                const items = byDate.get(date);
                const nodeUrgency = pickWorstUrgency(items);
                const daysBefore = items[0].daysBefore;
                return (
                  <li key={date} className="bc-node" data-urgency={nodeUrgency}>
                    <div className="bc-node-date">
                      <strong>{formatNodeDate(date)}</strong>
                      <span className="bc-node-sub">{daysBefore}d before arrival</span>
                    </div>
                    <div className="bc-node-marker" />
                    <div className="bc-node-body">
                      {items.map(item => (
                        <BookingCard key={item.id} item={item} urgency={item.urgency} />
                      ))}
                    </div>
                  </li>
                );
              })}

              <li className="bc-node bc-node--arrival">
                <div className="bc-node-date">
                  <strong>Arrival</strong>
                  <span className="bc-node-sub">{formatNodeDate(arrivalDate)}</span>
                </div>
                <div className="bc-node-marker" />
                <div className="bc-node-body">
                  <span className="bc-anchor-label">
                    <Plane size={14} /> Land in Japan
                  </span>
                </div>
              </li>
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

function BookingCard({ item, urgency }) {
  return (
    <div className="booking-card" data-urgency={urgency}>
      {item.image_url && (
        <img src={item.image_url} alt={item.title} className="booking-card-image" />
      )}
      <div className="booking-card-content">
        <span className="booking-card-badge">{URGENCY_LABEL[urgency]}</span>
        <h4>{item.title}</h4>
        <p className="booking-card-note">{item.note}</p>
        {item.link_url && (
          <a
            href={item.link_url}
            target="_blank"
            rel="noopener noreferrer"
            className="booking-card-link"
          >
            Visit website <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  );
}
