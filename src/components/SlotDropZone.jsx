import { useState, useRef, useEffect, useMemo } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { Hotel } from 'lucide-react';
import { suggestForSlots, createCard } from '../lib/api.js';
import { haversine } from '../lib/geo.js';
import SpotCard from './SpotCard.jsx';
import './SlotDropZone.css';

export default function SlotDropZone({
  slot,
  card,
  dayNum,
  markerNum,
  itineraryId,
  anchorLat,
  anchorLng,
  anchorLabel,
  starredCards,
  placedCardMap,
  hotel,
  onRemove,
  onSelect,
  sortableProps,
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

  // Compute distance from anchor for the current card
  const cardDist = useMemo(() => {
    if (!card?.lat || !card?.lng || !anchorLat || !anchorLng) return null;
    return haversine(anchorLat, anchorLng, card.lat, card.lng);
  }, [card, anchorLat, anchorLng]);

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

  // Approved cards: proximity-sorted, text-filtered
  const nearbyCards = useMemo(() => {
    if (!open) return [];
    let available = (starredCards || []).filter(c => {
      if (placedCardMap[c.id]) return false;
      if (c.category === 'hotel') return false;
      return true;
    });

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
        .sort((a, b) => (a._dist ?? 999) - (b._dist ?? 999));
    }
    return available;
  }, [open, filter, starredCards, placedCardMap, anchorLat, anchorLng]);

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
    const match = (starredCards || []).find(c => c.title.toLowerCase() === sug.title?.toLowerCase());
    if (match) { handleSelectCard(match); return; }
    try {
      const newCard = await createCard({
        title: sug.title, description: sug.description || sug.summary, address: sug.address,
        lat: sug.lat, lng: sug.lng, image_url: sug.image_url,
        category: sug.category || 'attraction', starred: 1,
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
      handleSelectCard(enriched);
    } catch {
      setOpen(false);
    }
  };

  const isEmpty = !card;

  // Merge sortable transform style if provided
  const sortStyle = sortableProps?.transform
    ? { transform: `translate3d(${sortableProps.transform.x}px, ${sortableProps.transform.y}px, 0)`,
        transition: sortableProps.transition || undefined }
    : undefined;

  return (
    <div
      ref={(node) => {
        setDropRef(node);
        dropdownRef.current = node;
        if (sortableProps?.setNodeRef) sortableProps.setNodeRef(node);
      }}
      className={`slot-zone ${isEmpty ? 'empty' : 'filled'} ${isOver ? 'drag-over' : ''} ${isDragging ? 'dragging' : ''}`}
      style={sortStyle}
      {...(sortableProps?.attributes || {})}
    >
      {card && (
        <div className="slot-filled-row" ref={setDragRef} {...listeners} {...attributes}>
          <SpotCard
            card={card}
            variant="full"
            distance={cardDist}
            anchorLabel={anchorLabel}
            markerNum={markerNum}
            onRemove={onRemove}
          />
        </div>
      )}

      {isEmpty && (
        <div className="slot-empty-row" onClick={() => setOpen(o => !o)}>
          <span className="slot-marker-empty" />
        </div>
      )}

      {open && (
        <div className="slot-dropdown">
          {hotel && (
            <button className="slot-dd-hotel" onClick={() => handleSelectCard(hotel)}>
              <Hotel size={14} className="slot-dd-hotel-icon" />
              <span className="slot-dd-hotel-label">{hotel.title || 'Hotel'}</span>
            </button>
          )}
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

          {nearbyCards.length > 0 && (
            <div className="slot-dd-cards">
              {nearbyCards.map(c => (
                <SpotCard
                  key={c.id}
                  card={c}
                  variant="compact"
                  distance={c._dist}
                  onClick={() => handleSelectCard(c)}
                />
              ))}
            </div>
          )}
          {nearbyCards.length === 0 && (
            <div className="slot-dd-empty">No matching ideas</div>
          )}

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

          {llmLoading && (
            <div className="slot-dd-loading"><div className="status-spinner" /> Finding ideas...</div>
          )}
          {llmLoaded && llmSuggestions.length > 0 && (
            <div className="slot-dd-cards">
              {llmSuggestions.map((sug, i) => (
                <SpotCard
                  key={`ai-${i}`}
                  card={sug}
                  variant="compact"
                  distance={sug._dist}
                  reasoning={sug.reasoning}
                  onClick={() => handleSelectLlm(sug)}
                  className="ai"
                />
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
