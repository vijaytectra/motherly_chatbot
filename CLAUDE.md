# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Mothrly Chat** is a maternal healthcare chatbot platform. Users interact via a floating chat UI; a FastAPI backend (Python) handles chat intelligence via OpenAI, and an Express backend (Node.js) handles booking persistence via PostgreSQL and WhatsApp notifications.

## Development Setup

### Node Backend (Port 5000)
```bash
cd node-backend
npm install
npm run setup:db   # One-time: creates PostgreSQL DB + schema
npm run dev        # nodemon auto-reload
```

### Python Backend (Port 8000)
```bash
cd backend
pip install -r requirements.txt
python main.py
# Or: uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Access
- Frontend UI: `http://localhost:8000` (served by FastAPI)
- Node API health: `http://localhost:5000/api/health`

## Environment Variables

**`node-backend/.env`**
```
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mothrly
DB_USER=postgres
DB_PASSWORD=yourpassword
ACCESS_TOKEN=your_whatsapp_cloud_api_token
PHONE_NUMBER_ID=your_meta_phone_number_id
ADMIN_WHATSAPP_NUMBER=+91XXXXXXXXXX
```

**`backend/.env`**
```
OPENAI_API_KEY=sk-proj-...
```

WhatsApp credentials are optional — the service falls back to mock/log mode when missing.

## Architecture

### Request Flow
1. User types → Frontend (`frontend/script.js`) POSTs to FastAPI `/chat`
2. FastAPI calls OpenAI GPT-4o mini (`backend/chatbot.py`), returns response
3. Chatbot embeds `<booking_data>{ JSON }</booking_data>` in reply when all 7 booking fields are collected
4. Frontend parses the tag, auto-advances the booking form
5. Frontend POSTs completed booking to Node API `/api/book`
6. Node persists to PostgreSQL and triggers WhatsApp confirmation to customer

### Services

| Layer | Tech | Entry Point | Purpose |
|-------|------|-------------|---------|
| Frontend | Vanilla JS (~6000 lines) | `frontend/script.js` | Chat UI, voice input, booking form, session state |
| Python API | FastAPI + OpenAI | `backend/main.py` | Chat intelligence, UI serving, LLM booking validation |
| Node API | Express + PostgreSQL | `node-backend/src/server.js` | Booking CRUD, WhatsApp notifications |

### Node Backend Layout
```
node-backend/src/
├── server.js                  # App setup, CORS, routes, DB startup check
├── config/db.js               # pg.Pool connection, verifyConnection()
├── routes/bookingRoutes.js    # Route definitions
├── controllers/bookingController.js  # Booking CRUD logic
├── services/whatsappService.js       # Meta Graph API v19.0 integration
└── db/schema.sql              # bookings table + indexes
```

### Node API Endpoints
- `POST /api/book` — create booking; normalizes phone/time; triggers WhatsApp
- `GET /api/bookings` — all bookings (admin)
- `GET /api/booking/:booking_id` — lookup by BOOK-XXXXX ID
- `PATCH /api/reschedule/:booking_id` — update date/time
- `DELETE /api/cancel/:booking_id` — delete booking

### Python API Endpoints
- `POST /chat` — multi-turn chat with history; returns response + tokens_used
- `POST /validate-booking-description` — LLM check that user description matches service
- `POST /book` — in-memory booking store (**not persisted to PostgreSQL**)
- `GET /` — serves `frontend/index.html`

### Chatbot System Prompt (`backend/chatbot.py`)
The system prompt (~388 lines) defines personality, 4-step booking flow, 7 required fields, multi-language support (EN/Tamil/Hindi/Telugu), and per-service flows (Doctor, Nanny, Doula, Breastfeeding, etc.). Edit it carefully — it directly controls conversation behavior.

### Frontend State
- `chatHistory[]` — conversation context sent with each `/chat` request
- `bookingState{}` — booking fields accumulated across steps
- `bookingPayload` — parsed from `<booking_data>` tags in bot replies
- Backed by `sessionStorage`; cleared on tab close

## Database

PostgreSQL `bookings` table (see `node-backend/src/db/schema.sql`). Key fields: `booking_id` (BOOK-XXXXX), `name`, `phone`/`customer_phone`, `service_provider`, `date`, `time`, `location`, `payment_status`.

Migration scripts: `node-backend/scripts/fix_db.js`, `upgrade_db.js` (run manually as needed).

## Known Issues / Technical Notes
- Python backend has its own `/book` endpoint with an in-memory store — this is **not** the persistent booking path; the Node API is.
- Frontend API base URLs default to `localhost:5000` / `localhost:8000` with runtime auto-discovery by hostname.
- No auth/authorization is implemented.
