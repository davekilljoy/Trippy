import { useState, useRef, useEffect, useMemo } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { suggestForSlots, createCard } from '../lib/api.js';
import './SlotDropZone.css';

const SLOT_TYPE_LABELS = {
  morning: 'Morning',
  midday: 'Midday',
  afternoon: 'Afternoon',
  evening: 'Evening',
  after_hours: 'After Hours',
  // Legacy slot types
  lunch: 'Midday',
  dinner: 'Evening',
  late_afternoon: 'Afternoon',
  breakfast: 'Morning',
  activity: 'Activity',
};

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

export default function SlotDropZone({
  slot,
  card,
  dayNum,
  markerNum,
  itineraryId,
  anchorLat,
  anchorLng,
  approvedCards,
  placedCardMap,
  onRemove,
  onSelect,
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [prompt, setPrompt] = useState('');
  const [llmSuggestions, setLlmSuggestions] = useState([]);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmLoaded, setLlmLoaded] = useState(false);
  const dropdownRef = useRef(null);
  const filterRef = useRef(null);

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `slot-${dayNum}-${slot.slot_id}`,
    data: { type: 'slot', dayNum, slotId: slot.slot_id },
  });

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `slotcard-${dayNum}-${slot.slot_id}`,
    data: { type: 'slot-card', card, dayNum, slotId: slot.slot_id },
    disabled: !card,
  });

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus filter when dropdown opens
  useEffect(() => {
    if (open && filterRef.current) filterRef.current.focus();
  }, [open]);

  // All approved cards (no category restriction), proximity-sorted, with text filter
  const nearbyCards = useMemo(() => {
    if (!open) return [];
    let available = (approvedCards || []).filter(c => {
      if (placedCardMap[c.id]) return false;
      if (c.category === 'hotel') return false;
      return true;
    });

    // Text filter
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      available = available.filter(c =>
        c.title?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q) ||
        c.address?.toLowerCase().includes(q)
      );
    }

    if (anchorLat && anchorLng) {
      return available
        .filter(c => c.lat && c.lng)
        .map(c => ({ ...c, _dist: haversine(anchorLat, anchorLng, c.lat, c.lng) }))
        .sort((a, b) => a._dist - b._dist);
    }
    return available;
  }, [open, filter, approvedCards, placedCardMap, anchorLat, anchorLng]);

  const handleAskAI = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setLlmLoading(true);
    setLlmLoaded(false);
    try {
      const allPlaced = Object.keys(placedCardMap).map(Number);
      const result = await suggestForSlots(itineraryId, dayNum, {
        slots: [{ slot_index: 0, slot_type: prompt.trim(), duration_mins: 90 }],
        anchor_lat: anchorLat,
        anchor_lng: anchorLng,
        placed_card_ids: allPlaced,
      });
      const raw = result.suggestions?.['0'] || [];
      const withDist = raw.map(s => ({
        ...s,
        _dist: (s.lat && s.lng && anchorLat && anchorLng)
          ? haversine(anchorLat, anchorLng, s.lat, s.lng) : null,
      }));
      withDist.sort((a, b) => (a._dist ?? 999) - (b._dist ?? 999));
      setLlmSuggestions(withDist);
      setLlmLoaded(true);
    } catch { /* ignore */ } finally {
      setLlmLoading(false);
    }
  };

  const handleSelectCard = (c) => {
    onSelect(c);
    setOpen(false);
    setFilter('');
    setPrompt('');
    setLlmLoaded(false);
    setLlmSuggestions([]);
  };

  const handleSelectLlm = async (sug) => {
    const match = (approvedCards || []).find(c => c.title.toLowerCase() === sug.title?.toLowerCase());
    if (match) { handleSelectCard(match); return; }
    try {
      const newCard = await createCard({
        title: sug.title, description: sug.description, address: sug.address,
        lat: sug.lat, lng: sug.lng, image_url: sug.image_url,
        category: sug.category || 'attraction', david_approved: 1, jen_approved: 1,
      });
      // Ensure lat/lng/rating are on the card object even if server didn't return them
      const enriched = {
        ...newCard,
        lat: newCard.lat || sug.lat,
        lng: newCard.lng || sug.lng,
        rating: newCard.rating || sug.rating,
        image_url: newCard.image_url || sug.image_url,
        description: newCard.description || sug.description,
      };
      handleSelectCard(enriched);
    } catch {
      setOpen(false);
    }
  };

  const isEmpty = !card;

  return (
    <div
      ref={(node) => { setDropRef(node); dropdownRef.current = node; }}
      className={`slot-zone ${isEmpty ? 'empty' : 'filled'} ${isOver ? 'drag-over' : ''} ${isDragging ? 'dragging' : ''}`}
    >
      {card && (
        <div className="slot-filled-row">
          <span className="slot-marker-num">{markerNum || '·'}</span>
          <div ref={setDragRef} className="slot-card-content" {...listeners} {...attributes}>
            {card.image_url && <img src={card.image_url} alt="" className="slot-card-img" />}
            <div className="slot-card-details">
              <div className="slot-card-row">
                <span className="slot-card-title">{card.title}</span>
                <span className="slot-card-cat">{card.category}</span>
                {card.rating && <span className="slot-card-rating">{card.rating}★</span>}
                <button className="slot-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>×</button>
              </div>
              {(card.address || card.description || card.opening_hours || card.timing) && (
                <div className="slot-card-meta">
                  {card.address && <span className="slot-card-addr">{card.address}</span>}
                  {card.description && <span className="slot-card-desc">{card.description}</span>}
                  {card.opening_hours && <span className="slot-card-hours">{card.opening_hours}</span>}
                  {!card.opening_hours && card.timing && <span className="slot-card-hours">{card.timing}</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isEmpty && (
        <div className="slot-empty-row" onClick={() => setOpen(o => !o)}>
          <span className="slot-marker-empty" />
        </div>
      )}

      {open && (
        <div className="slot-dropdown">
          {/* Filter input */}
          <div className="slot-dd-filter-row">
            <input
              ref={filterRef}
              type="text"
              className="slot-dd-filter"
              placeholder="Filter ideas..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          {/* Approved cards list */}
          {nearbyCards.length > 0 && (
            <div className="slot-dd-cards">
              {nearbyCards.map(c => (
                <button key={c.id} className="slot-dd-item" onClick={() => handleSelectCard(c)}>
                  <span className="slot-dd-cat">{c.category}</span>
                  <span className="slot-dd-title">{c.title}</span>
                  {c._dist != null && (
                    <span className="slot-dd-dist">
                      {c._dist < 1 ? `${Math.round(c._dist * 1000)}m` : `${c._dist.toFixed(1)}km`}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {nearbyCards.length === 0 && (
            <div className="slot-dd-empty">No matching ideas</div>
          )}

          {/* AI prompt */}
          <div className="slot-dd-divider" />
          <form className="slot-dd-ai-form" onSubmit={handleAskAI}>
            <input
              type="text"
              className="slot-dd-ai-input"
              placeholder="Ask AI: e.g. &quot;ramen near here&quot; or &quot;something for kids&quot;"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <button type="submit" className="slot-dd-ai-go" disabled={llmLoading || !prompt.trim()}>
              {llmLoading ? '...' : 'Go'}
            </button>
          </form>

          {/* LLM results */}
          {llmLoading && (
            <div className="slot-dd-loading"><div className="status-spinner" /> Finding ideas...</div>
          )}
          {llmLoaded && llmSuggestions.length > 0 && (
            <div className="slot-dd-cards">
              {llmSuggestions.map((sug, i) => (
                <button key={`ai-${i}`} className="slot-dd-item ai" onClick={() => handleSelectLlm(sug)}>
                  <span className="slot-dd-cat">{sug.category}</span>
                  <span className="slot-dd-title">{sug.place_name || sug.title}</span>
                  {sug.rating && <span className="slot-dd-rating">{sug.rating}★</span>}
                  {sug._dist != null && (
                    <span className="slot-dd-dist">
                      {sug._dist < 1 ? `${Math.round(sug._dist * 1000)}m` : `${sug._dist.toFixed(1)}km`}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {llmLoaded && llmSuggestions.length === 0 && (
            <div className="slot-dd-empty">No AI suggestions</div>
          )}
        </div>
      )}
    </div>
  );
}
