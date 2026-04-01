# Trippy — Japan Trip Planner

A collaborative trip planning app for Japan, built with React and Express. Collect ideas for places to visit, restaurants, hotels, and experiences on a shared board, then generate optimized day-by-day itineraries with AI assistance.

## Features

- **Idea Board** — Add and browse trip ideas as cards across categories: attractions, restaurants, hotels, experiences, transport, and shopping
- **Collaborative Approval** — Two-person approval system (David & Jen) — cards approved by both are promoted to the itinerary
- **AI Idea Generation** — Describe what you're looking for and get AI-generated suggestions via a local LLM (LM Studio), enriched with live web search (Tavily)
- **Google Places Integration** — Search for real places, auto-fill addresses, coordinates, and photos
- **Two-Phase Itinerary Builder** — AI proposes a day-by-day breakdown, you review and pick an optimization style (walkability, variety, etc.), then it finalizes with detailed schedules
- **Interactive Day Maps** — Google Maps integration showing each day's stops with walking/transit routes and polyline overlays
- **Per-Day Enrichment** — Stream detailed travel notes for each day from the LLM
- **Flight Tracking** — Log departure and return flight details alongside your itinerary
- **Versioned Itineraries** — Save multiple itinerary versions and switch between them
- **Persistent Settings** — Trip dates, destination, and traveler count are saved server-side

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite |
| Backend | Express 5, Node.js |
| Database | SQLite (better-sqlite3) |
| Maps | Google Maps API via `@vis.gl/react-google-maps` |
| AI | LM Studio (OpenAI-compatible local LLM) |
| Web Search | Tavily API |
| Places | Google Places API |

## Getting Started

### Prerequisites

- Node.js 18+
- [LM Studio](https://lmstudio.ai/) running locally (or any OpenAI-compatible API)

### Environment Variables

Create a `.env` file in the project root:

```env
# Google Maps & Places (required for maps and place search)
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key

# LM Studio (defaults to http://localhost:1234)
LM_STUDIO_URL=http://localhost:1234
LM_STUDIO_MODEL=your-model-name
LM_STUDIO_API_KEY=

# Tavily web search (optional, enriches AI suggestions)
TAVILY_API_KEY=your_tavily_api_key

# Server port (optional, defaults to 3737)
PORT=3737
```

### Install & Run

```bash
# Install dependencies for both client and server
npm install
cd server && npm install && cd ..

# Start both dev servers (frontend on :5174, backend on :3737)
npm run dev
```

The app will be available at `http://localhost:5174`.

### Build for Production

```bash
npm run build
```

## Project Structure

```
├── src/                    # React frontend
│   ├── App.jsx             # Main app — routing, settings, generate bar
│   ├── components/
│   │   ├── Board.jsx       # Idea card grid with category filters
│   │   ├── IdeaCard.jsx    # Individual idea card with approvals
│   │   ├── CardModal.jsx   # Add/edit card modal with place search
│   │   ├── IdeaPicker.jsx  # AI-generated idea selection panel
│   │   ├── ItineraryPanel.jsx  # Itinerary versions, proposal, and day view
│   │   ├── ProposalReview.jsx  # Review AI-proposed day breakdown
│   │   ├── DayCard.jsx     # Single day with stops, routes, enrichment
│   │   ├── DayMap.jsx      # Google Maps with markers and polylines
│   │   ├── FlightCard.jsx  # Flight display card
│   │   └── FlightForm.jsx  # Add/edit flight modal
│   └── lib/
│       ├── api.js          # API client with SSE streaming helpers
│       └── places.js       # Google Places search + category inference
├── server/
│   └── index.js            # Express API — cards, itineraries, LLM, places proxy
├── vite.config.js          # Vite config with API proxy
└── package.json
```

## How It Works

1. **Collect Ideas** — Add places manually or use the AI generate bar to get suggestions based on your trip parameters
2. **Approve Together** — Both travelers approve the ideas they want included
3. **Generate Itinerary** — The AI groups approved cards into logical days, proposes a schedule, and lets you pick an optimization strategy
4. **Finalize & Explore** — View each day on an interactive map with routes, enrich days with detailed LLM-written travel notes

## License

Private project.
