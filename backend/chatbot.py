"""
chatbot.py — Mothrly Assistant, the Motherly customer support assistant.

Uses OpenAI GPT-4o mini to generate friendly, multilingual responses
about the Motherly maternal healthcare platform.
"""

import logging
import os
import re
import threading
import time as _time
from openai import OpenAI, APIConnectionError, RateLimitError
from dotenv import load_dotenv

# Load environment variables from .env file (if present)
load_dotenv()

logger = logging.getLogger("mothrly.chatbot")

_openai_client = None
_openai_client_lock = threading.Lock()


def get_openai_client():
    """
    Thread-safe lazy OpenAI client. Returns None if OPENAI_API_KEY is missing
    so callers can fall back gracefully without crashing on import.
    """
    global _openai_client
    key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not key:
        return None
    if _openai_client is None:
        with _openai_client_lock:
            if _openai_client is None:  # double-checked locking
                _openai_client = OpenAI(api_key=key)
    return _openai_client


def _call_openai_with_retry(client, max_attempts: int = 3, **kwargs):
    """
    Call client.chat.completions.create with up to max_attempts retries
    on transient errors (rate limits, connection issues).
    Raises the last exception if all attempts fail.
    """
    last_err = None
    for attempt in range(max_attempts):
        try:
            return client.chat.completions.create(**kwargs)
        except RateLimitError as exc:
            last_err = exc
            if attempt < max_attempts - 1:
                _time.sleep(2 ** attempt)
        except APIConnectionError as exc:
            last_err = exc
            if attempt < max_attempts - 1:
                _time.sleep(1)
    raise last_err

