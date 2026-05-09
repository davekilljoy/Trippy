import { useState } from 'react';
import { Star, Ellipsis, Info, Landmark, UtensilsCrossed, Hotel, Sparkles, TrainFront, ShoppingBag, MapPin } from 'lucide-react';
import './IdeaCard.css';

const CATEGORY_ICONS = {
  attraction: Landmark,
  restaurant: UtensilsCrossed,
  hotel: Hotel,
  experience: Sparkles,
  transport: TrainFront,
  shopping: ShoppingBag,
};

const CATEGORY_COLORS = {
  attraction: 'var(--cat-attraction)',
  restaurant: '#b5291c',
  hotel: 'var(--accent)',
  experience: '#5b7a3a',
  shopping: '#8b5e9b',
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
            {(() => { const Icon = CATEGORY_ICONS[card.category] || MapPin; return <Icon size={32} />; })()}
          </div>
        )}
        <button
          className={`card-star-btn ${card.starred ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onStar(); }}
        >
          <Star size={14} fill={card.starred ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="card-body">
        <div className="card-header">
          <h3 className="card-title">{title}</h3>
          <div className="card-menu-wrap">
            <button className="card-menu-btn" onClick={() => setMenuOpen(!menuOpen)}><Ellipsis size={16} /></button>
            {menuOpen && (
              <div className="card-menu">
                <button onClick={() => { onEdit(); setMenuOpen(false); }}>Edit</button>
                <button className="danger" onClick={() => { onDelete(); setMenuOpen(false); }}>Remove</button>
              </div>
            )}
          </div>
        </div>

        {(card.category || card.rating) && (
          <div className="card-meta">
            {card.category && (
              <span className="card-meta-cat">
                <span
                  className="card-meta-cat-dot"
                  style={{ background: CATEGORY_COLORS[card.category] || 'var(--muted)' }}
                />
                {card.category}
              </span>
            )}
            {card.category && card.rating && <span className="card-meta-sep">·</span>}
            {card.rating && (
              <span className="card-meta-rating">
                <Star size={11} /> {card.rating}
              </span>
            )}
          </div>
        )}

        {card.address && <p className="card-address">{card.address}</p>}
        {distanceBadge && (
          <p className="card-distance">{distanceBadge}</p>
        )}
        {card.description && <p className="card-desc">{card.description}</p>}
        {card.timing && (
          <p className="card-timing">
            <Info size={14} className="card-timing-icon" />
            {card.timing}
          </p>
        )}

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
