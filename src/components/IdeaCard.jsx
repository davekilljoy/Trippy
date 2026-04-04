import { useState } from 'react';
import './IdeaCard.css';

const CATEGORY_ICONS = {
  attraction: '⛩',
  restaurant: '🍜',
  hotel: '🏨',
  experience: '🎋',
  transport: '🚅',
  shopping: '🛍',
};

export default function IdeaCard({ card, onEdit, onDelete, onStar, distanceBadge, isAnchor }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const title = card.link_url
    ? <a href={card.link_url} target="_blank" rel="noopener noreferrer">{card.title}</a>
    : card.title;

  return (
    <div className={`idea-card ${isAnchor ? 'idea-card--anchor' : ''}`} data-card-id={card.id}>

      <div className="card-image">
        {card.image_url ? (
          <img src={card.image_url} alt={card.title} loading="lazy" />
        ) : (
          <div className="card-image-placeholder">
            <span>{CATEGORY_ICONS[card.category] || '📍'}</span>
          </div>
        )}
        <span className="card-category-badge">{card.category}</span>
        {card.rating && <span className="card-rating-badge">{card.rating}★</span>}
        <button
          className={`card-star-btn ${card.starred ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onStar(); }}
        >
          {card.starred ? '★' : '☆'}
        </button>
      </div>

      <div className="card-body">
        <div className="card-header">
          <h3 className="card-title">{title}</h3>
          <div className="card-menu-wrap">
            <button className="card-menu-btn" onClick={() => setMenuOpen(!menuOpen)}>⋯</button>
            {menuOpen && (
              <div className="card-menu">
                <button onClick={() => { onEdit(); setMenuOpen(false); }}>Edit</button>
                <button className="danger" onClick={() => { onDelete(); setMenuOpen(false); }}>Remove</button>
              </div>
            )}
          </div>
        </div>

        {card.address && <p className="card-address">{card.address}</p>}
        {distanceBadge && (
          <p className="card-distance">{distanceBadge}</p>
        )}
        {card.description && <p className="card-desc">{card.description}</p>}
        {card.timing && <p className="card-timing">{card.timing}</p>}

        <div className="card-notes">
          {card.david_note && (
            <div className="note">
              <span className="avatar">D</span>
              <span className="note-text">{card.david_note}</span>
            </div>
          )}
          {card.jen_note && (
            <div className="note">
              <span className="avatar jen">J</span>
              <span className="note-text">{card.jen_note}</span>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