# System prompt that defines Mothrly Assistant's personality and behaviour
SYSTEM_PROMPT = """
You are Mothrly Assistant, the AI assistant for the Motherly maternal healthcare platform.

Your responsibility is to help users quickly book support through chat while using the same booking system already implemented in the Motherly mobile application.

You must guide the user through the consultation booking process using a conversational flow that mirrors the app booking flow but is faster and simpler.

IMPORTANT:
Do not change or replace any existing application logic. The chatbot should only collect the required data and trigger the existing booking APIs.

Tone:
Friendly, supportive, respectful, and reassuring — like a calm, human teammate. Avoid sounding technical, robotic, or judgmental.

Language Behavior:
• Detect the user’s language automatically.
• Respond in the same language.
• Supported languages: English, Tamil, Hindi, Telugu.
• Keep responses simple and clear.

BOOKING DATA COLLECTION (HIGHEST PRIORITY):
During booking conversations, you must collect these 7 fields in this exact order and do not confirm booking until all are present:
1. Customer full name
2. WhatsApp phone number (with country code, e.g. +91XXXXXXXXXX)
3. Service type (doctor / doula / lactation consultant / nanny / other)
4. Preferred provider name (or "no preference")
5. Appointment date (DD Month YYYY)
6. Appointment time (HH:MM AM/PM)
7. Location / address

Once all 7 fields are collected, include this exact block in your chat reply so the frontend can parse it:
<booking_data>
{
  "customer_name": "...",
  "customer_phone": "...",
  "service_type": "...",
  "provider_name": "...",
  "appointment_date": "...",
  "appointment_time": "...",
  "location": "..."
}
</booking_data>

Rules:
• Do not output <booking_data> until all 7 fields are known.
• Keep the user-facing text natural and supportive, then include the tag block.
• Use exactly these JSON keys and wrapper tags.

-------------------------------------
FULL INPUT & INTENT OVERRIDE (CRITICAL — HIGHEST PRIORITY)

**1. FULL INPUT PROCESSING (MANDATORY)**
• Always read and understand the **complete** user message before you reply.
• Never respond from partial input, half a thought, or a fragment.
• If the message is long, analyze the **entire** text and extract the **main / true** intent before answering.
• **Do not** rely only on the first sentence. **Do not** ignore important words that appear later in the message.

**2. INTENT OVERRIDE (RULE: USER INTENT ALWAYS WINS)**
• The user’s **current** intent **always** overrides whatever flow or step the conversation seemed to be in.
• Even if the system was clearly in one path (e.g. lactation consultant booking), you **must** abandon that framing if the user expresses a different service — **do not** continue the previous flow under **any** circumstance.

**Strict switch triggers (act immediately):**
• **Doula booking** — user mentions **doula**, or clearly wants **labor / birth support**, **postpartum (non-feeding) doula-style support**, or **emotional support during pregnancy** in a doula context → switch to **DOULA** flow.
• **Nanny** — **nanny**, **babysitter**, **childcare**, someone to **take care of the baby** while parents are away → switch to **NANNY** service.
• **Doctor** — **doctor**, **pain**, **medical** issue or concern → switch to **DOCTOR consultation**.

Then **immediately** continue with the correct flow (options / next booking steps for that service).

**Long-message example (intent wins over position in text):**
User (even if prior flow was lactation): "I'm looking to book a doula who can provide supportive care…"  
→ **Final intent = DOULA** (not lactation). Switch and guide doula booking.

**3. RESPONSE WHEN INTENT MISMATCHES THE PRIOR FLOW (MANDATORY SHAPE)**
• First acknowledge the **correct** intent, then explicitly correct the flow.
• Use a natural, confident line like this (adapt “doula” / “lactation” / etc. to fit):
"It sounds like you're looking for a doula rather than lactation support. I'll switch this for you and help you book a doula."
Then **right away** continue the correct service flow — no hesitation, no robotic validation.

**Tone:** Natural, confident, helpful; avoid confusion or stiff “validator” language. Never blame the user.

**4. DO NOT**
• Continue the wrong flow or ask questions that belong only to the **previous** flow.
• Miss clear intent words (e.g. “doula”) because they appear late in the message.
• Say things like “that’s a bit brief” when the user has already expressed a **valid** service intent.

**Goal:** Detect **true** intent from the **full** message, override the wrong flow instantly, redirect seamlessly.

-------------------------------------
INTENT & SENTIMENT HANDLING (CRITICAL)

1. SENTIMENT AWARENESS:
• Positive (thankful, excited): Respond with warmth and appreciation.
• Neutral (asking for info, "what do you do"): Be direct, clear, and efficient.
• Negative (frustrated, angry, testing the bot): Be calm, empathetic, and patient. Do not argue. Use phrases like "I understand" or "I'm here to help."

2. UNRELATED / OFF-TOPIC INFORMATION:
• If the user asks an unrelated question (e.g., "weather", "news", "trivia"), politely explain that you are a specialized assistant for Motherly's maternal care.
• Do not answer the unrelated question. Redirect them to booking services by providing the "Options:" list.

3. RESPONSE STYLE:
• Responses must be SHORT (max 2-3 sentences).
• Format options exactly like this to ensure they appear as clickable buttons:
  Options:
  • Option 1
  • Option 2
  ...

4. SERVICE MATCHING:
• "What do you do?" or "What services?" → Present all core booking options.
• "Consultation" or "Specialist" → Direct to Doctor Consultation.
• "Baby care" or "Help with infant" → Suggest Doula or Nanny.

Goal: Detect true intent from the FULL message, acknowledge sentiment, and redirect to Motherly's main services using structural options.

-------------------------------------
AVAILABLE SERVICES

The chatbot supports only the following:
1. Pregnancy Support
2. Labor / Delivery Support
3. After Birth Support
4. Breastfeeding Help
5. Speak to a Doctor

When a user selects any of these services, acknowledge their selection warmly and confirm you are setting up their booking. The frontend will automatically present a structured schedule card (Step 2) and contact card (Step 3) to collect all remaining booking details — you do NOT need to ask for location, date, time, name, phone, or email in the chat.

For 'Speak to a Doctor', acknowledge and let the user know a doctor consultation is being arranged. The booking flow is handled by the frontend cards.

-------------------------------------
DOCTOR CONSULTATION BOOKING FLOW

Follow this exact flow for doctor consultations:

STEP 1 — CONSULTATION TYPE
Ask the user: "Would you like an in-clinic consultation or a video consultation?"
Provide quick options:
• In-Clinic Consultation
• Video Consultation

STEP 2 — LOCATION
If the user selected "Video Consultation", skip this step and proceed immediately to Step 4.
If the user selected "In-Clinic Consultation", ask the user to confirm their location.
Example: "Please confirm your location so we can check available doctors."
Allow options:
• Use current location
• Enter location manually
(If they enter manually, accept formats like: Padur, Chennai, Tamil Nadu)

STEP 3 — DOCTOR AVAILABILITY CHECK
If the user selected "Video Consultation", skip this step and proceed immediately to Step 4.
After receiving the location, simulate checking doctor availability.
If user provides a location, immediately respond that doctors are found.
Respond: "I found doctors available near your location."
(Or if you must simulate no doctors, say: "There are currently no doctors available in your area. Would you like to try video consultation instead?" with options: Switch to Video Consultation / Change location). Assume doctors are available for this demo.

STEP 4 — CONSULTATION PLAN
Explain the consultation plan available in the app.
Example:

Single Online Consultation
₹10

Includes:
• Chat consultation
• Audio call
• Video consultation
• Free follow-up

Ask the user: "Would you like to proceed with this consultation?"
Provide quick options:
• Pay & Consult
• Cancel

STEP 5 — PAYMENT & FINAL CONFIRMATION
If the user chooses Pay & Consult, simulate a successful payment and return the final beautiful confirmation message. Do NOT output raw JSON data to the user.

Example:

You will be redirected to complete the payment...

**Appointment Successfully Booked!**

Your consultation request has been submitted successfully. A doctor will be assigned to you shortly.

Thank you for choosing Motherly.

-------------------------------------
BOOKING FLOW (4 Steps — Frontend-Driven)

The booking flow has been simplified to 4 steps. The frontend handles Steps 2, 3, and 4 via structured UI cards. Your role in the conversation is:

STEP 1 — SERVICE ACKNOWLEDGEMENT (your only booking step)
When the user selects a service (Pregnancy Support / Labor / Delivery Support / After Birth Support / Breastfeeding Help / Speak to a Doctor), respond with:
- A warm, brief acknowledgement (1–2 sentences).
- Confirm you are setting up their booking now.
- Do NOT ask for location, date, time, name, phone, or email. The frontend cards will collect these.

Examples:
"Great choice! Pregnancy support is so important. I'm setting up your booking now."
"I'll arrange a doctor consultation for you right away."

STEP 2–4 — Handled by the frontend
The frontend will present a Schedule Card (location + date + time), a Contact Card (name + phone + any valid email), and a Confirmation Screen automatically. You do not need to guide these steps in chat.

EMAIL VALIDATION (IMPORTANT UPDATE):
Any properly formatted email is valid (e.g., user@gmail.com, user@yahoo.com, user@outlook.com, user@company.com).
Do NOT restrict to Gmail. Do NOT ask users to provide a Gmail address.

-------------------------------------
PRENATAL NUTRITION — MATERNAL HEALTH & NUTRITION ASSISTANT

You are a maternal health and prenatal nutrition assistant. When the user selects "Prenatal Nutrition" or any nutrition topic, provide accurate, evidence-based guidance aligned with WHO, CDC, and standard obstetrics guidelines.

INITIAL NUTRITION ENTRY:
When the user selects "Prenatal Nutrition", respond with a short helpful introduction (1–2 sentences) and ask: "What would you like to learn about?" Offer these options:
• Pregnancy Diet Plan
• Baby Brain Development Foods
• Managing Pregnancy Symptoms with Food
• Foods to Avoid During Pregnancy
• Hydration & Healthy Drinks
• Healthy Weight Gain Guide
• Postpartum Recovery Diet
• Daily Pregnancy Diet Recommendation

RESPONSE STRUCTURE FOR EACH NUTRITION TOPIC:

1. Short introduction (1–2 sentences) — why the topic matters during pregnancy.
2. Evidence-based key information:
   • Recommended intake or guidelines (cite general WHO/CDC-style ranges where relevant)
   • Nutritional benefits
   • Safe limits (e.g. caffeine, weight gain, mercury)
   • Practical tips
3. Actionable advice — things pregnant women can do in daily life.
4. Foods or habits to include and to avoid, if relevant.
5. Keep language clear, supportive, and easy to understand (avoid overly technical jargon).
6. Format with short paragraphs and bullet points suitable for a chat UI.
7. End with a gentle follow-up question, e.g. "Would you like to explore another nutrition topic?" or "Is there a specific part of this you’d like more detail on?"

EXAMPLE STYLE (Healthy Weight Gain Guide):

Healthy weight gain during pregnancy is essential for supporting your baby’s growth and maintaining your own health. The amount of weight you should gain depends on your pre-pregnancy Body Mass Index (BMI).

General pregnancy weight gain guidelines:
• Underweight (BMI <18.5): 12.5–18 kg
• Normal weight (BMI 18.5–24.9): 11.5–16 kg
• Overweight (BMI 25–29.9): 7–11.5 kg
• Obese (BMI ≥30): 5–9 kg

Tips for healthy weight gain:
• Eat balanced meals including protein, whole grains, fruits, and vegetables
• Include healthy fats such as nuts, seeds, and avocados
• Eat small, frequent meals to maintain energy
• Stay hydrated throughout the day
• Engage in safe activities like walking or prenatal yoga (if approved by your doctor)

Healthy weight gain should happen gradually across pregnancy, especially during the second and third trimesters.

NUTRITION RULES:
• Base advice on WHO, CDC, and standard obstetrics/nutrition guidelines. Be medically responsible.
• Do not give medical diagnoses. Encourage consulting a doctor or dietitian for personal or high-risk situations.
• Use bullet points and short paragraphs. Keep responses suitable for chat (readable, scannable).
• Always end with a gentle follow-up question to help the user continue exploring.

-------------------------------------
ABOUT MOTHERLY FLOW

When the user selects "About Motherly", provide this exact description:

Motherly is a premium maternal healthcare platform offering end-to-end support throughout your pregnancy, childbirth, and postpartum journey. We connect you with certified experts to ensure you and your baby receive the highest quality care.

Our core services include:
• Gynecologist & Doctor consultations
• Certified Doulas for personalized birth support
• Lactation Consultants for expert Lactation guidance
• Trusted Nannies for newborn and infant care (<a href="https://mothrly.com/?utm_source=chatgpt.com" target="_blank">mothrly.com</a>)

Our mission is to make motherhood safer, easier, and more supported with reliable professionals by your side.

How can I help you today?

Options:
• Book Doula
• Book Nanny
• Doctor Consultation
• Lactation Help
• Pregnancy Guidance

-------------------------------------
IMPORTANT BEHAVIOR RULES

• Always guide the user step-by-step
• Never ask multiple questions at once
• Use quick action buttons whenever possible
• Keep responses SHORT and CLEAR.
• During BOOKING FLOWS, NEVER output long text blocks or long lists. Maximum 3 sentences per response. 
• If the user already provided information earlier, do not ask again

-------------------------------------
CONVERSATION STYLE

Always give the user quick selectable options instead of asking them to type long answers.
Use short messages and structured options.

Example format:

Question text

Options:
• Option A
• Option B

-------------------------------------
INTENT FIRST — SERVICE-RELATED VS OFF-TOPIC (CRITICAL)

Before you reply, decide whether the message relates to **Motherly’s services** (bookings and care we offer):

SERVICE-RELATED (always help — includes informal English, typos, and short phrases):
• General queries about Motherly, services, or "what do you do".
• Wanting to book or learn about: **doula**, **nanny / childcare**, **doctor / OB / consultation** (in-clinic or video), **lactation / breastfeeding / feeding support**, **prenatal nutrition**, **About Motherly**, **Contact / Support**, pregnancy or postpartum care.
• Keywords: "services", "see services", "booking", "book", "help", "consult", "doctor", "specialist".
• **Doctor-type requests:** Any medical specialist (gynaecologist, OB-GYN, pediatrician) is SERVICE-RELATED. Help them book a doctor consultation.

If **SERVICE-RELATED**: answer helpfully, confirm you’re setting up or guiding them — **do not** say you “might not have the right answer” or refuse. Interpret typos generously (e.g. *lacatation* → lactation consultant).

**OFF-TOPIC** (not about maternal care / Motherly): weather, sports, unrelated trivia, general homework, politics, other apps, jokes that aren’t about care, etc.

If **OFF-TOPIC**: reply in 2–4 short sentences. **Politely explain** that Mothrly Assistant is only for **booking and support** for: doula, nanny, doctor consultation, lactation/feeding, prenatal nutrition, About Motherly, and Contact Support. **Do not** answer the unrelated topic; invite them to ask about those services or use the buttons. Stay warm, not preachy.

-------------------------------------
OFF-TOPIC, UNCLEAR, OR FRUSTRATED MESSAGES

If the user’s message is off-topic, unclear, venting, joking, testing the bot, or uses strong language (including frustration or mild profanity):
• Reply in at most 3 short sentences — no long service lists or repeated welcome text.
• If they sound upset or frustrated: acknowledge calmly (“I’m sorry you’re feeling that way” / “That sounds frustrating”) without judging; stay warm and professional.
• Do NOT repeat the same long introduction about Motherly that you already sent earlier in the conversation.
• Gently redirect: offer to help with booking (doula, doctor, lactation, etc.) or suggest **Contact Support** if they need a human.
• Never mirror insults or argue; never output the full “STARTING MESSAGE” block again mid-chat.

If the message is **too vague to help** (not maternal-care-related and no clear ask), use the same gentle prompt as in **EMPATHETIC UNDERSTANDING**: invite them to share a bit more about their situation — do not lecture or list rules.

-------------------------------------
STARTING MESSAGE

When a user opens the chat say:

Hi,
I'm Mothrly Assistant. I can help you book a doula or consultation.
How can i help you today?

Options:
• Book Doula
• Book Nanny
• Book Doctor Consultation
• Book Lactation Consultant
• Prenatal Nutrition
• Reschedule Booking

Today's date: <CURRENT_DATE>
""".strip()


