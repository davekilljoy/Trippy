import { useState, useEffect, useRef } from 'react';
import { debouncedSearch, inferCategory } from '../lib/places.js';
import { generateDescription } from '../lib/api.js';
import './CardModal.css';

const CATEGORIES = ['attraction', 'restaurant', 'hotel', 'experience', 'transport', 'shopping'];

const EMPTY = {
  title: '',
  description: '',
  address: '',
  image_url: '',
  link_url: '',
  category: 'attraction',
  timing: '',
  david_note: '',
  jen_note: '',
};

export default function CardModal({ mode, card, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingDesc, setLoadingDesc] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (mode === 'edit' && card) {
      setForm({
        title: card.title || '',
        description: card.description || '',
        address: card.address || '',
        image_url: card.image_url || '',
        link_url: card.link_url || '',
        category: card.category || 'attraction',
        timing: card.timing || '',
        david_note: card.david_note || '',
        jen_note: card.jen_note || '',
      });
    }
  }, [mode, card]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSearchChange = (value) => {
    setSearch(value);
    debouncedSearch(value, (results) => {
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    });
  };

  const handlePickPlace = (place) => {
    // Google Places result has: name, address, image_url, lat, lng, website, summary, types
    const category = inferCategory(place) || form.category;
    setForm(f => ({
      ...f,
      title: place.name,
      address: place.address || '',
      image_url: place.image_url || f.image_url,
      link_url: place.website || f.link_url,
      category,
    }));
    setSearch('');
    setSuggestions([]);
    setShowSuggestions(false);

    // Generate description via LLM (Google summary is often too short)
    if (!place.summary || place.summary.length < 40) {
      setLoadingDesc(true);
      generateDescription(place.name, category, place.address).then(result => {
        if (typeof result === 'object' && result.description) {
          setForm(f => f.description ? f : { ...f, description: result.description });
          // Also grab place image if describe returned one
          if (result.place?.image_url && !f.image_url) {
            setForm(f => f.image_url ? f : { ...f, image_url: result.place.image_url });
          }
        } else if (result) {
          setForm(f => f.description ? f : { ...f, description: result });
        }
        setLoadingDesc(false);
      });
    } else {
      setForm(f => f.description ? f : { ...f, description: place.summary });
    }
  };

  const handleTitleBlur = () => {
    if (!form.title.trim()) return;
    if (!form.description && !loadingDesc) {
      setLoadingDesc(true);
      generateDescription(form.title, form.category, form.address).then(result => {
        const desc = typeof result === 'object' ? result.description : result;
        if (desc) setForm(f => f.description ? f : { ...f, description: desc });
        // Also use place image if available
        if (typeof result === 'object' && result.place?.image_url && !form.image_url) {
          setForm(f => f.image_url ? f : { ...f, image_url: result.place.image_url });
        }
        setLoadingDesc(false);
      });
    }
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;

    let data = { ...form };

    // Auto-generate description + fetch image if empty
    if (!data.description || !data.image_url) {
      try {
        setLoadingDesc(true);
        const result = await generateDescription(data.title, data.category, data.address);
        if (typeof result === 'object') {
          if (!data.description && result.description) data.description = result.description;
          if (!data.image_url && result.place?.image_url) data.image_url = result.place.image_url;
        } else if (!data.description && result) {
          data.description = result;
        }
        setLoadingDesc(false);
      } catch { setLoadingDesc(false); }
    }

    onSave(data);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">{mode === 'add' ? 'Add Idea' : 'Edit Idea'}</h2>

        <form onSubmit={handleSubmit}>
          {/* Category selector */}
          <div className="field">
            <label>Category</label>
            <div className="category-pills">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  type="button"
                  className={`cat-pill ${form.category === cat ? 'active' : ''}`}
                  onClick={() => set('category', cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Place search */}
          <div className="field" ref={wrapRef}>
            <label htmlFor="place-search">Search Japan</label>
            <input
              id="place-search"
              type="text"
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              onFocus={() => suggestions.length && setShowSuggestions(true)}
              placeholder="Search for a place in Japan..."
              autoComplete="off"
            />
            {showSuggestions && (
              <ul className="suggestions">
                {suggestions.map(s => (
                  <li key={s.place_id} onClick={() => handlePickPlace(s)}>
                    <span className="suggestion-name">{s.name}</span>
                    <span className="suggestion-addr">{s.address}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="field">
            <label htmlFor="title">Title *</label>
            <input
              id="title"
              type="text"
              value={form.title}
              onChange={e => set('title', e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="e.g. Tsukiji Outer Market"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="address">Address</label>
            <input
              id="address"
              type="text"
              value={form.address}
              onChange={e => set('address', e.target.value)}
              placeholder="Auto-filled from search, or type manually"
            />
          </div>

          <div className="field">
            <label htmlFor="description">
              Description
              {loadingDesc && <span className="field-loading"> generating...</span>}
            </label>
            <textarea
              id="description"
              className={loadingDesc ? 'loading' : ''}
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={3}
              placeholder={loadingDesc ? 'Generating description...' : 'What is this place / experience?'}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="image_url">
                Image {form.image_url?.startsWith('/api/') ? '(Google Places)' : 'URL'}
              </label>
              <input
                id="image_url"
                type="text"
                value={form.image_url}
                onChange={e => set('image_url', e.target.value)}
                placeholder="https://..."
                disabled={form.image_url?.startsWith('/api/')}
              />
            </div>
            <div className="field">
              <label htmlFor="link_url">Link URL</label>
              <input
                id="link_url"
                type="url"
                value={form.link_url}
                onChange={e => set('link_url', e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>

          {form.image_url && (
            <div className="image-preview">
              <img src={form.image_url} alt="Preview" onError={e => e.target.style.display = 'none'} />
            </div>
          )}

          <div className="field">
            <label htmlFor="timing">Timing</label>
            <input
              id="timing"
              type="text"
              value={form.timing}
              onChange={e => set('timing', e.target.value)}
              placeholder="e.g. Day 3 morning, book 2 months ahead"
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="david_note">David's Note</label>
              <input
                id="david_note"
                type="text"
                value={form.david_note}
                onChange={e => set('david_note', e.target.value)}
                placeholder="David's thoughts..."
              />
            </div>
            <div className="field">
              <label htmlFor="jen_note">Jen's Note</label>
              <input
                id="jen_note"
                type="text"
                value={form.jen_note}
                onChange={e => set('jen_note', e.target.value)}
                placeholder="Jen's thoughts..."
              />
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-save" disabled={loadingDesc}>
              {mode === 'add' ? 'Add Idea' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
