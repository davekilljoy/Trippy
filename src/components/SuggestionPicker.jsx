import { useState, useMemo } from 'react';
import { suggestForSlots, createCard } from '../lib/api.js';
import './SuggestionPicker.css';

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function SuggestionPicker({
  itineraryId,
  dayNum,
  slot,
  anchorLat,
  anchorLng,
  approvedCards,
  placedCardMap,
  onSelect,
  onClose,
}) {
  const [llmSuggestions, setLlmSuggestions] = useState([]);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState(null);
  const [llmLoaded, setLlmLoaded] = useState(false);

  // Instant: proximity-sorted approved cards, placed ones filtered out
  const nearbyCards = useMemo(() => {
    const isMeal = ['lunch', 'dinner', 'breakfast'].includes(slot.slot_type);
    const available = (approvedCards || []).filter(c => {
      if (placedCardMap[c.id]) return false;
      if (c.category === 'hotel') return false;
      if (isMeal) return c.category === 'restaurant';
      return c.category !== 'restaurant';
    });

    if (anchorLat && anchorLng) {
      return available
        .filter(c => c.lat && c.lng)
        .map(c => ({ ...c, _dist: haversine(anchorLat, anchorLng, c.lat, c.lng) }))
        .sort((a, b) => a._dist - b._dist);
    }

    return available;
  }, [approvedCards, placedCardMap, slot.slot_type, anchorLat, anchorLng]);

  const handleGetMoreIdeas = async () => {
    setLlmLoading(true);
    setLlmError(null);
    try {
      const allPlaced = Object.keys(placedCardMap).map(Number);
      const result = await suggestForSlots(itineraryId, dayNum, {
        slots: [{ slot_index: 0, slot_type: slot.slot_type, duration_mins: slot.duration_mins }],
        anchor_lat: anchorLat,
        anchor_lng: anchorLng,
        placed_card_ids: allPlaced,
      });
      const opts = result.suggestions?.['0'] || [];
      setLlmSuggestions(opts);
      setLlmLoaded(true);
    } catch (err) {
      setLlmError(err.message);
    } finally {
      setLlmLoading(false);
    }
  };

  const handleSelectLlm = async (sug) => {
    // Check if it matches an existing approved card
    const match = (approvedCards || []).find(c =>
      c.title.toLowerCase() === sug.title?.toLowerCase()
    );
    if (match) {
      onSelect(match);
      return;
    }
    try {
      const newCard = await createCard({
        title: sug.title,
        description: sug.description,
        address: sug.address,
        lat: sug.lat,
        lng: sug.lng,
        image_url: sug.image_url,
        category: sug.category || 'attraction',
        david_approved: 1,
        jen_approved: 1,
      });
      onSelect(newCard);
    } catch {
      onClose();
    }
  };

  return (
    <div className="sug-picker-overlay" onClick={onClose}>
      <div className="sug-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="sug-picker-header">
          <h3>{slot.slot_type}</h3>
          <button className="sug-picker-close" onClick={onClose}>×</button>
        </div>

        {/* Instant: approved cards sorted by proximity */}
        {nearbyCards.length > 0 && (
          <>
            <div className="sug-picker-section-label">From your ideas</div>
            <div className="sug-picker-list">
              {nearbyCards.map(card => (
                <button
                  key={card.id}
                  className="sug-picker-item"
                  onClick={() => onSelect(card)}
                >
                  {card.image_url && <img src={card.image_url} alt="" className="sug-picker-img" />}
                  <div className="sug-picker-info">
                    <span className="sug-picker-title">{card.title}</span>
                    <span className="sug-picker-cat">{card.category}</span>
                    {card.address && <span className="sug-picker-addr">{card.address}</span>}
                    {card._dist != null && <span className="sug-picker-dist">{card._dist < 1 ? `${Math.round(card._dist * 1000)}m away` : `${card._dist.toFixed(1)}km away`}</span>}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {nearbyCards.length === 0 && !llmLoaded && (
          <p className="sug-picker-empty">No matching ideas left — try AI suggestions below.</p>
        )}

        {/* LLM section */}
        <div className="sug-picker-llm-section">
          {!llmLoaded && !llmLoading && (
            <button className="sug-picker-llm-btn" onClick={handleGetMoreIdeas}>
              Get AI suggestions
            </button>
          )}

          {llmLoading && (
            <div className="sug-picker-loading">
              <div className="status-spinner" />
              <span>Finding ideas...</span>
            </div>
          )}

          {llmError && <div className="sug-picker-error">{llmError}</div>}

          {llmLoaded && llmSuggestions.length > 0 && (
            <>
              <div className="sug-picker-section-label">AI suggestions</div>
              <div className="sug-picker-list">
                {llmSuggestions.map((sug, i) => (
                  <button
                    key={`llm-${i}`}
                    className="sug-picker-item llm"
                    onClick={() => handleSelectLlm(sug)}
                  >
                    {sug.image_url && <img src={sug.image_url} alt="" className="sug-picker-img" />}
                    <div className="sug-picker-info">
                      <span className="sug-picker-title">{sug.title}</span>
                      <span className="sug-picker-cat">{sug.category}</span>
                      {sug.description && <span className="sug-picker-desc">{sug.description}</span>}
                      {sug.address && <span className="sug-picker-addr">{sug.address}</span>}
                      {sug.reasoning && <span className="sug-picker-reason">{sug.reasoning}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {llmLoaded && llmSuggestions.length === 0 && (
            <p className="sug-picker-empty">No AI suggestions available.</p>
          )}
        </div>
      </div>
    </div>
  );
}