from typing import Tuple, List, Dict, Optional


def _normalize_booking_typos(message: str) -> str:
    """Fix common misspellings so intent checks still match."""
    m = (message or "").lower().strip()
    replacements = (
        ("lacatation", "lactation"),
        ("lacation", "lactation"),
        ("lactatation", "lactation"),
        ("laction", "lactation"),
        ("gynocologist", "gynecologist"),
        ("gynaecol", "gynecol"),
    )
    for wrong, right in replacements:
        m = m.replace(wrong, right)
    return m


def _is_doctor_consult_intent(msg: str) -> bool:
    """
    True if the user wants a doctor/medical consultation — including specialists
    whose title does not contain the word 'doctor' (e.g. gynecologist) and phrases
    using 'consult' without 'consultation'.
    """
    if not msg:
        return False
    # Substrings / words that imply booking a clinician (Motherly scope).
    specialist_markers = (
        "gynecologist",
        "gynaecologist",
        "gynecol",  # covers truncated / informal
        "obgyn",
        "ob-gyn",
        "ob gyn",
        "obstetrician",
        "women's health",
        "womens health",
        "paediatrician",
        "pediatrician",
    )
    if any(s in msg for s in specialist_markers):
        return True
    if "doctor" in msg or "physician" in msg:
        return True
    # Phrases that usually mean doctor booking (not bare "consultation" — avoids stealing lactation).
    if any(
        p in msg
        for p in (
            "doctor consultation",
            "video consultation",
            "online consultation",
            "medical consultation",
            "consultation with a doctor",
            "book a consultation",
        )
    ):
        return True
    # "i need to consult a gynecologist" — consult without consultation
    if "consult" in msg and "consultant" not in msg:
        if any(
            x in msg
            for x in (
                "gyn",
                "doctor",
                "physician",
                "specialist",
                "clinic",
                "video",
                "book",
                "in-clinic",
                "in clinic",
            )
        ):
            return True
    if any(
        w in msg
        for w in (
            "speak to a doctor",
            "book doctor",
            "book a doctor",
            "see a doctor",
            "clinic visit",
            "video consult",
            # Common symptoms → doctor consultation
            "fever",
            "pain",
            "blood",
            "bleeding",
            "headache",
            "vomit",
            "nausea",
            "unwell",
            "feeling sick",
            "stomach ache",
            "cramp",
            "emergency",
            "medicine",
            "prescription",
        )
    ):
        return True
    return False


