import { useState } from 'react';
import './IdeaPicker.css';

const CATEGORY_ICONS = {
  attraction: '⛩', restaurant: '🍜', hotel: '🏨',
  experience: '🎋', transport: '🚅', shopping: '🛍',
};

export default function IdeaPicker({ ideas, onAdd, onFollowUp, onClose, loading, followUpLoading }) {
  const [selected, setSelected] = useState(() => new Set(ideas.map((_, i) => i)));
  const [followUp, setFollowUp] = useState('');

  const toggle = (i) => {
    setSelected(s => {
      const next = new Set(s);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(ideas.map((_, i) => i)));
  const selectNone = () => setSelected(new Set());

  const handleAdd = () => {
    const items = ideas.filter((_, i) => selected.has(i));
    if (items.length) onAdd(items);
  };

  const handleFollowUp = (e) => {
    e.preventDefault();
    if (!followUp.trim() || followUpLoading) return;
    onFollowUp(followUp);
    setFollowUp('');
  };

  return (
    <div className="picker-overlay">
      <div className="picker-panel">
        <div className="picker-header">
          <h2 className="picker-title">Generated Ideas</h2>
          <div className="picker-actions-top">
            <button className="picker-link" onClick={selectAll}>Select all</button>
            <button className="picker-link" onClick={selectNone}>Select none</button>
            <button className="picker-close" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="picker-list">
          {ideas.map((idea, i) => (
            <div
              key={i}
              className={`picker-item ${selected.has(i) ? 'selected' : ''}`}
              onClick={() => toggle(i)}
            >
              <div className="picker-check">
                {selected.has(i) ? '✓' : ''}
              </div>
              <div className="picker-img">
                {idea.image_url ? (
                  <img src={idea.image_url} alt={idea.title} />
                ) : (
                  <span className="picker-img-placeholder">
                    {CATEGORY_ICONS[idea.category] || '📍'}
                  </span>
                )}
              </div>
              <div className="picker-info">
                <div className="picker-info-top">
                  <span className="picker-cat">{idea.category}</span>
                  <h3 className="picker-item-title">{idea.title}</h3>
                  {idea.rating && <span className="picker-rating">{idea.rating}★</span>}
                </div>
                {idea.description && <p className="picker-desc">{idea.description}</p>}
                {idea.address && <p className="picker-addr">{idea.address}</p>}
                {idea.timing && <p className="picker-timing">{idea.timing}</p>}
              </div>
            </div>
          ))}

          {loading && (
            <div className="picker-loading">
              <div className="picker-spinner" />
              <span>Generating more ideas...</span>
            </div>
          )}
        </div>

        <div className="picker-footer">
          <form className="picker-followup" onSubmit={handleFollowUp}>
            <input
              type="text"
              value={followUp}
              onChange={e => setFollowUp(e.target.value)}
              placeholder="Ask for different ideas..."
              disabled={followUpLoading}
            />
            <button type="submit" disabled={!followUp.trim() || followUpLoading}>
              {followUpLoading ? '...' : 'More'}
            </button>
          </form>
          <div className="picker-footer-actions">
            <button className="picker-cancel" onClick={onClose}>Discard</button>
            <button
              className="picker-add"
              onClick={handleAdd}
              disabled={selected.size === 0}
            >
              Add {selected.size} to Board
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
