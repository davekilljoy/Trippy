import { useState } from 'react';
import FlightCard from './FlightCard.jsx';
import FlightForm from './FlightForm.jsx';
import './TripDetailsModal.css';

export default function TripDetailsModal({
  destination, dateFrom, dateTo, adults, children,
  flights,
  onSave,
  onSaveFlight, onDeleteFlight,
  onClose,
}) {
  const [dest, setDest] = useState(destination);
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);
  const [ad, setAd] = useState(adults);
  const [ch, setCh] = useState([...children]);
  const [flightModal, setFlightModal] = useState(null);

  const addChild = () => setCh(c => [...c, 8]);
  const removeChild = (i) => setCh(c => c.filter((_, idx) => idx !== i));
  const setChildAge = (i, age) => setCh(c => c.map((a, idx) => idx === i ? Number(age) : a));

  const handleSave = () => {
    onSave({ destination: dest, dateFrom: from, dateTo: to, adults: ad, children: ch });
    onClose();
  };

  const handleSaveFlight = async (data) => {
    await onSaveFlight(data, flightModal?.flight);
    setFlightModal(null);
  };

  return (
    <div className="tdm-overlay" onClick={onClose}>
      <div className="tdm" onClick={e => e.stopPropagation()}>
        <div className="tdm-header">
          <h2 className="tdm-title">Trip Details</h2>
          <button className="tdm-close" onClick={onClose}>&times;</button>
        </div>

        {/* Trip settings */}
        <section className="tdm-section">
          <h3 className="tdm-section-title">Destination &amp; Dates</h3>
          <div className="tdm-grid">
            <div className="tdm-field full">
              <label>Destination</label>
              <input
                type="text"
                value={dest}
                onChange={e => setDest(e.target.value)}
                placeholder="Where are you going?"
              />
            </div>
            <div className="tdm-field">
              <label>From</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div className="tdm-field">
              <label>To</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} />
            </div>
          </div>
        </section>

        <section className="tdm-section">
          <h3 className="tdm-section-title">Travellers</h3>
          <div className="tdm-grid">
            <div className="tdm-field">
              <label>Adults</label>
              <div className="tdm-stepper">
                <button type="button" onClick={() => setAd(Math.max(1, ad - 1))}>−</button>
                <span>{ad}</span>
                <button type="button" onClick={() => setAd(ad + 1)}>+</button>
              </div>
            </div>
          </div>

          <div className="tdm-children">
            {ch.map((age, i) => (
              <div key={i} className="tdm-child-row">
                <span className="tdm-child-label">Child {i + 1}</span>
                <input
                  type="number"
                  min="0"
                  max="17"
                  value={age}
                  onChange={e => setChildAge(i, e.target.value)}
                  className="tdm-child-age"
                />
                <span className="tdm-child-unit">yrs</span>
                <button className="tdm-child-remove" onClick={() => removeChild(i)}>&times;</button>
              </div>
            ))}
            <button className="tdm-add-child" onClick={addChild}>+ Add child</button>
          </div>
        </section>

        {/* Flights */}
        <section className="tdm-section">
          <h3 className="tdm-section-title">
            Flights
            <button className="tdm-add-flight" onClick={() => setFlightModal({})}>+ Add</button>
          </h3>
          {flights.length === 0 ? (
            <p className="tdm-empty">No flights added yet.</p>
          ) : (
            <div className="tdm-flights">
              {flights.map(f => (
                <FlightCard
                  key={f.id}
                  flight={f}
                  onEdit={(fl) => setFlightModal({ flight: fl })}
                  onDelete={onDeleteFlight}
                />
              ))}
            </div>
          )}
        </section>

        <div className="tdm-actions">
          <button className="tdm-cancel" onClick={onClose}>Cancel</button>
          <button className="tdm-save" onClick={handleSave}>Save</button>
        </div>
      </div>

      {/* Nested flight form modal */}
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
