import { useState, useEffect } from 'react';
import './FlightForm.css';

const EMPTY = {
  direction: 'outbound',
  airline: '',
  flight_number: '',
  departure_airport: '',
  arrival_airport: '',
  departure_time: '',
  arrival_time: '',
  departure_tz: '',
  arrival_tz: '',
  notes: '',
};

export default function FlightForm({ flight, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (flight) {
      setForm({
        direction: flight.direction || 'outbound',
        airline: flight.airline || '',
        flight_number: flight.flight_number || '',
        departure_airport: flight.departure_airport || '',
        arrival_airport: flight.arrival_airport || '',
        departure_time: flight.departure_time || '',
        arrival_time: flight.arrival_time || '',
        departure_tz: flight.departure_tz || '',
        arrival_tz: flight.arrival_tz || '',
        notes: flight.notes || '',
      });
    }
  }, [flight]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="flight-form-overlay" onClick={onClose}>
      <form className="flight-form" onClick={e => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3 className="flight-form-title">{flight ? 'Edit Flight' : 'Add Flight'}</h3>

        <div className="flight-form-row">
          <label className="flight-form-label">Direction</label>
          <div className="flight-form-toggle">
            <button
              type="button"
              className={form.direction === 'outbound' ? 'active' : ''}
              onClick={() => set('direction', 'outbound')}
            >Outbound</button>
            <button
              type="button"
              className={form.direction === 'return' ? 'active' : ''}
              onClick={() => set('direction', 'return')}
            >Return</button>
          </div>
        </div>

        <div className="flight-form-grid">
          <div className="flight-form-field">
            <label>Airline</label>
            <input value={form.airline} onChange={e => set('airline', e.target.value)} placeholder="JAL" />
          </div>
          <div className="flight-form-field">
            <label>Flight #</label>
            <input value={form.flight_number} onChange={e => set('flight_number', e.target.value)} placeholder="JL41" />
          </div>
        </div>

        <div className="flight-form-grid">
          <div className="flight-form-field">
            <label>From Airport</label>
            <input value={form.departure_airport} onChange={e => set('departure_airport', e.target.value)} placeholder="LHR" />
          </div>
          <div className="flight-form-field">
            <label>To Airport</label>
            <input value={form.arrival_airport} onChange={e => set('arrival_airport', e.target.value)} placeholder="NRT" />
          </div>
        </div>

        <div className="flight-form-grid">
          <div className="flight-form-field">
            <label>Departure</label>
            <input type="datetime-local" value={form.departure_time} onChange={e => set('departure_time', e.target.value)} />
          </div>
          <div className="flight-form-field">
            <label>Arrival</label>
            <input type="datetime-local" value={form.arrival_time} onChange={e => set('arrival_time', e.target.value)} />
          </div>
        </div>

        <div className="flight-form-grid">
          <div className="flight-form-field">
            <label>Departure TZ</label>
            <input value={form.departure_tz} onChange={e => set('departure_tz', e.target.value)} placeholder="Europe/London" />
          </div>
          <div className="flight-form-field">
            <label>Arrival TZ</label>
            <input value={form.arrival_tz} onChange={e => set('arrival_tz', e.target.value)} placeholder="Asia/Tokyo" />
          </div>
        </div>

        <div className="flight-form-field full">
          <label>Notes</label>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Window seat, meal preference..." rows={2} />
        </div>

        <div className="flight-form-actions">
          <button type="button" className="flight-form-cancel" onClick={onClose}>Cancel</button>
          <button type="submit" className="flight-form-save">Save Flight</button>
        </div>
      </form>
    </div>
  );
}
