import { useState, useMemo } from 'react';
import { suggestForSlots, createCard } from '../lib/api.js';
import { haversine } from '../lib/geo.js';
import SpotCard from './SpotCard.jsx';
import './SuggestionPicker.css';

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

  // Proximity-sorted approved cards, placed ones filtered out
  const nearbyCards = useMemo(() => {
    const available = (approvedCards || []).filter(c => {
      if (placedCardMap[c.id]) return false;
      if (c.category === 'hotel') return false;
      return true;
    });

    if (anchorLat && anchorLng) {
      return available
        .filter(c => c.lat && c.lng)
        .map(c => ({ ...c, _dist: haversine(anchorLat, anchorLng, c.lat, c.lng) }))
        .sort((a, b) => (a._dist ?? 999) - (b._dist ?? 999));
    }

    return available;
  }, [approvedCards, placedCardMap, anchorLat, anchorLng]);

  const handleGetMoreIdeas = async () => {
    setLlmLoading(true);
    setLlmError(null);
    try {
      const allPlaced = Object.keys(placedCardMap).map(Number);
      const result = await suggestForSlots(itineraryId, dayNum, {
        slots: [{ slot_index: 0, slot_type: slot.slot_type || 'activity', duration_mins: slot.duration_mins || 90 }],
        anchor_lat: anchorLat,
        anchor_lng: anchorLng,
        placed_card_ids: allPlaced,
      });
      const opts = result.suggestions?.['0'] || [];
      const withDist = opts.map(s => ({
        ...s,
        _dist: (s.lat && s.lng && anchorLat && anchorLng)
          ? haversine(anchorLat, anchorLng, s.lat, s.lng) : null,
      }));
      withDist.sort((a, b) => (a._dist ?? 999) - (b._dist ?? 999));
      setLlmSuggestions(withDist);
      setLlmLoaded(true);
    } catch (err) {
      setLlmError(err.message);
    } finally {
      setLlmLoading(false);
    }
  };

  const handleSelectLlm = async (sug) => {
    const match = (approvedCards || []).find(c =>
      c.title.toLowerCase() === sug.title?.toLowerCase()
    );
    if (match) { onSelect(match); return; }
    try {
      const newCard = await createCard({
        title: sug.title, description: sug.description || sug.summary, address: sug.address,
        lat: sug.lat, lng: sug.lng, image_url: sug.image_url,
        category: sug.category || 'attraction', david_approved: 1, jen_approved: 1,
        rating: sug.rating, opening_hours: sug.opening_hours,
        price_level: sug.price_level, place_id: sug.place_id,
      });
      const enriched = {
        ...newCard,
        lat: newCard.lat || sug.lat,
        lng: newCard.lng || sug.lng,
        rating: newCard.rating || sug.rating,
        image_url: newCard.image_url || sug.image_url,
        description: newCard.description || sug.description || sug.summary,
        opening_hours: newCard.opening_hours || sug.opening_hours,
        price_level: newCard.price_level ?? sug.price_level,
      };
      onSelect(enriched);
    } catch {
      onClose();
    }
  };

  return (
    <div className="sug-picker-overlay" onClick={onClose}>
      <div className="sug-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="sug-picker-header">
          <h3>Pick a spot</h3>
          <button className="sug-picker-close" onClick={onClose}>×</button>
        </div>

        {nearbyCards.length > 0 && (
          <>
            <div className="sug-picker-section-label">From your ideas</div>
            <div className="sug-picker-list">
              {nearbyCards.map(card => (
                <SpotCard
                  key={card.id}
                  card={card}
                  variant="compact"
                  distance={card._dist}
                  onClick={() => onSelect(card)}
                />
              ))}
            </div>
          </>
        )}

        {nearbyCards.length === 0 && !llmLoaded && (
          <p className="sug-picker-empty">No matching ideas left — try AI suggestions below.</p>
        )}

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
                  <SpotCard
                    key={`llm-${i}`}
                    card={sug}
                    variant="compact"
                    distance={sug._dist}
                    reasoning={sug.reasoning}
                    onClick={() => handleSelectLlm(sug)}
                  />
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
