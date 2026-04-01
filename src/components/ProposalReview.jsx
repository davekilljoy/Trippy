import { useState, useMemo } from 'react';
import './ProposalReview.css';

export default function ProposalReview({ proposal, cards, onFinalize }) {
  const [selectedOpt, setSelectedOpt] = useState(
    proposal.optimization_options?.[2]?.key || proposal.optimization_options?.[0]?.key || 'balanced'
  );

  const cardMap = {};
  for (const c of cards) cardMap[c.id] = c;
  const hotels = cards.filter(c => c.category === 'hotel');

  // Group consecutive days by hotel_id into "legs"
  const legs = useMemo(() => {
    const result = [];
    let currentLeg = null;

    for (const day of (proposal.days || [])) {
      const hotelId = day.hotel_id || null;
      if (!currentLeg || currentLeg.hotel_id !== hotelId) {
        currentLeg = { hotel_id: hotelId, days: [] };
        result.push(currentLeg);
      }
      currentLeg.days.push(day);
    }
    return result;
  }, [proposal.days]);

  // Hotel assignment per leg (index → hotel_id)
  const [legHotels, setLegHotels] = useState(() => {
    const initial = {};
    legs.forEach((leg, i) => { initial[i] = leg.hotel_id || hotels[0]?.id || null; });
    return initial;
  });

  const handleLegHotelChange = (legIdx, hotelId) => {
    setLegHotels(prev => ({ ...prev, [legIdx]: Number(hotelId) }));
  };

  const handleFinalize = () => {
    // Build dayHotels from leg assignments
    const dayHotels = {};
    legs.forEach((leg, i) => {
      const hotelId = legHotels[i];
      for (const day of leg.days) {
        dayHotels[day.day] = hotelId;
      }
    });
    onFinalize(selectedOpt, dayHotels);
  };

  return (
    <div className="proposal-review">
      <h2 className="proposal-title">Proposed Day Breakdown</h2>
      <p className="proposal-subtitle">Review the legs of your trip, assign hotels, pick optimization, then finalize.</p>

      <div className="proposal-legs">
        {legs.map((leg, legIdx) => {
          const hotelCard = legHotels[legIdx] ? cardMap[legHotels[legIdx]] : null;
          const dayRange = leg.days.length === 1
            ? `Day ${leg.days[0].day}`
            : `Days ${leg.days[0].day}–${leg.days[leg.days.length - 1].day}`;

          return (
            <div key={legIdx} className="proposal-leg">
              <div className="proposal-leg-header">
                <span className="proposal-leg-range">{dayRange}</span>
                {hotels.length > 0 && (
                  <select
                    className="proposal-hotel-select"
                    value={legHotels[legIdx] || ''}
                    onChange={e => handleLegHotelChange(legIdx, e.target.value)}
                  >
                    {hotels.map(h => (
                      <option key={h.id} value={h.id}>{h.title}</option>
                    ))}
                  </select>
                )}
              </div>

              {leg.days.map(day => (
                <div key={day.day} className="proposal-day">
                  <div className="proposal-day-header">
                    <span className="proposal-day-num">Day {day.day}</span>
                    <span className="proposal-day-title">{day.title}</span>
                    {day.pacing && (
                      <span className={`proposal-pacing proposal-pacing--${day.pacing}`}>{day.pacing}</span>
                    )}
                  </div>
                  {day.summary && (
                    <p className="proposal-day-summary">{day.summary}</p>
                  )}
                  <div className="proposal-day-stops">
                    {(day.stops || day.card_ids?.map(cid => ({ card_id: cid })) || []).map((stop, i) => {
                      if (stop.card_id) {
                        const card = cardMap[stop.card_id];
                        if (!card) return null;
                        return (
                          <div key={stop.card_id} className="proposal-stop">
                            {stop.suggested_time
                              ? <span className="proposal-stop-time">{stop.suggested_time}</span>
                              : <span className="proposal-stop-num">{i + 1}</span>
                            }
                            <span className="proposal-stop-cat">{stop.slot_type || card.category}</span>
                            <span className="proposal-stop-title">{card.title}</span>
                            {stop.duration_mins && <span className="proposal-stop-dur">{stop.duration_mins}m</span>}
                          </div>
                        );
                      }
                      // Meal suggestion (no card)
                      return (
                        <div key={`suggestion-${i}`} className="proposal-stop proposal-stop--meal">
                          {stop.suggested_time
                            ? <span className="proposal-stop-time">{stop.suggested_time}</span>
                            : <span className="proposal-stop-num">{i + 1}</span>
                          }
                          <span className="proposal-stop-cat proposal-stop-cat--meal">{stop.slot_type || 'meal'}</span>
                          <span className="proposal-stop-title">{stop.suggestion || 'Meal break'}</span>
                          {stop.duration_mins && <span className="proposal-stop-dur">{stop.duration_mins}m</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="proposal-day-meta">
                    {day.rationale && <span className="proposal-rationale">{day.rationale}</span>}
                    {day.estimated_walking_km && (
                      <span className="proposal-est">{day.estimated_walking_km} km walking</span>
                    )}
                    {day.estimated_transit_mins && (
                      <span className="proposal-est">{day.estimated_transit_mins} min transit</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="optimization-section">
        <h3 className="optimization-heading">Optimize for</h3>
        <div className="optimization-options">
          {(proposal.optimization_options || []).map(opt => (
            <button
              key={opt.key}
              className={`opt-card ${selectedOpt === opt.key ? 'selected' : ''}`}
              onClick={() => setSelectedOpt(opt.key)}
            >
              <strong>{opt.label}</strong>
              <span>{opt.description}</span>
            </button>
          ))}
        </div>
      </div>

      <button className="finalize-btn" onClick={handleFinalize}>
        Finalize Itinerary
      </button>
    </div>
  );
}