def _fallback_chat_reply(user_message: str, history: Optional[List[Dict[str, str]]] = None) -> str:
    """
    When the LLM is unavailable (no API key or API error), still respond helpfully
    to common intents so typed/voice messages get a real answer — does not change
    frontend booking flows; only used as backup for /chat.
    """
    msg = (user_message or "").lower().strip()
    msg = _normalize_booking_typos(msg)
    words = msg.split()
    if not msg:
        return (
            "Hi! I'm Mothrly Assistant. Tell me what you need — for example: book a doula, "
            "nanny, doctor consultation, or reschedule an existing booking. You can also use the buttons in the chat."
        )

    # Booking & services (match phrases users type or speak)
    if any(
        w in msg
        for w in (
            "doula",
            "book doula",
            "book a doula",
            "need a doula",
            "hire a doula",
            "birth support",
            "labour support",
            "labor support",
            "booking",
            "book services",
            "book a service",
            "i want to book",
            "i wanna book",
            "what services",
            "available services",
            "support services",
            "services",
            "see your services",
            "service list",
            "what do you do",
            "what can you do",
        )
    ) or (len(words) <= 3 and ("book" in msg or "service" in msg)):
        return (
            "I'd be happy to help you reschedule or cancel your booking!\n\n"
            "Please provide your **Booking ID** (e.g., BOOK-12345) so I can find your details.\n\n"
            "Options:\n"
            "• Register New Booking\n"
            "• Reschedule Booking\n"
            "• About Motherly"
        )

    if any(w in msg for w in ("nanny", "childcare", "babysit", "baby sitter", "book nanny")):
        return (
            "Perfect — we can set up **nanny / childcare** support for you.\n\n"
            "I'll need a few details about your child and schedule next. If you see "
            "**Book Nanny** in the menu, tap it to open the booking steps, or type what you need."
        )

    lactation_markers = (
        "lactation",
        "lactation consultant",
        "breastfeeding",
        "breast feeding",
        "feeding help",
        "book lactation",
        "nursing",
        "feeding support",
        "nipple",
        "breast milk",
        "laction",
    )
    if any(w in msg for w in lactation_markers) or (
        "consultant" in msg
        and any(x in msg for x in ("lact", "breast", "feed", "nurs", "milk"))
    ):
        return (
            "We can connect you with a **lactation consultant** for breastfeeding and feeding support.\n\n"
            "Would you prefer a **home visit**, **online session**, or **clinic appointment**? "
            "Reply with your choice, or tap **Book Lactation Consultant** in the menu."
        )

    if _is_doctor_consult_intent(msg):
        return (
            "I can help you book a **doctor consultation** — including with a **gynecologist** or other specialist.\n\n"
            "Would you prefer **online (video)** or **in-clinic**? Tell me your preference, "
            "or choose **Book Doctor Consultation** from the menu."
        )

    if (
        "prenatal nutrition" in msg
        or ("nutrition" in msg and "pregnan" in msg)
        or "diet during pregnancy" in msg
        or "pregnancy food" in msg
    ):
        return (
            "**Prenatal nutrition** is important for you and your baby.\n\n"
            "What would you like to learn about? You can ask about nutrients, meal ideas, "
            "or say **Prenatal Nutrition** to see topic options."
        )

    if any(w in msg for w in ("about motherly", "about you", "who are you", "what is motherly")):
        return (
            "**Motherly** is a maternal care platform in [Chennai, India](https://www.google.com/maps/search/?api=1&query=Motherly+Care+Ethos+Chennai) — doulas, doctors, lactation consultants, "
            "and more.\n\n[+91 99448 90577](tel:+919944890577) · [motherlycareethos@gmail.com](mailto:motherlycareethos@gmail.com)\n\n"
            "Would you like to book a service or contact support?"
        )

    if any(w in msg for w in ("contact", "support", "phone", "email", "call you")):
        return (
            "You can reach us at [+91 99448 90577](tel:+919944890577) or [motherlycareethos@gmail.com](mailto:motherlycareethos@gmail.com).\n\n"
            "Our office is located at [Chennai, India](https://www.google.com/maps/search/?api=1&query=Motherly+Care+Ethos+Chennai).\n\n"
            "Would you like to open **Contact Support** in the chat, or tell me what you need?"
        )

    if msg in ("hi", "hey", "hello", "namaste") or any(
        w in msg for w in ("good morning", "good afternoon", "good evening")
    ):
        return (
            "Hello! I'm **Mothrly Assistant**. I can help you book a doula, nanny, doctor "
            "consultation, lactation support, and more.\n\nWhat would you like help with today?"
        )

    if any(w in msg for w in ("thank", "thanks")):
        return (
            "You're welcome! If you need anything else — booking, nutrition, or support — just ask."
        )

    # Frustration, confusion, or strong language — empathic, not a repeated marketing blurb
    frustration_markers = (
        "what the hell",
        "what the heck",
        "wtf",
        "the hell",
        "bullshit",
        "this sucks",
        "so frustrated",
        "so annoying",
        "not working",
        "doesn't work",
        "doesnt work",
        "hate this",
        "stupid bot",
        "useless",
        "damn it",
        "pissed",
        "angry",
    )
    if any(p in msg for p in frustration_markers):
        return (
            "I'm sorry you're having a rough moment — I'm here to help, not to add to the frustration.\n\n"
            "If something in the chat or booking isn't working, you can type **Contact Support** and our team will assist. "
            "Otherwise, tell me in a few words what you were trying to do (e.g. book a doula or doctor), and I'll guide you."
        )

    # Very short / unclear (not a common greeting) — invite clarification
    _short_ok = frozenset(
        {
            "hi",
            "hey",
            "hello",
            "ok",
            "okay",
            "yes",
            "no",
            "maybe",
            "hmm",
            "hm",
            "bye",
            "thanks",
            "yo",
        }
    )
    if len(words) <= 2 and len(msg) <= 24:
        _short_phrases_ok = ("thank you", "good morning", "good afternoon", "good evening", "good night")
        if (
            msg in _short_ok
            or msg in _short_phrases_ok
            or msg.startswith("hi ")
            or msg.startswith("hey ")
        ):
            pass  # fall through to default off-topic reply below
        else:
            return (
                "I'm not quite sure what you mean — could you say a bit more?\n\n"
                "I'm here for **Motherly** bookings (doula, doctor, lactation, nanny, nutrition) or **Contact Support** if you need a person."
            )

    # Clearly off-topic, fuzzy, or "what do you do" type query — scopes and provides options
    return (
        "Mothrly Assistant is here to help you book maternal care and support.\n\n"
        "We specialize in **doulas, nannies, and doctor consultations** for mothers and babies.\n\n"
        "How can I help you today?\n\n"
        "Options:\n"
        "• Book Doula\n"
        "• Book Nanny\n"
        "• Book Doctor Consultation\n"
        "• Book Lactation Consultant\n"
        "• Prenatal Nutrition\n"
        "• About Motherly"
    )


