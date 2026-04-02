import { useState, useCallback, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';
import { updateDaySlots, updateLegs } from '../lib/api.js';
import DaySlotEditor from './DaySlotEditor.jsx';
import LegHeader from './LegHeader.jsx';
import SplitDivider from './SplitDivider.jsx';
import './SkeletonBuilder.css';

export default function SkeletonBuilder({ itinerary, approvedCards, onUpdate }) {
  const [days, setDays] = useState(itinerary.days || []);
  const [activeCard, setActiveCard] = useState(null); // card being dragged
  const [activeDragType, setActiveDragType] = useState(null); // 'sidebar' | 'slot'
  // Seed extra cards from itinerary.cards (server returns slot-referenced cards too)
  const [extraCards, setExtraCards] = useState(() => {
    const approvedIds = new Set((approvedCards || []).map(c => c.id));
    return (itinerary.cards || []).filter(c => !approvedIds.has(c.id));
  });

  // Merge approved + itinerary cards so slots can always resolve card data
  const allCards = useMemo(() => {
    const map = new Map();
    for (const c of (approvedCards || [])) map.set(c.id, c);
    for (const c of (itinerary.cards || [])) map.set(c.id, c);
    for (const c of extraCards) map.set(c.id, c);
    return [...map.values()];
  }, [approvedCards, itinerary.cards, extraCards]);

  const hotels = useMemo(() =>
    allCards.filter(c => c.category === 'hotel'),
    [allCards]
  );

  // Track which cards are placed in slots
  const placedCardMap = useMemo(() => {
    const map = {}; // cardId -> dayNum
    for (const day of days) {
      for (const slot of (day.stops || [])) {
        if (slot.card_id) map[slot.card_id] = day.day_number;
      }
    }
    return map;
  }, [days]);

  // Group days into legs by consecutive hotel_id
  const legs = useMemo(() => {
    const result = [];
    let current = null;
    for (const day of days) {
      if (!current || current.hotel_id !== day.hotel_id) {
        current = { hotel_id: day.hotel_id, days: [day] };
        result.push(current);
      } else {
        current.days.push(day);
      }
    }
    return result;
  }, [days]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // --- Drag handlers ---

  const handleDragStart = useCallback((event) => {
    const { active } = event;
    const data = active.data.current;
    if (data?.type === 'sidebar-card') {
      setActiveCard(data.card);
      setActiveDragType('sidebar');
    } else if (data?.type === 'slot-card') {
      setActiveCard(data.card);
      setActiveDragType('slot');
    }
  }, []);

  const handleDragEnd = useCallback(async (event) => {
    const { active, over } = event;
    setActiveCard(null);
    setActiveDragType(null);

    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    // --- Sidebar card dropped onto a slot ---
    if (activeData?.type === 'sidebar-card' && overData?.type === 'slot') {
      const { dayNum, slotId } = overData;
      const card = activeData.card;

      setDays(prev => prev.map(d => {
        if (d.day_number !== dayNum) return d;
        const newStops = (d.stops || []).map(s =>
          s.slot_id === slotId ? { ...s, card_id: card.id } : s
        );
        return { ...d, stops: newStops };
      }));

      // Persist
      const day = days.find(d => d.day_number === dayNum);
      if (day) {
        const newSlots = (day.stops || []).map(s =>
          s.slot_id === slotId ? { ...s, card_id: card.id } : s
        );
        await updateDaySlots(itinerary.id, dayNum, newSlots);
      }
    }

    // --- Slot card dropped onto another slot ---
    if (activeData?.type === 'slot-card' && overData?.type === 'slot') {
      const srcDay = activeData.dayNum;
      const srcSlotId = activeData.slotId;
      const dstDay = overData.dayNum;
      const dstSlotId = overData.slotId;
      const card = activeData.card;

      if (srcDay === dstDay && srcSlotId === dstSlotId) return;

      setDays(prev => {
        const updated = prev.map(d => {
          if (d.day_number === srcDay) {
            const newStops = (d.stops || []).map(s =>
              s.slot_id === srcSlotId ? { ...s, card_id: null } : s
            );
            // If same day, also fill the target
            if (srcDay === dstDay) {
              return { ...d, stops: newStops.map(s =>
                s.slot_id === dstSlotId ? { ...s, card_id: card.id } : s
              )};
            }
            return { ...d, stops: newStops };
          }
          if (d.day_number === dstDay && srcDay !== dstDay) {
            const newStops = (d.stops || []).map(s =>
              s.slot_id === dstSlotId ? { ...s, card_id: card.id } : s
            );
            return { ...d, stops: newStops };
          }
          return d;
        });
        return updated;
      });

      // Persist
      const srcDayObj = days.find(d => d.day_number === srcDay);
      const dstDayObj = days.find(d => d.day_number === dstDay);
      if (srcDayObj) {
        const srcSlots = (srcDayObj.stops || []).map(s =>
          s.slot_id === srcSlotId ? { ...s, card_id: null } : s
        );
        if (srcDay === dstDay) {
          const combined = srcSlots.map(s =>
            s.slot_id === dstSlotId ? { ...s, card_id: card.id } : s
          );
          await updateDaySlots(itinerary.id, srcDay, combined);
        } else {
          await updateDaySlots(itinerary.id, srcDay, srcSlots);
          if (dstDayObj) {
            const dstSlots = (dstDayObj.stops || []).map(s =>
              s.slot_id === dstSlotId ? { ...s, card_id: card.id } : s
            );
            await updateDaySlots(itinerary.id, dstDay, dstSlots);
          }
        }
      }
    }

    // --- Card dropped on sidebar (unassign) ---
    if (activeData?.type === 'slot-card' && overData?.type === 'sidebar-drop') {
      const srcDay = activeData.dayNum;
      const srcSlotId = activeData.slotId;

      setDays(prev => prev.map(d => {
        if (d.day_number !== srcDay) return d;
        const newStops = (d.stops || []).map(s =>
          s.slot_id === srcSlotId ? { ...s, card_id: null } : s
        );
        return { ...d, stops: newStops };
      }));

      const day = days.find(d => d.day_number === srcDay);
      if (day) {
        const newSlots = (day.stops || []).map(s =>
          s.slot_id === srcSlotId ? { ...s, card_id: null } : s
        );
        await updateDaySlots(itinerary.id, srcDay, newSlots);
      }
    }
  }, [days, itinerary.id]);

  // --- Select card from dropdown into a slot ---
  const handleSelect = useCallback(async (dayNum, slotId, card) => {
    // If this card isn't in approvedCards, stash it so slots can render it
    if (!(approvedCards || []).some(c => c.id === card.id)) {
      setExtraCards(prev => prev.some(c => c.id === card.id) ? prev : [...prev, card]);
    }
    setDays(prev => prev.map(d => {
      if (d.day_number !== dayNum) return d;
      const newStops = (d.stops || []).map(s =>
        s.slot_id === slotId ? { ...s, card_id: card.id } : s
      );
      return { ...d, stops: newStops };
    }));
    const day = days.find(d => d.day_number === dayNum);
    if (day) {
      const newSlots = (day.stops || []).map(s =>
        s.slot_id === slotId ? { ...s, card_id: card.id } : s
      );
      await updateDaySlots(itinerary.id, dayNum, newSlots);
    }
  }, [days, itinerary.id, approvedCards]);

  // --- Leg splitting ---
  const handleSplit = useCallback(async (afterDayNum) => {
    const newLegs = [];
    let currentHotel = days[0]?.hotel_id;
    let start = 1;

    for (const day of days) {
      if (day.day_number === afterDayNum + 1) {
        // This is the split point — new leg starts with null hotel
        newLegs.push({ startDay: start, endDay: afterDayNum, hotel_id: currentHotel });
        start = afterDayNum + 1;
        currentHotel = null; // new leg needs hotel assignment
      }
      if (day.day_number === days[days.length - 1].day_number) {
        newLegs.push({ startDay: start, endDay: day.day_number, hotel_id: currentHotel });
      }
    }

    const result = await updateLegs(itinerary.id, newLegs);
    if (result.days) {
      setDays(result.days.map(d => ({
        ...d,
        stops: d.stops || (d.stops_json ? JSON.parse(d.stops_json) : []),
      })));
    }
  }, [days, itinerary.id]);

  // --- Hotel change on a leg ---
  const handleHotelChange = useCallback(async (legDays, hotelId) => {
    const newLegs = [];
    let currentHotel = null;
    let start = null;

    for (const day of days) {
      const isInLeg = legDays.some(ld => ld.day_number === day.day_number);
      const hid = isInLeg ? hotelId : day.hotel_id;

      if (currentHotel !== hid || start === null) {
        if (start !== null) {
          newLegs.push({ startDay: start, endDay: day.day_number - 1, hotel_id: currentHotel });
        }
        start = day.day_number;
        currentHotel = hid;
      }
    }
    if (start !== null) {
      newLegs.push({ startDay: start, endDay: days[days.length - 1].day_number, hotel_id: currentHotel });
    }

    const result = await updateLegs(itinerary.id, newLegs);
    if (result.days) {
      setDays(result.days.map(d => ({
        ...d,
        stops: d.stops || (d.stops_json ? JSON.parse(d.stops_json) : []),
      })));
    }
  }, [days, itinerary.id]);

  // --- Add slot to a day ---
  const handleAddSlot = useCallback(async (dayNum) => {
    const day = days.find(d => d.day_number === dayNum);
    if (!day) return;
    const slots = [...(day.stops || [])];
    const newSlot = {
      slot_id: Math.random().toString(36).slice(2, 10),
      slot_type: 'afternoon',
      card_id: null,
      order: slots.length,
    };
    slots.push(newSlot);
    setDays(prev => prev.map(d =>
      d.day_number === dayNum ? { ...d, stops: slots } : d
    ));
    await updateDaySlots(itinerary.id, dayNum, slots);
  }, [days, itinerary.id]);

  // --- Remove slot from a day ---
  const handleRemoveSlot = useCallback(async (dayNum, slotId) => {
    const day = days.find(d => d.day_number === dayNum);
    if (!day) return;
    const slots = (day.stops || []).filter(s => s.slot_id !== slotId);
    setDays(prev => prev.map(d =>
      d.day_number === dayNum ? { ...d, stops: slots } : d
    ));
    await updateDaySlots(itinerary.id, dayNum, slots);
  }, [days, itinerary.id]);


  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="skeleton-layout">
        <div className="skeleton-sidebar">
          <h3 className="skeleton-sidebar-title">Your Ideas</h3>
          <SidebarDropZone>
            {(approvedCards || []).filter(c => c.category !== 'hotel').map(card => (
              <SidebarCard
                key={card.id}
                card={card}
                placedDay={placedCardMap[card.id]}
              />
            ))}
          </SidebarDropZone>
        </div>

        <div className="skeleton-main">
          {legs.map((leg, legIdx) => {
            const hotel = hotels.find(h => h.id === leg.hotel_id);
            return (
              <div key={legIdx} className="skeleton-leg">
                <LegHeader
                  hotel={hotel}
                  hotels={hotels}
                  days={leg.days}
                  onHotelChange={(hotelId) => handleHotelChange(leg.days, hotelId)}
                />
                {leg.days.map((day, dayIdx) => (
                  <div key={day.day_number}>
                    <DaySlotEditor
                      day={day}
                      cards={allCards}
                      itineraryId={itinerary.id}
                      approvedCards={allCards}
                      placedCardMap={placedCardMap}
                      hotels={hotels}
                      onAddSlot={() => handleAddSlot(day.day_number)}
                      onRemoveSlot={(slotId) => handleRemoveSlot(day.day_number, slotId)}
                      onSelect={handleSelect}
                    />
                    {/* Split divider between days within a leg */}
                    {dayIdx < leg.days.length - 1 && (
                      <SplitDivider
                        type="within-leg"
                        onSplit={() => handleSplit(day.day_number)}
                      />
                    )}
                  </div>
                ))}
                {/* Divider between legs */}
                {legIdx < legs.length - 1 && (
                  <SplitDivider type="between-legs" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeCard && (
          <div className="drag-preview">
            <span className="drag-preview-cat">{activeCard.category}</span>
            <span className="drag-preview-title">{activeCard.title}</span>
          </div>
        )}
      </DragOverlay>

    </DndContext>
  );
}

// --- Sidebar drop zone ---
function SidebarDropZone({ children }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'sidebar-drop', data: { type: 'sidebar-drop' } });
  return (
    <div ref={setNodeRef} className={`skeleton-sidebar-cards ${isOver ? 'drag-over' : ''}`}>
      {children}
    </div>
  );
}

// --- Haversine helper ---
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

// --- Sidebar draggable card ---
function SidebarCard({ card, placedDay }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `sidebar-${card.id}`,
    data: { type: 'sidebar-card', card },
  });

  return (
    <div
      ref={setNodeRef}
      className={`sidebar-drag-card ${placedDay ? 'placed' : ''} ${isDragging ? 'dragging' : ''}`}
      {...listeners}
      {...attributes}
    >
      <span className="sidebar-drag-cat">{card.category}</span>
      <span className="sidebar-drag-title">{card.title}</span>
      {placedDay && <span className="sidebar-drag-day">Day {placedDay}</span>}
    </div>
  );
}
