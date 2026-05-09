# Booking Calendar Feature

## Overview
A new feature that extracts booking deadlines from card timing data and presents them in a prioritized calendar view, helping travelers know when to book attractions, restaurants, and experiences.

## How It Works

### Backend (`server/index.js`)

1. **New API Endpoint**: `GET /api/booking-calendar?arrivalDate=YYYY-MM-DD`
   - Takes arrival date as query parameter
   - Extracts booking deadlines from all cards with timing data
   - Returns prioritized list sorted by urgency

2. **Smart Extraction Logic** (`extractBookingDeadline` function)
   - Parses timing text using regex patterns
   - Recognizes various booking requirement formats:
     - "Buy tickets on the 10th of each month" → Monthly sales dates
     - "Book months ahead" → 2 months advance booking
     - "Book 1-2 weeks in advance" → 2 weeks advance booking
     - "Advance reservations" → 2 weeks recommended
     - "lottery" → 45 days before (lottery entries)
     - "Purchase tickets online beforehand" → 3 days before
     - "Buy tickets in advance" → 1 week before

3. **Urgency Classification**
   - **Critical**: 60+ days before arrival (book now!)
   - **High**: 30-60 days before arrival (book soon)
   - **Medium**: 7-30 days before arrival (plan ahead)
   - **Low**: < 7 days before arrival

### Frontend

1. **New Component**: `BookingCalendar.jsx`
   - Modal overlay showing booking requirements
   - Groups items by urgency level
   - Shows deadline dates and days before arrival
   - Includes card images and descriptions
   - Links to official websites when available

2. **API Function**: `fetchBookingCalendar(arrivalDate)` in `api.js`

3. **UI Integration**
   - "Bookings" button added to header
   - Opens modal with arrival date from trip settings
   - Color-coded urgency badges
   - Summary showing counts of critical/overdue items

## Example Output for Nov 3, 2024 Arrival

### 🔴 Critical (Book Now - 60+ days ahead)
- **Nihonbashi Hamasho Tempura (Tenmatsu)** - Book 2 months in advance
  - Deadline: September 4, 2024
- **Muscle Girls** - Book 2 months in advance
  - Deadline: September 4, 2024

### 🟠 High Priority (30-60 days ahead)
- **Gundam Factory Odaiba Workshop** - Entry by lottery
  - Deadline: September 19, 2024
- **Nintendo Museum** - Entry by lottery
  - Deadline: September 19, 2024

### 🟡 Medium Priority (7-30 days ahead)
- **Ghibli Museum Workshop** - Tickets go on sale Oct 10
  - Sale Date: October 10, 2024
- **Shibuya Sky Observation Deck** - Book 2 weeks in advance
  - Deadline: October 20, 2024
- **Sushi Zanmai Tsukiji Honten** - Advance reservations
  - Deadline: October 20, 2024

## Usage

1. Set your trip dates in the trip settings
2. Click the "Bookings" button in the header
3. View prioritized list of items requiring advance booking
4. Items are sorted by urgency (most critical first)
5. Overdue items (past deadline) shown separately with warning

## Technical Details

### Regex Patterns Used
```javascript
{ regex: /buy\s+tickets\s+on\s+the\s+(\d+)(?:st|nd|rd|th)?\s+of\s+each\s+month/i, type: 'monthly' }
{ regex: /book\s+months\s+(ahead|in\s+advance)/i, multiplier: 30, unit: 'month', amount: 2 }
{ regex: /book\s+(\d+)\s+-\s*(\d+)\s+weeks?\s+in\s+advance/i, multiplier: 7, unit: 'week', range: true }
{ regex: /lottery/i, type: 'lottery' }
// ... and more
```

### Database Query
```sql
SELECT id, title, category, timing, address, image_url, link_url 
FROM cards 
WHERE timing IS NOT NULL AND timing != ''
```

## Future Enhancements

1. **Smart Notifications**: Email/reminders when booking deadlines approach
2. **Direct Booking Links**: Integrate with booking platforms (Klook, TableCheck, etc.)
3. **Booking Status Tracking**: Mark items as "booked" with confirmation details
4. **Calendar Export**: Export to Google Calendar/iCal with reminder dates
5. **Price Tracking**: Monitor price changes for bookable items
6. **AI Suggestions**: Suggest booking platforms based on venue type

## Files Modified/Created

- `server/index.js` - Added `/api/booking-calendar` endpoint and extraction logic
- `src/lib/api.js` - Added `fetchBookingCalendar()` function
- `src/components/BookingCalendar.jsx` - New component
- `src/components/BookingCalendar.css` - New styles
- `src/App.jsx` - Added button and modal integration
- `src/app.css` - Added button styles