def get_chat_response(user_message: str, history: Optional[List[Dict[str, str]]] = None) -> Tuple[str, int]:
    """
    Send the user's message to OpenAI GPT-4o mini along with Mothrly Assistant's
    system prompt and return the assistant's reply.

    Parameters
    ----------
    user_message : str
        The message typed by the user in the chat interface.
    history : List[Dict[str, str]], optional
        The conversation history to provide context to the LLM.

    Returns
    -------
    Tuple[str, int]
        Mothrly Assistant's response text, and the total tokens used in this request.
    """
    from datetime import datetime
    if history is None:
        history = []
        
    # Inject the current date into the system prompt for date validation
    current_date = datetime.now().strftime("%B %d, %Y")
    dynamic_prompt = SYSTEM_PROMPT.replace("<CURRENT_DATE>", current_date)
        
    messages = [{"role": "system", "content": dynamic_prompt}]
    for msg in history:
        messages.append(msg)
    messages.append({"role": "user", "content": user_message})

    client = get_openai_client()
    if client is None:
        logger.warning(
            "OPENAI_API_KEY not set — using intent fallback for /chat. "
            "Set OPENAI_API_KEY in .env for full LLM replies."
        )
        return _fallback_chat_reply(user_message, history), 0

    try:
        response = _call_openai_with_retry(
            client,
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.7,
            max_tokens=400,
        )
        reply = response.choices[0].message.content
        tokens_used = response.usage.total_tokens if response.usage else 0
        return reply, tokens_used

    except (RateLimitError, APIConnectionError) as exc:
        logger.error("OpenAI transient error in get_chat_response: %s", exc)
        return _fallback_chat_reply(user_message, history), 0
    except Exception as exc:
        logger.exception("OpenAI API call failed in get_chat_response: %s", exc)
        return _fallback_chat_reply(user_message, history), 0


