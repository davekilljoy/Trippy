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
import SpotCard from './SpotCard.jsx';
import './SkeletonBuilder.css';

export default function SkeletonBuilder({ itinerary, approvedCards, onUpdate, headerContent }) {
  const [days, setDays] = useState(itinerary.days || []);
  const [activeCard, setActiveCard] = useState(null);
  const [activeDragType, setActiveDragType] = useState(null);
  const [extraCards, setExtraCards] = useState(() => {
    const approvedIds = new Set((approvedCards || []).map(c => c.id));
    return (itinerary.cards || []).filter(c => !approvedIds.has(c.id));
  });

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

  const placedCardMap = useMemo(() => {
    const map = {};
    for (const day of days) {
      for (const slot of (day.stops || [])) {
        if (slot.card_id) map[slot.card_id] = day.day_number;
      }
    }
    return map;
  }, [days]);

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

    // Sidebar card → slot
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

      const day = days.find(d => d.day_number === dayNum);
      if (day) {
        const newSlots = (day.stops || []).map(s =>
          s.slot_id === slotId ? { ...s, card_id: card.id } : s
        );
        await updateDaySlots(itinerary.id, dayNum, newSlots);
      }
    }

    // Slot card → slot (swap)
    if (activeData?.type === 'slot-card' && overData?.type === 'slot') {
      const srcDay = activeData.dayNum;
      const srcSlotId = activeData.slotId;
      const dstDay = overData.dayNum;
      const dstSlotId = overData.slotId;
      const srcCard = activeData.card;

      if (srcDay === dstDay && srcSlotId === dstSlotId) return;

      const dstDayObj = days.find(d => d.day_number === dstDay);
      const dstSlot = (dstDayObj?.stops || []).find(s => s.slot_id === dstSlotId);
      const dstCardId = dstSlot?.card_id || null;

      if (srcDay === dstDay) {
        setDays(prev => prev.map(d => {
          if (d.day_number !== srcDay) return d;
          const newStops = (d.stops || []).map(s => {
            if (s.slot_id === srcSlotId) return { ...s, card_id: dstCardId };
            if (s.slot_id === dstSlotId) return { ...s, card_id: srcCard.id };
            return s;
          });
          return { ...d, stops: newStops };
        }));
        const dayObj = days.find(d => d.day_number === srcDay);
        if (dayObj) {
          const swapped = (dayObj.stops || []).map(s => {
            if (s.slot_id === srcSlotId) return { ...s, card_id: dstCardId };
            if (s.slot_id === dstSlotId) return { ...s, card_id: srcCard.id };
            return s;
          });
          await updateDaySlots(itinerary.id, srcDay, swapped);
        }
      } else {
        setDays(prev => prev.map(d => {
          if (d.day_number === srcDay) {
            return { ...d, stops: (d.stops || []).map(s =>
              s.slot_id === srcSlotId ? { ...s, card_id: dstCardId } : s
            )};
          }
          if (d.day_number === dstDay) {
            return { ...d, stops: (d.stops || []).map(s =>
              s.slot_id === dstSlotId ? { ...s, card_id: srcCard.id } : s
            )};
          }
          return d;
        }));
        const srcDayObj = days.find(d => d.day_number === srcDay);
        if (srcDayObj) {
          const srcSlots = (srcDayObj.stops || []).map(s =>
            s.slot_id === srcSlotId ? { ...s, card_id: dstCardId } : s
          );
          await updateDaySlots(itinerary.id, srcDay, srcSlots);
        }
        if (dstDayObj) {
          const dstSlots = (dstDayObj.stops || []).map(s =>
            s.slot_id === dstSlotId ? { ...s, card_id: srcCard.id } : s
          );
          await updateDaySlots(itinerary.id, dstDay, dstSlots);
        }
      }
    }

    // Slot card → sidebar (unassign)
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

  // Select card from dropdown into a slot
  const handleSelect = useCallback(async (dayNum, slotId, card) => {
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

  const handleSplit = useCallback(async (afterDayNum) => {
    const newLegs = [];
    let currentHotel = days[0]?.hotel_id;
    let start = 1;
    for (const day of days) {
      if (day.day_number === afterDayNum + 1) {
        newLegs.push({ startDay: start, endDay: afterDayNum, hotel_id: currentHotel });
        start = afterDayNum + 1;
        currentHotel = null;
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

  const handleAddSlot = useCallback(async (dayNum) => {
    const day = days.find(d => d.day_number === dayNum);
    if (!day) return;
    const slots = [...(day.stops || [])];
    slots.push({ slot_id: Math.random().toString(36).slice(2, 10), card_id: null, order: slots.length });
    setDays(prev => prev.map(d =>
      d.day_number === dayNum ? { ...d, stops: slots } : d
    ));
    await updateDaySlots(itinerary.id, dayNum, slots);
  }, [days, itinerary.id]);

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
        <aside className="skeleton-sidebar">
          {headerContent}
          <div className="sidebar-section">
            <h3 className="sidebar-heading">
              Your Ideas <span className="count-badge">{(approvedCards || []).filter(c => c.category !== 'hotel').length}</span>
            </h3>
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
        </aside>

        <main className="skeleton-main">
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
                    {dayIdx < leg.days.length - 1 && (
                      <SplitDivider
                        type="within-leg"
                        onSplit={() => handleSplit(day.day_number)}
                      />
                    )}
                  </div>
                ))}
                {legIdx < legs.length - 1 && (
                  <SplitDivider type="between-legs" />
                )}
              </div>
            );
          })}
        </main>
      </div>

      <DragOverlay>
        {activeCard && (
          <div className="drag-preview">
            <SpotCard card={activeCard} variant="compact" />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// Sidebar drop zone (for unassigning cards)
function SidebarDropZone({ children }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'sidebar-drop', data: { type: 'sidebar-drop' } });
  return (
    <div ref={setNodeRef} className={`sidebar-cards ${isOver ? 'drag-over' : ''}`}>
      {children}
    </div>
  );
}

// Sidebar draggable card
function SidebarCard({ card, placedDay }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `sidebar-${card.id}`,
    data: { type: 'sidebar-card', card },
  });

  return (
    <div
      ref={setNodeRef}
      className={`sidebar-drag-card ${isDragging ? 'dragging' : ''}`}
      {...listeners}
      {...attributes}
    >
      <SpotCard
        card={card}
        variant="compact"
        placed={placedDay || false}
      />
    </div>
  );
}
