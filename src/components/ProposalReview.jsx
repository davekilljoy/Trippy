import { useState } from 'react';
import './ProposalReview.css';

export default function ProposalReview({ proposal, cards, onFinalize }) {
  const [selectedOpt, setSelectedOpt] = useState(
    proposal.optimization_options?.[2]?.key || proposal.optimization_options?.[0]?.key || 'balanced'
  );

  const cardMap = {};
  for (const c of cards) cardMap[c.id] = c;

  return (
    <div className="proposal-review">
      <h2 className="proposal-title">Proposed Day Breakdown</h2>
      <p className="proposal-subtitle">Here's how your trip could be organized. Pick an optimization style, then finalize.</p>

      <div className="proposal-days">
        {(proposal.days || []).map(day => (
          <div key={day.day} className="proposal-day">
            <div className="proposal-day-header">
              <span className="proposal-day-num">Day {day.day}</span>
              <span className="proposal-day-title">{day.title}</span>
            </div>
            <div className="proposal-day-stops">
              {(day.card_ids || []).map((cid, i) => {
                const card = cardMap[cid];
                if (!card) return null;
                return (
                  <div key={cid} className="proposal-stop">
                    <span className="proposal-stop-num">{i + 1}</span>
                    <span className="proposal-stop-cat">{card.category}</span>
                    <span className="proposal-stop-title">{card.title}</span>
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

      <button className="finalize-btn" onClick={() => onFinalize(selectedOpt)}>
        Finalize Itinerary
      </button>
    </div>
  );
}