# ── Booking description validator (LLM checks relevance & validity) ─────
def _default_invalid_message(service: str) -> str:
    """Return a clear, short message when the response is invalid. Easy to read in chat."""
    tip = "\nTip: Type or use the mic."
    s = (service or "").lower()
    if "nanny" in s:
        return "Tell us your childcare needs so we can match you with the right nanny.\nInclude: care timing, child routine, and special requirements." + tip
    if "doula" in s:
        return "Tell us your needs so we can match you with the right doula.\nInclude: support type, concerns, and pregnancy stage." + tip
    if "lactation" in s:
        return "Tell us your feeding needs so we can match you with the right support.\nInclude: feeding challenge, baby's age, and concerns." + tip
    if "doctor" in s or "consultation" in s:
        return "Tell us why you need this consultation.\nInclude: main symptom, duration, and relevant history." + tip
    return "Tell us your needs so we can help.\nInclude: reason for booking and any concerns." + tip


VALIDATOR_SYSTEM = """You are a validator for a maternal healthcare booking app. The user has just been asked to describe their situation for the **booked service** shown below.

**STEP A — SERVICE MISMATCH (CHECK FIRST, USING THE FULL MESSAGE)**

Read the **entire** user message. If they clearly need a **different** Motherly service than the one currently booked, you must **not** force them to "describe a doula need" etc.

Examples of mismatch:
- Booked **doula** but they want a **doctor / medical consultation**, symptoms, treatment, OB-GYN, physician, "book a doctor"
- Booked **lactation** but they want **doula** or **nanny** or **doctor** (clear switch)
- Booked **nanny** but they want **doctor** / **doula** / **lactation** (clear switch)
- Booked **doctor** but they clearly want **doula** / **nanny** / **lactation** instead

If (and only if) there is a **clear** mismatch, respond with **exactly** this one-line format (no line breaks; use a pipe `|` only as the separator shown):
SWITCH:<doctor|doula|lactation|nanny>|<one short warm sentence; do not use the `|` character in the sentence>

Example:
SWITCH:doctor|It sounds like you're looking for a doctor consultation rather than doula support. I'll switch this for you and use what you shared for your consultation.

**STEP B — IF NO MISMATCH**

Decide if their response is RELEVANT and VALID **for the booked service**.

Users may type or dictate informally — incomplete sentences, typos, and short phrases are OK if the meaning is clear.

RELEVANT & VALID = A genuine description of why they need **this booked** service or what they want from it. Accept:
- Needing pregnancy support, labour support, postpartum care, birth plan (for doula)
- Describing the kind of person or experience they want (e.g. "someone patient, understanding, supportive", "positive birth experience") — these are valid
- Needing childcare, nanny for work, child's routine (for nanny)
- Feeding issues, lactation support, breastfeeding help — including casual phrases like "baby not latching", "feeding issue", "nipple pain" (for lactation)
- Short but clear support requests like "new mom need help" when paired with the right service context
- For doctor consultation: wanting to see a **gynecologist**, **OB-GYN**, or any medical concern — these are always valid
- Any sincere, on-topic reason or preference for the **booked** service

NOT VALID = Reject when the response is:
- Off-topic (e.g. feedback about the app, UI complaints, email/Gmail requirements, feature requests)
- Meta-commentary or criticism of the product rather than describing their need
- Spam, test text, gibberish, or clearly unrelated content
- A question about something other than their own situation for this booking

You must respond with **exactly one** of:
SWITCH:<slug>|<sentence>
or
VALID
or
INVALID: <one short, friendly sentence>

For INVALID, the sentence should ask them to describe their need **for the booked service**. Do not repeat the word INVALID. Keep the tone warm."""

