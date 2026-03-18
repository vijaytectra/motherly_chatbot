"""
main.py — FastAPI application for the Motherly chatbot.

Endpoints:
    POST /chat   — receives a user message, returns Mothrly Assistant's response.
    POST /book   — receives booking data, returns a booking confirmation with ID.
    GET  /       — serves the demo chat interface (static files).
"""

import os
import random
import string
from datetime import datetime
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional, Dict

from chatbot import get_chat_response, validate_booking_description

# ── FastAPI app ──────────────────────────────────────────────────────
app = FastAPI(
    title="Motherly Chatbot API",
    description="POC chatbot backend for the Motherly maternal healthcare platform.",
    version="0.2.0",
)

# ── CORS (allow everything for development) ─────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory booking store (replace with a real DB in production) ───
bookings: Dict[str, dict] = {}


# ── Request / Response models ───────────────────────────────────────
class MessageItem(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    """Body for the /chat endpoint."""
    message: str
    history: Optional[List[MessageItem]] = []

class ChatResponse(BaseModel):
    """Response from the /chat endpoint."""
    response: str
    tokens_used: int

class BookingRequest(BaseModel):
    """Body for the /book endpoint."""
    service: str
    date: str
    time: str
    location: str
    name: str
    phone: str
    email: str
    forSelf: bool = True
    relation: Optional[str] = "self"
    description: Optional[str] = None
    child_age_range: Optional[str] = None  # Nanny: e.g. "0-1", "1-3", "3+"
    child_names: Optional[str] = None      # Nanny: child(ren)'s name(s)

class BookingResponse(BaseModel):
    """Response from the /book endpoint."""
    bookingId: str
    status: str
    provider: str
    service: str
    date: str
    time: str
    location: str
    name: str
    message: str


class ValidateDescriptionRequest(BaseModel):
    """Body for the /validate-booking-description endpoint."""
    description: str
    service: str


class ValidateDescriptionResponse(BaseModel):
    """Response from the /validate-booking-description endpoint."""
    valid: bool
    message: Optional[str] = None  # Shown to user when valid=False


# ── Helpers ─────────────────────────────────────────────────────────
def generate_booking_id() -> str:
    """Generate a unique booking reference like MTH-482931."""
    digits = "".join(random.choices(string.digits, k=6))
    return f"MTH-{digits}"

def send_confirmation_stub(booking: dict):
    """
    Stub for SMS / email confirmation.
    In production, integrate Twilio (SMS) and SendGrid / SES (email) here.
    """
    print(f"[STUB] SMS to {booking['phone']}: Booking {booking['bookingId']} confirmed for {booking['service']} on {booking['date']} at {booking['time']}.")
    print(f"[STUB] Email to {booking['email']}: Booking confirmation for {booking['bookingId']}.")


# ── Validate booking description (LLM checks relevance) ─────────────
@app.post("/validate-booking-description", response_model=ValidateDescriptionResponse)
async def validate_description(request: ValidateDescriptionRequest):
    """
    Check if the user's booking description is relevant and valid for the service.
    Used before finalizing the booking to reject off-topic or invalid responses.
    """
    valid, message = validate_booking_description(request.description, request.service)
    return ValidateDescriptionResponse(valid=valid, message=message if not valid else None)


# ── Chat endpoint ───────────────────────────────────────────────────
@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Receive a user message and return Mothrly Assistant's AI-generated reply.
    """
    history_dicts = [{"role": msg.role, "content": msg.content} for msg in request.history]
    reply, tokens_used = get_chat_response(request.message, history_dicts)
    return ChatResponse(response=reply, tokens_used=tokens_used)


# ── Booking endpoint ────────────────────────────────────────────────
@app.post("/book", response_model=BookingResponse)
async def book(request: BookingRequest):
    """
    Receive a completed booking form, persist it, trigger confirmation stubs,
    and return a BookingResponse with a unique booking ID.
    """
    booking_id = generate_booking_id()
    created_at = datetime.utcnow().isoformat() + "Z"

    booking_record = {
        "bookingId":       booking_id,
        "status":          "confirmed",
        "provider":        "Will be assigned shortly",
        "service":         request.service,
        "date":            request.date,
        "time":            request.time,
        "location":        request.location,
        "name":            request.name,
        "phone":           request.phone,
        "email":           request.email,
        "forSelf":         request.forSelf,
        "relation":        request.relation,
        "description":     request.description,
        "child_age_range": request.child_age_range,
        "child_names":     request.child_names,
        "createdAt":       created_at,
    }

    # Persist in memory
    bookings[booking_id] = booking_record

    # Log & trigger confirmation stubs
    print(f"[BOOKING] New booking created: {booking_record}")
    send_confirmation_stub(booking_record)

    return BookingResponse(
        bookingId  = booking_id,
        status     = "confirmed",
        provider   = "Will be assigned shortly",
        service    = request.service,
        date       = request.date,
        time       = request.time,
        location   = request.location,
        name       = request.name,
        message    = (
            f"Your booking ({booking_id}) has been confirmed! "
            "A Motherly care specialist will contact you shortly. "
            "Confirmation has been sent via SMS and email."
        ),
    )


# ── Serve the frontend ──────────────────────────────────────────────
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

@app.get("/")
async def serve_index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

# Mount remaining static assets (CSS, JS, images)
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
