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

export default function IdeaCard({ card, onEdit, onDelete, onApprove }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const bothApproved = card.david_approved && card.jen_approved;

  const title = card.link_url
    ? <a href={card.link_url} target="_blank" rel="noopener noreferrer">{card.title}</a>
    : card.title;

  return (
    <div className={`idea-card ${bothApproved ? 'approved-both' : ''}`}>
      {bothApproved && <div className="ribbon">In Itinerary</div>}

      <div className="card-image">
        {card.image_url ? (
          <img src={card.image_url} alt={card.title} loading="lazy" />
        ) : (
          <div className="card-image-placeholder">
            <span>{CATEGORY_ICONS[card.category] || '📍'}</span>
          </div>
        )}
        <span className="card-category-badge">{card.category}</span>
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

        <div className="card-approval">
          <button
            className={`approve-toggle ${card.david_approved ? 'active' : ''}`}
            onClick={() => onApprove('david')}
          >
            D
          </button>
          <span className="approval-label">
            {bothApproved ? 'Both approved' :
             card.david_approved ? 'David approved' :
             card.jen_approved ? 'Jen approved' :
             'No votes'}
          </span>
          <button
            className={`approve-toggle ${card.jen_approved ? 'active' : ''}`}
            onClick={() => onApprove('jen')}
          >
            J
          </button>
        </div>
      </div>
    </div>
  );
}