_ALLOWED_SWITCH_SLUGS = frozenset({"doctor", "doula", "lactation", "nanny"})
_ABUSIVE_PATTERN = re.compile(
    r"\b(fuck|f\*+k|shit|bitch|asshole|bastard|motherfucker|idiot|stupid|dumb)\b",
    re.IGNORECASE,
)
_LOW_INFO_TOKENS = {"ok", "okay", "hmm", "hmmm", "yes", "no", "fine", "hello", "hi"}
_RELEVANT_HINTS = (
    "pregnan", "postpartum", "post partum", "baby", "newborn", "infant",
    "feeding", "feed", "latch", "breast", "milk",
    "support", "care", "help", "emotional support",
    "doula", "lactation", "nanny", "doctor", "consult", "consultation",
    "symptom", "pain", "medical",
    "book", "booking",
)


def _switch_ack_default(slug: str) -> str:
    acks = {
        "doctor": (
            "It sounds like you're looking for a doctor consultation rather than your current booking. "
            "I'll switch this for you and use what you shared for your consultation."
        ),
        "doula": (
            "It sounds like you're looking for doula support. "
            "I'll switch your booking for you and use what you shared."
        ),
        "lactation": (
            "It sounds like you're looking for lactation or feeding support. "
            "I'll switch your booking for you and use what you shared."
        ),
        "nanny": (
            "It sounds like you're looking for nanny or childcare help. "
            "I'll switch your booking for you and use what you shared."
        ),
    }
    return acks.get(slug, acks["doctor"])


def _heuristic_service_switch(description: str, booked_service: str) -> Optional[str]:
    """
    Detect when free text clearly requests a different service than `booked_service`.
    Conservative: avoids switching when 'doctor' is only mentioned in passing (e.g. cleared by OB to get a doula).
    """
    d = (description or "").lower()
    s = (booked_service or "").lower()
    if len(d) < 12:
        return None

    def is_doula_booking():
        return "doula" in s

    def is_lactation_booking():
        return "lactation" in s

    def is_nanny_booking():
        return "nanny" in s

    def is_doctor_booking():
        return "doctor" in s or "consultation" in s

    # Strong doctor booking intent (typical user rewrites mid-flow)
    doctor_booking_intent = (
        ("doctor" in d or "physician" in d or "gynecologist" in d or "gynaecologist" in d)
        and (
            "consultation" in d
            or "symptom" in d
            or "health concern" in d
            or "health concerns" in d
            or "medical" in d
            or "treatment" in d
            or "book" in d
        )
    )

    wants_doula = "doula" in d or "birth support" in d or ("labor support" in d or "labour support" in d)
    wants_nanny = "nanny" in d or "babysitter" in d or "childcare" in d or "child care" in d
    wants_lactation = (
        "lactation" in d
        or "breastfeeding" in d
        or "breast feeding" in d
        or "latching" in d
        or "not feeding" in d
    )

    if doctor_booking_intent and not wants_doula:
        if is_doula_booking() or is_lactation_booking() or is_nanny_booking():
            return "doctor"

    if wants_doula and "doctor" not in d.split("doula")[0] and not doctor_booking_intent:
        if is_lactation_booking() or is_nanny_booking() or is_doctor_booking():
            return "doula"

    if wants_nanny and not doctor_booking_intent:
        if is_doula_booking() or is_lactation_booking() or is_doctor_booking():
            return "nanny"

    if wants_lactation and not doctor_booking_intent:
        if is_doula_booking() or is_nanny_booking() or is_doctor_booking():
            return "lactation"

    return None


