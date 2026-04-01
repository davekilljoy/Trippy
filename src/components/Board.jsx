import { useState } from 'react';
import IdeaCard from './IdeaCard.jsx';
import './Board.css';

const CATEGORIES = ['all', 'attraction', 'restaurant', 'hotel', 'experience', 'transport', 'shopping'];

export default function Board({ cards, approvedCount, totalCount, onAdd, onEdit, onDelete, onApprove }) {
  const [filter, setFilter] = useState('all');

  const filtered = filter === 'approved'
    ? cards.filter(c => c.david_approved && c.jen_approved)
    : filter === 'all' ? cards : cards.filter(c => c.category === filter);

  return (
    <div className="board">
      <div className="board-toolbar">
        <div className="filter-pills">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`pill ${filter === cat ? 'active' : ''}`}
              onClick={() => setFilter(cat)}
            >
              {cat}
            </button>
          ))}
          <button
            className={`pill pill-approved ${filter === 'approved' ? 'active' : ''}`}
            onClick={() => setFilter('approved')}
          >
            approved
          </button>
        </div>
        <div className="board-actions">
          <div className="stats-bar">
            <span className="stat-approved">{approvedCount} in itinerary</span>
            <span className="stat-sep">/</span>
            <span className="stat-total">{totalCount} total</span>
          </div>
          <button className="add-btn" onClick={onAdd}>+ Add Idea</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="board-empty">
          <p>No ideas yet. Add your first one!</p>
        </div>
      ) : (
        <div className="masonry">
          {filtered.map(card => (
            <IdeaCard
              key={card.id}
              card={card}
              onEdit={() => onEdit(card)}
              onDelete={() => onDelete(card.id)}
              onApprove={(person) => onApprove(card.id, person)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
