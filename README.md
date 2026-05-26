# motherly_chatbot

Maternal healthcare chatbot platform (**Mothrly Chat**). Users chat via a floating UI; FastAPI handles AI conversation, and Node.js persists bookings to PostgreSQL with optional WhatsApp notifications.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Vanilla JS + embed / Next.js widget |
| Chat API | FastAPI + OpenAI (port 8000) |
| Booking API | Express + PostgreSQL (port 5000) |

## Quick start

```bash
# Node backend
cd node-backend
npm install
npm run setup:db
npm run dev

# Python backend (separate terminal)
cd backend
pip install -r requirements.txt
python main.py
```

- Chat UI: http://localhost:8000
- Booking API health: http://localhost:5000/api/health

Copy `.env` files from the project docs (`node-backend/.env`, `backend/.env`). Never commit secrets.

## Embed

Use `frontend/embed.html` or `frontend/nextjs/MothrlyChatWidget.tsx` to embed the widget on other sites.
