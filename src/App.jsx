import { useState, useEffect, useCallback } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import Board from './components/Board.jsx';
import ItineraryPanel from './components/ItineraryPanel.jsx';
import CardModal from './components/CardModal.jsx';
import IdeaPicker from './components/IdeaPicker.jsx';
import { fetchCards, fetchSettings, saveSettings, createCard, updateCard, deleteCard, toggleApproval, bulkCreateCards, generateIdeas } from './lib/api.js';

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

export default function App() {
  const [view, setView] = useState('board');
  const [cards, setCards] = useState([]);
  const [modal, setModal] = useState(null);
  const [destination, setDestination] = useState('Tokyo, Kyoto');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Generate bar + picker state
  const [genPrompt, setGenPrompt] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genStatus, setGenStatus] = useState('');
  const [pickerIdeas, setPickerIdeas] = useState(null);
  const [followUpLoading, setFollowUpLoading] = useState(false);

  // Load settings + cards on mount
  const loadCards = useCallback(async () => {
    const data = await fetchCards();
    setCards(data);
  }, []);

  useEffect(() => {
    loadCards();
    fetchSettings().then(s => {
      if (s.destination !== undefined) setDestination(s.destination);
      if (s.dateFrom !== undefined) setDateFrom(s.dateFrom);
      if (s.dateTo !== undefined) setDateTo(s.dateTo);
      if (s.adults !== undefined) setAdults(s.adults);
      if (s.children !== undefined) setChildren(s.children);
      setSettingsLoaded(true);
    });
  }, [loadCards]);

  // Save settings to server on change (debounced)
  useEffect(() => {
    if (!settingsLoaded) return;
    const timer = setTimeout(() => {
      saveSettings({ destination, dateFrom, dateTo, adults, children });
    }, 500);
    return () => clearTimeout(timer);
  }, [destination, dateFrom, dateTo, adults, children, settingsLoaded]);

  const handleCreate = async (data) => {
    await createCard(data);
    await loadCards();
    setModal(null);
  };

  const handleUpdate = async (id, data) => {
    await updateCard(id, data);
    await loadCards();
    setModal(null);
  };

  const handleDelete = async (id) => {
    await deleteCard(id);
    await loadCards();
  };

  const handleApprove = async (id, person) => {
    await toggleApproval(id, person);
    await loadCards();
  };

  const tripParams = () => ({ destination, dateFrom, dateTo, adults, children });

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!genPrompt.trim() || genLoading) return;
    setGenLoading(true);
    setGenStatus('Starting...');
    try {
      const result = await generateIdeas(
        { ...tripParams(), prompt: genPrompt },
        (status) => setGenStatus(status),
      );
      setPickerIdeas(result.ideas || []);
      setGenStatus('');
      setGenPrompt('');
    } catch (err) {
      setGenStatus(`Error: ${err.message}`);
      setTimeout(() => setGenStatus(''), 4000);
    } finally {
      setGenLoading(false);
    }
  };

  const handleFollowUp = async (followUpPrompt) => {
    setFollowUpLoading(true);
    try {
      const result = await generateIdeas({ ...tripParams(), prompt: followUpPrompt });
      setPickerIdeas(prev => [...(prev || []), ...(result.ideas || [])]);
    } catch {
      // silently fail
    } finally {
      setFollowUpLoading(false);
    }
  };

  const handleAddSelected = async (items) => {
    await bulkCreateCards(items);
    await loadCards();
    setPickerIdeas(null);
  };

  const addChild = () => setChildren(c => [...c, 8]);
  const removeChild = (i) => setChildren(c => c.filter((_, idx) => idx !== i));
  const setChildAge = (i, age) => setChildren(c => c.map((a, idx) => idx === i ? Number(age) : a));

  const approvedCards = cards.filter(c => c.david_approved && c.jen_approved);
  const pendingCards = cards.filter(c => !(c.david_approved && c.jen_approved));

  return (
    <APIProvider apiKey={GOOGLE_MAPS_KEY}>
      <header className="app-header">
        <h1 className="app-title">Japan Planner <span>日本の旅</span></h1>
        <div className="header-controls">
          <input
            type="text"
            value={destination}
            onChange={e => setDestination(e.target.value)}
            className="dest-input"
            placeholder="Where in Japan?"
          />
          <span className="header-sep">|</span>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="date-input"
          />
          <span className="date-sep">—</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="date-input"
          />
          <span className="header-sep">|</span>
          <div className="stepper-inline">
            <button onClick={() => setAdults(Math.max(1, adults - 1))}>−</button>
            <span>{adults} adult{adults !== 1 ? 's' : ''}</span>
            <button onClick={() => setAdults(adults + 1)}>+</button>
          </div>
          {children.map((age, i) => (
            <div key={i} className="child-tag">
              <span>child</span>
              <input
                type="number"
                min="0"
                max="17"
                value={age}
                onChange={e => setChildAge(i, e.target.value)}
                className="child-age-input"
              />
              <button onClick={() => removeChild(i)}>×</button>
            </div>
          ))}
          <button className="add-child-inline" onClick={addChild}>+ child</button>
        </div>
        <nav className="app-nav">
          <button
            className={`nav-btn ${view === 'board' ? 'active' : ''}`}
            onClick={() => setView('board')}
          >
            Board
          </button>
          <button
            className={`nav-btn ${view === 'itinerary' ? 'active' : ''}`}
            onClick={() => setView('itinerary')}
          >
            Itinerary
          </button>
        </nav>
      </header>

      {view === 'board' ? (
        <Board
          cards={cards}
          approvedCount={approvedCards.length}
          totalCount={cards.length}
          onAdd={() => setModal({ mode: 'add' })}
          onEdit={(card) => setModal({ mode: 'edit', card })}
          onDelete={handleDelete}
          onApprove={handleApprove}
        />
      ) : (
        <ItineraryPanel
          approvedCards={approvedCards}
          pendingCards={pendingCards}
        />
      )}

      {modal && (
        <CardModal
          mode={modal.mode}
          card={modal.card || null}
          onSave={modal.mode === 'add' ? handleCreate : (data) => handleUpdate(modal.card.id, data)}
          onClose={() => setModal(null)}
        />
      )}

      {/* Idea picker panel */}
      {pickerIdeas && (
        <IdeaPicker
          ideas={pickerIdeas}
          loading={followUpLoading}
          followUpLoading={followUpLoading}
          onAdd={handleAddSelected}
          onFollowUp={handleFollowUp}
          onClose={() => setPickerIdeas(null)}
        />
      )}

      {/* Floating generate bar — only on Board view */}
      {view === 'board' && !pickerIdeas && (
        <div className="gen-bar">
          {genLoading ? (
            <div className="gen-bar-loading">
              <div className="gen-spinner" />
              <span className="gen-status">{genStatus}</span>
            </div>
          ) : (
            <form className="gen-bar-form" onSubmit={handleGenerate}>
              <input
                type="text"
                value={genPrompt}
                onChange={e => setGenPrompt(e.target.value)}
                placeholder="Find itinerary ideas..."
                className="gen-input"
              />
              <button type="submit" className="gen-submit" disabled={!genPrompt.trim()}>Generate</button>
            </form>
          )}
          {genStatus && !genLoading && (
            <span className="gen-done-status">{genStatus}</span>
          )}
        </div>
      )}
    </APIProvider>
  );
}