def _parse_validator_llm_content(content: str, service: str) -> Tuple[bool, str, Optional[str]]:
    """Return (valid, message, redirect_slug). redirect_slug set only on successful SWITCH."""
    raw = (content or "").strip()
    if not raw:
        return True, "", None

    switch_m = re.match(
        r"^SWITCH\s*:\s*(doctor|doula|lactation|nanny)\s*\|\s*(.+)$",
        raw,
        re.IGNORECASE | re.DOTALL,
    )
    if switch_m:
        slug = switch_m.group(1).lower()
        msg = (switch_m.group(2) or "").strip()
        if slug in _ALLOWED_SWITCH_SLUGS:
            if not msg:
                msg = _switch_ack_default(slug)
            return True, msg, slug

    reply_upper = raw.upper()
    if reply_upper.startswith("VALID"):
        return True, "", None
    if reply_upper.startswith("INVALID"):
        parts = raw.split("INVALID", 1)
        rest = parts[1].strip() if len(parts) > 1 else ""
        msg = rest.lstrip(": -—").strip()
        if msg:
            return False, msg, None
        return False, _default_invalid_message(service), None
    return True, "", None


def _heuristic_invalid_description(description: str, service: str) -> Tuple[bool, str]:
    """
    Lightweight local safety check so obvious abusive/useless replies are not accepted
    even when LLM validation is unavailable.
    Returns (is_invalid, user_message_if_invalid).
    """
    text = (description or "").strip()
    if not text:
        return True, _default_invalid_message(service)

    lower = text.lower()
    tokens = [w for w in re.split(r"\s+", lower) if w]
    unique = set(tokens)

    if _ABUSIVE_PATTERN.search(lower):
        return True, (
            "I’m here to help you get the right support. "
            "Please share your needs for this booking so I can assist you better."
        )

    # Very short acknowledgements / fillers are not useful as a description.
    if len(tokens) <= 2 and all(t in _LOW_INFO_TOKENS for t in tokens):
        return True, "Could you please share a bit more about your situation or what kind of support you're looking for?"

    # Repeated single abusive/useless token
    if len(tokens) >= 1 and len(unique) == 1 and len(tokens) < 6:
        return True, "Could you please share a bit more about your situation or what kind of support you're looking for?"

    # Accept imperfect but relevant short phrases (voice/text-friendly).
    if any(h in lower for h in _RELEVANT_HINTS):
        return False, ""

    # Irrelevant/off-topic generic text: reject with a gentle redirect.
    if len(tokens) <= 8:
        return True, (
            "I just need a bit more information about your care needs so I can match you with the right support. "
            "Could you tell me what kind of help you're looking for?"
        )

    return False, ""


def validate_booking_description(description: str, service: str) -> Tuple[bool, str, Optional[str]]:
    """
    Check if the user's booking description fits the booked service.
    If the user clearly switched to another service, returns redirect so the client can update the flow.

    Returns
    -------
    Tuple[bool, str, Optional[str]]
        (valid, message, redirect_slug). redirect_slug is doctor|doula|lactation|nanny or None.
        When redirect_slug is set, valid is True and message is shown to the user.
    """
    if not (description and description.strip()):
        return False, "Please tell us a little about your situation so we can help.\n\nTip: You can type or use the mic.", None

    invalid, invalid_msg = _heuristic_invalid_description(description, service)
    if invalid:
        return False, invalid_msg, None

    switch_slug = _heuristic_service_switch(description, service)
    if switch_slug:
        return True, _switch_ack_default(switch_slug), switch_slug

    service_lower = (service or "").lower()
    service_label = "this service"
    if "doula" in service_lower:
        service_label = "a doula"
    elif "nanny" in service_lower:
        service_label = "a nanny"
    elif "lactation" in service_lower:
        service_label = "lactation support"
    elif "doctor" in service_lower or "consultation" in service_lower:
        service_label = "this consultation"

    user_prompt = f"""Booked service: {service or 'Unknown'}.
The user was asked to describe their situation or why they need {service_label}.

Read their **entire** reply (all sentences). Do not decide from the first sentence only.

User's reply:
\"\"\"{description.strip()}\"\"\"

Reply with SWITCH:..., VALID, or INVALID: ... per your instructions."""

    client = get_openai_client()
    if client is None:
        return True, "", None

    try:
        response = _call_openai_with_retry(
            client,
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": VALIDATOR_SYSTEM},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
            max_tokens=200,
        )
        content = (response.choices[0].message.content or "").strip()
        valid, msg, redir = _parse_validator_llm_content(content, service)
        return valid, msg, redir
    except (RateLimitError, APIConnectionError) as exc:
        logger.error("OpenAI transient error in validate_booking_description: %s", exc)
        invalid, invalid_msg = _heuristic_invalid_description(description, service)
        return (False, invalid_msg, None) if invalid else (True, "", None)
    except Exception as exc:
        logger.exception("validate_booking_description failed: %s", exc)
        # Fall back to local heuristics; allow to avoid blocking genuine users.
        invalid, invalid_msg = _heuristic_invalid_description(description, service)
        return (False, invalid_msg, None) if invalid else (True, "", None)
