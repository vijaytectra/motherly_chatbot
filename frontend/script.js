/**
 * script.js — Motherly Chat Frontend Logic v23
 * 4-step booking flow with voice input, progress bar, and auto-open.
 */
console.log("Mothrly Chat script.js v66 (Interactive Contacts + Markdown-Links)");

// ── DOM refs ──────────────────────────────────────────────────────────
const messagesContainer = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const typingIndicator = document.getElementById("typing-indicator");
const micBtn = document.querySelector(".mic-button");

// ── State ─────────────────────────────────────────────────────────────
let chatHistory = [];
let bookingState = {};          // tracks 4-step booking data
let latestBooking = null;       // stores full booking response from backend
let isRecording = false;
let speechRecognition = null;
let detectedLocation = null;   // pre-fetched GPS address, filled on load
let placesAutocomplete = null;

// ── Floating chat state: tooltip once, panel open/close ─────────────
let userHasOpenedChat = false;
let chatInitialized = false;
let tooltipTimeoutId = null;
let isResettingChat = false;
let sessionId = null;

const SESSION_STORAGE_PREFIX = "mothrly_chat_session:";
const SESSION_ACTIVE_KEY = "mothrly_chat_active_session_id";
const SESSION_AUTOSAVE_MS = 1500;

// ── API configuration (LAN/mobile-safe) ─────────────────────────────────
const DEFAULT_NODE_API_URL = "http://localhost:5000";
const DEFAULT_FASTAPI_URL = "http://localhost:8000";
const LAN_NODE_API_URL = "http://192.168.68.65:5000";
const LAN_FASTAPI_URL = "http://192.168.68.65:8000";

function getBaseApiUrl(type) {
    const isNode = type === 'node';
    const runtime = runtimeApiConfig[isNode ? 'VITE_API_URL' : 'VITE_FASTAPI_URL'];
    
    // If runtime config exists, use it
    if (runtime && runtime.trim().length > 0) {
        return normalizeBaseUrl(runtime);
    }
    
    // Default discovery logic
    const host = window.location.hostname;
    const port = isNode ? '5000' : '8000';
    
    // If we are on localhost, use localhost
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
        return `http://localhost:${port}`;
    }
    
    // Otherwise, use the current host (good for LAN/Development testing)
    return `http://${host}:${port}`;
}

function normalizeBaseUrl(url, fallback) {
    const val = (url || fallback || "").trim();
    return val.replace(/\/+$/, "");
}

const runtimeApiConfig = (typeof window !== "undefined" && window.__MOTHRLY_CONFIG__) || {};
const NODE_API_BASE = getBaseApiUrl('node');
const FASTAPI_API_BASE = getBaseApiUrl('fastapi');
const ENABLE_AUTO_INPUT_FOCUS = false;

function maybeFocusElement(el) {
    if (!ENABLE_AUTO_INPUT_FOCUS || !el || typeof el.focus !== "function") return;
    el.focus();
}

function blurActiveInput() {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (!active || typeof active.blur !== "function") return;
    const tag = active.tagName ? active.tagName.toLowerCase() : "";
    const isEditable = tag === "input" || tag === "textarea" || active.isContentEditable;
    if (isEditable) active.blur();
}

function makeApiUrl(base, path) {
    if (!path) return base;
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

async function apiFetch(base, path, options = {}) {
    const url = makeApiUrl(base, path);
    // 10-second default timeout to prevent infinite UI hangs
    const timeout = options.timeout || 10000;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (err) {
        clearTimeout(id);
        if (err.name === 'AbortError') {
            console.error(`[API] Timeout error (${timeout}ms): ${url}`);
        } else {
            console.error(`[API] Network error: ${url}`, err);
        }
        throw err;
    }
}

function generateSessionId() {
    return `mcs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getSidFromUrl() {
    try {
        return new URLSearchParams(window.location.search).get("sid");
    } catch {
        return null;
    }
}

function setSidInUrl(sid) {
    if (!sid || typeof window === "undefined") return;
    try {
        const url = new URL(window.location.href);
        url.searchParams.set("sid", sid);
        window.history.replaceState({}, "", url.toString());
    } catch {
        // ignore URL update errors
    }
}

function ensureSessionId() {
    if (sessionId) return sessionId;
    const sidFromUrl = getSidFromUrl();
    const sidFromStorage = localStorage.getItem(SESSION_ACTIVE_KEY);
    sessionId = sidFromUrl || sidFromStorage || generateSessionId();
    localStorage.setItem(SESSION_ACTIVE_KEY, sessionId);
    setSidInUrl(sessionId);
    return sessionId;
}

function getCurrentProgressStep() {
    if (bookingState && Number.isFinite(bookingState.step)) return bookingState.step;
    const label = document.getElementById("step-label")?.textContent || "";
    const m = label.match(/Step\s+(\d)/i);
    return m ? Number(m[1]) : 0;
}

function captureFormDraftsFromDom() {
    return {
        location: document.getElementById("loc-input")?.value || "",
        dateDisplay: document.getElementById("date-input")?.value || "",
        dateIso: document.getElementById("date-input")?.dataset?.iso || "",
        timeDisplay: document.getElementById("time-input")?.value || "",
        time24: document.getElementById("time-input")?.dataset?.value24 || "",
        name: document.getElementById("c-name")?.value || "",
        phone: document.getElementById("c-phone")?.value || "",
        email: document.getElementById("c-email")?.value || "",
        relation: document.getElementById("c-relation")?.value || "",
        forSelf: Boolean(document.getElementById("c-self")?.checked),
        description: userInput?.value || "",
    };
}

function applyFormDraftsToDom(drafts) {
    if (!drafts || typeof drafts !== "object") return;
    const loc = document.getElementById("loc-input");
    const dateEl = document.getElementById("date-input");
    const timeEl = document.getElementById("time-input");
    const nameEl = document.getElementById("c-name");
    const phoneEl = document.getElementById("c-phone");
    const emailEl = document.getElementById("c-email");
    const relationEl = document.getElementById("c-relation");
    const selfEl = document.getElementById("c-self");

    if (loc && drafts.location && !loc.value) loc.value = drafts.location;
    if (dateEl) {
        if (drafts.dateDisplay && !dateEl.value) dateEl.value = drafts.dateDisplay;
        if (drafts.dateIso && !dateEl.dataset.iso) dateEl.dataset.iso = drafts.dateIso;
    }
    if (timeEl) {
        if (drafts.timeDisplay && !timeEl.value) timeEl.value = drafts.timeDisplay;
        if (drafts.time24 && !timeEl.dataset.value24) timeEl.dataset.value24 = drafts.time24;
    }
    if (nameEl && drafts.name && !nameEl.value) nameEl.value = drafts.name;
    if (phoneEl && drafts.phone && !phoneEl.value) phoneEl.value = drafts.phone;
    if (emailEl && drafts.email && !emailEl.value) emailEl.value = drafts.email;
    if (relationEl && drafts.relation && !relationEl.value) relationEl.value = drafts.relation;
    if (selfEl && drafts.forSelf) {
        selfEl.checked = true;
        if (typeof window.toggleSelfBooking === "function") window.toggleSelfBooking(selfEl);
    }
}

function reinitializeRestoredWidgets() {
    // Reconnect schedule-card controls after HTML snapshot restore
    if (document.getElementById("schedule-card")) {
        const todayStr = new Date().toISOString().split("T")[0];
        initLocationClearControl();
        initLocationAutocomplete();
        initSchedulePickers(todayStr);
    }
}

function saveSessionSnapshot() {
    if (!messagesContainer) return;
    const sid = ensureSessionId();
    const quickActionsBar = document.getElementById("quick-actions-bar");
    const snapshot = {
        version: 1,
        sid,
        savedAt: Date.now(),
        chatHistory,
        bookingState,
        detectedLocation,
        chatInitialized,
        progressStep: getCurrentProgressStep(),
        messagesHtml: messagesContainer.innerHTML,
        formDrafts: captureFormDraftsFromDom(),
        quickActionsHtml: quickActionsBar ? quickActionsBar.innerHTML : "",
        quickActionsVisible: Boolean(quickActionsBar && quickActionsBar.classList.contains("quick-actions-bar--visible")),
    };
    try {
        localStorage.setItem(`${SESSION_STORAGE_PREFIX}${sid}`, JSON.stringify(snapshot));
        localStorage.setItem(SESSION_ACTIVE_KEY, sid);
    } catch {
        // ignore quota/storage errors
    }
}

function applySessionSnapshot(snapshot) {
    if (!snapshot || !messagesContainer) return false;
    chatHistory = Array.isArray(snapshot.chatHistory) ? snapshot.chatHistory : [];
    bookingState = snapshot.bookingState && typeof snapshot.bookingState === "object" ? snapshot.bookingState : {};
    detectedLocation = snapshot.detectedLocation || null;
    chatInitialized = Boolean(snapshot.chatInitialized || snapshot.messagesHtml);
    messagesContainer.innerHTML = snapshot.messagesHtml || "";
    updateProgress(Number.isFinite(snapshot.progressStep) ? snapshot.progressStep : (bookingState.step || 0));
    const quickActionsBar = document.getElementById("quick-actions-bar");
    if (quickActionsBar) {
        quickActionsBar.innerHTML = snapshot.quickActionsHtml || "";
        quickActionsBar.classList.toggle("quick-actions-bar--visible", Boolean(snapshot.quickActionsVisible));
    }
    rebindInteractiveButtonsAfterRestore();
    applyFormDraftsToDom(snapshot.formDrafts || {});
    reinitializeRestoredWidgets();
    setInputEnabled(true);
    showTyping(false);
    return true;
}

function normalizeLabel(text) {
    return (text || "").replace(/\s+/g, " ").trim();
}

function rebindInteractiveButtonsAfterRestore() {
    const replaceButton = (btn) => {
        const clone = btn.cloneNode(true);
        btn.replaceWith(clone);
        return clone;
    };

    // Rebind welcome buttons (main + quick actions)
    document.querySelectorAll(
        ".option-btn--welcome-primary, .option-btn--welcome-secondary"
    ).forEach((btn) => {
        const rebound = replaceButton(btn);
        const label = normalizeLabel(rebound.textContent);
        rebound.addEventListener("click", () => handleServiceSelection(label));
    });

    // Rebind sub-option grids using their context
    document.querySelectorAll(".options-container[data-context]").forEach((row) => {
        const context = row.dataset.context;
        row.querySelectorAll("button.option-btn").forEach((btn) => {
            const rebound = replaceButton(btn);
            const label = normalizeLabel(rebound.textContent);
            rebound.addEventListener("click", () => handleSubOptionSelection(context, label));
        });
    });

    // Rebind generic chips produced from parsed bot options
    document.querySelectorAll(".options-container:not([data-context]) button.option-btn:not(.option-btn--welcome-primary):not(.option-btn--welcome-secondary):not(.option-btn--review-change)").forEach((btn) => {
        const rebound = replaceButton(btn);
        const label = normalizeLabel(rebound.textContent);
        rebound.addEventListener("click", () => sendMessage(label));
    });
}

function tryRestoreSessionById(sid) {
    if (!sid) return false;
    try {
        const raw = localStorage.getItem(`${SESSION_STORAGE_PREFIX}${sid}`);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        sessionId = sid;
        setSidInUrl(sessionId);
        return applySessionSnapshot(parsed);
    } catch {
        return false;
    }
}

function resumeSession() {
    const sid = getSidFromUrl() || localStorage.getItem(SESSION_ACTIVE_KEY) || ensureSessionId();
    const restored = tryRestoreSessionById(sid);
    openChat();
    if (!restored && !chatInitialized) {
        saveSessionSnapshot();
    }
}

// ── Initialize chat on first click ────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
    ensureSessionId();

    // Floating UI: show welcoming tooltip on first load (hide after 7s or on first open)
    const tooltipEl = document.getElementById("chat-tooltip");
    const panelEl = document.getElementById("chat-panel");
    const fabEl = document.getElementById("chat-fab");
    const floatingChatEl = document.querySelector(".floating-chat");

    if (tooltipEl && fabEl && panelEl && floatingChatEl) {
        tooltipEl.classList.add("chat-tooltip--visible");
        tooltipEl.setAttribute("aria-hidden", "false");

        tooltipTimeoutId = setTimeout(() => {
            hideTooltip();
        }, 7000);
    }

    if (fabEl) {
        fabEl.addEventListener("click", openChat);
    }

    const sid = getSidFromUrl() || localStorage.getItem(SESSION_ACTIVE_KEY);
    if (sid) {
        tryRestoreSessionById(sid);
    }

    // Ensure close button works (bind in JS so it never fails)
    const closeBtn = document.getElementById("btn-close");
    if (closeBtn) {
        closeBtn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            closeChat();
        });
    }

    setInterval(() => {
        if (chatInitialized) saveSessionSnapshot();
    }, SESSION_AUTOSAVE_MS);

    window.addEventListener("beforeunload", () => {
        if (chatInitialized) saveSessionSnapshot();
    });
});

function hideTooltip() {
    const tooltipEl = document.getElementById("chat-tooltip");
    if (!tooltipEl) return;
    tooltipEl.classList.remove("chat-tooltip--visible");
    tooltipEl.setAttribute("aria-hidden", "true");
    if (tooltipTimeoutId) {
        clearTimeout(tooltipTimeoutId);
        tooltipTimeoutId = null;
    }
}

/**
 * Extracts user context (phone, name, email) from URL parameters or global config.
 * Supports: ?uPhone=... &uName=... &uEmail=...
 */
function initSessionFromContext() {
    try {
        const params = new URLSearchParams(window.location.search);
        
        // 1. Phone extraction (URL -> runtimeConfig -> localStorage -> global objects)
        const uPhone = params.get("uPhone") || 
                       params.get("phone") || 
                       params.get("USER_PHONE") ||
                       runtimeApiConfig.USER_PHONE || 
                       runtimeApiConfig.phone ||
                       localStorage.getItem("mothrly_user_phone") ||
                       localStorage.getItem("user_phone") ||
                       window.USER_PHONE || 
                       (window.AppConfig && window.AppConfig.phone);

        if (uPhone) {
            const digits = String(uPhone).replace(/\D/g, "");
            // Handle 91 prefix if present
            bookingState.phone = (digits.length === 12 && digits.startsWith("91")) ? digits.slice(2) : digits;
            console.log("[Context] Initialized phone:", bookingState.phone);
        }

        // 2. Name extraction
        const uName = params.get("uName") || 
                      params.get("name") || 
                      runtimeApiConfig.USER_NAME || 
                      runtimeApiConfig.name ||
                      localStorage.getItem("mothrly_user_name") ||
                      localStorage.getItem("user_name") ||
                      window.USER_NAME ||
                      (window.AppConfig && window.AppConfig.name);
        if (uName) {
            bookingState.name = uName;
            console.log("[Context] Initialized name:", uName);
        }

        // 3. Email extraction
        const uEmail = params.get("uEmail") || 
                       params.get("email") || 
                       runtimeApiConfig.USER_EMAIL || 
                       runtimeApiConfig.email ||
                       localStorage.getItem("mothrly_user_email") ||
                       localStorage.getItem("user_email") ||
                       window.USER_EMAIL ||
                       (window.AppConfig && window.AppConfig.email);
        if (uEmail) {
            bookingState.email = uEmail;
            console.log("[Context] Initialized email:", uEmail);
        }
    } catch (err) {
        console.error("[Context] initialization failed:", err);
    }
}

// ── App PostMessage Listener (Native App Integration) ─────────────────
window.addEventListener("message", (event) => {
    try {
        const data = event.data;
        if (data && typeof data === "object") {
            console.log("[App] Incoming message context:", data);
            
            const rawPhone = data.phone || data.uPhone || data.USER_PHONE;
            if (rawPhone) {
                const digits = String(rawPhone).replace(/\D/g, "");
                bookingState.phone = (digits.length === 12 && digits.startsWith("91")) ? digits.slice(2) : digits;
            }
            if (data.name || data.uName || data.USER_NAME) bookingState.name = data.name || data.uName || data.USER_NAME;
            if (data.email || data.uEmail || data.USER_EMAIL) bookingState.email = data.email || data.uEmail || data.USER_EMAIL;
            
            console.log("[App] Context updated via postMessage.");
        }
    } catch (e) {
        console.error("[App] Message handler error:", e);
    }
});

/**
 * Verifies if the Node backend (Port 5000) is reachable.
 * Logs status to console; helps debug the "Not functional backend" reports.
 */
async function checkBackendHealth() {
    try {
        const resp = await fetch(makeApiUrl(NODE_API_BASE, "/api/health"), { mode: 'cors' });
        if (resp.ok) {
            console.log("[Health] Node Backend (Port 5000) is ONLINE.");
        } else {
            console.warn("[Health] Node Backend reached but returned error:", resp.status);
        }
    } catch (err) {
        console.error("[Health] Node Backend (Port 5000) is UNREACHABLE:", err.message);
    }
}

function openChat() {
    const panelEl = document.getElementById("chat-panel");
    const floatingChatEl = document.querySelector(".floating-chat");
    if (!panelEl || !floatingChatEl) return;

    // First time opening the chat: initialize and check context/permissions
    if (!chatInitialized) {
        chatInitialized = true;
        
        // Clear container and send welcome message
        messagesContainer.innerHTML = "";

        if (!window.isSecureContext) {
            showSecureContextWarning();
        }

        sendWelcomeMessage();
        initSessionFromContext();
        checkBackendHealth();
        
        // Show permission request card after a short delay for better UX
        setTimeout(() => {
            renderPermissionRequestCard();
            prefetchLocation();
        }, 800);

        updateProgress(1);
    }

    userHasOpenedChat = true;
    hideTooltip();

    // Restore panel to full size if it was minimized
    if (panelEl.dataset.minimized === "true") {
        const messages = document.getElementById("chat-messages");
        const inputBar = document.querySelector(".chat-input-bar");
        const typingInd = document.getElementById("typing-indicator");
        if (messages) messages.style.display = "";
        if (inputBar) inputBar.style.display = "";
        if (typingInd) typingInd.style.display = "";
        panelEl.style.height = "";
        panelEl.dataset.minimized = "false";
        const minBtn = document.getElementById("btn-minimize");
        if (minBtn) minBtn.title = "Resume session";
    }

    panelEl.classList.remove("chat-panel--closed");
    panelEl.classList.add("chat-panel--open");
    floatingChatEl.classList.add("chat-panel-open");

    // Prevent mobile keyboard from opening automatically on panel open.
    blurActiveInput();
    setTimeout(() => maybeFocusElement(userInput), 150);
    saveSessionSnapshot();
}

function closeChatPanel() {
    const panelEl = document.getElementById("chat-panel");
    const floatingChatEl = document.querySelector(".floating-chat");
    if (!panelEl || !floatingChatEl) return;

    panelEl.classList.remove("chat-panel--open");
    panelEl.classList.add("chat-panel--closed");
    floatingChatEl.classList.remove("chat-panel-open");
    // Ensure virtual keyboard is dismissed when chat closes.
    blurActiveInput();
}

// ── Pre-fetch location silently on page load ───────────────────────────
function prefetchLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            // Reverse geocode in background and store for later use
            const { latitude, longitude } = pos.coords;
            fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&accept-language=en`)
                .then(r => r.json())
                .then(data => {
                    detectedLocation = data.display_name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
                })
                .catch(() => {
                    detectedLocation = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
                });
        },
        () => { /* Permission denied or unavailable — user will enter manually */ },
        { timeout: 10000, enableHighAccuracy: false }
    );
}

// ── Event listeners ───────────────────────────────────────────────────
sendBtn.addEventListener("click", handleSend);
userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
    }
});
if (micBtn) {
    micBtn.addEventListener("click", toggleVoiceInput);
    // Mobile optimization: ensure first touch triggers efficiently
    micBtn.addEventListener("touchend", (e) => {
        if (!isRecording) {
            e.preventDefault();
            toggleVoiceInput();
        }
    });
}

// ── Send helpers ──────────────────────────────────────────────────────
function handleSend() {
    sendMessage(userInput.value.trim());
}

/**
 * Detect booking / menu intent from free text or voice (same flows as welcome chips).
 * Returns null if no match.
 */
function detectBookingIntentFromText(raw) {
    let m = (raw || "").toLowerCase().trim();
    // Common misspellings → match lactation / consultant flows
    m = m
        .replace(/\blacatation\b/g, "lactation")
        .replace(/\blacation\b/g, "lactation")
        .replace(/\blactatation\b/g, "lactation")
        .replace(/\blaction\b/g, "lactation")
        .replace(/\bgynocologist\b/gi, "gynecologist");
    if (!m) return null;

    if (
        /\b(contact support|contact motherly|reach support|talk to (someone|support|team))\b/.test(m) ||
        (m.includes("contact") && m.includes("support"))
    ) {
        return "contact";
    }
    if (/\b(about motherly|what is motherly|who are you|tell me about motherly)\b/.test(m)) {
        return "about";
    }
    if (/\b(prenatal nutrition|pregnancy nutrition|nutrition during pregnancy|pregnancy diet)\b/.test(m)) {
        return "prenatal";
    }
    if (
        /\b(lactation|breastfeeding|breast feeding|nursing|feeding support|book lactation|lactation consultant|lactation cons)\b/.test(m) ||
        (/\bconsultant\b/.test(m) && /\b(lact|breast|feed|nurs|milk)\b/.test(m))
    ) {
        return "lactation";
    }
    if (
        /\b(book (a )?doctor|doctor consultation|speak to a doctor|video consultation|in[\s-]?clinic|clinic visit|online consultation)\b/.test(m) ||
        /\b(gynecologist|gynaecologist|obgyn|ob-gyn|obstetrician|women'?s health (doctor)?)\b/.test(m) ||
        (m.includes("doctor") && (m.includes("book") || m.includes("consult"))) ||
        (/\bconsult\b/.test(m) && /\b(gyn|obstetric|ob[\s-]?gyn|doctor|physician|specialist)\b/.test(m))
    ) {
        return "doctor";
    }
    if (/\b(nanny|childcare|babysit|baby sitter|book nanny)\b/.test(m)) {
        return "nanny";
    }
    if (
        /\b(doula|book doula|book a doula|need a doula|hire a doula|birth support|labou?r support)\b/.test(m)
    ) {
        return "doula";
    }
    return null;
}

/**
 * After /chat replies, show the same option chips as the welcome buttons when intent matches.
 * Does not duplicate user messages or alter booking cards already on screen.
 */
function maybeRenderBookingChipsAfterChat(userText) {
    if (bookingState.awaitingDescription) return;
    if (document.querySelector(".booking-card")) return;

    const intent = detectBookingIntentFromText(userText);
    if (!intent) return;

    updateProgress(1);

    switch (intent) {
        case "doula":
            bookingState.subType = "Doula";
            renderSubOptions("doula-reason", [
                { label: "Pregnancy Support", desc: "Pregnancy Guidance" },
                { label: "Labor & Delivery", desc: "Labor Support" },
                { label: "After Birth Care", desc: "Postpartum Care" },
                { label: "Breastfeeding Help", desc: "Nursing Support" },
            ]);
            break;
        case "nanny":
            bookingState = { step: 1, service: "Nanny" };
            setTimeout(() => renderNannyChildDetailsCard(), 400);
            break;
        case "doctor":
            renderSubOptions("consult-mode", [
                { label: "Online Consultation", desc: "Video Call With Doctor" },
                { label: "In-Clinic Visit", desc: "Visit Our Clinic In Person" },
            ]);
            break;
        case "lactation":
            renderSubOptions("lactation-mode", [
                { label: "Home Visit", desc: "Consultant Visits You" },
                { label: "Online Session", desc: "Video Call Support" },
                { label: "Clinic Appointment", desc: "Visit OOur Clinic" },
            ]);
            break;
        case "prenatal":
            renderPrenatalLearnOptions();
            break;
        case "about":
            renderSubOptions("about-next", [
                { label: "Book a Service", desc: "Start Booking Now" },
                { label: "Contact Support", desc: "Talk To Our Team" },
            ]);
            break;
        case "contact":
            setTimeout(() => renderContactSupportCard(), 400);
            break;
        default:
            break;
    }
}

async function sendMessage(text) {
    console.log("[Chat] sendMessage called with:", text);
    const trimmed = (text || "").trim();
    if (!trimmed) {
        console.warn("[Chat] sendMessage: empty text ignored");
        return;
    }

    try {
        // Echo prevention: Only block if user sends the EXACT prompt (prevents loop/confusion)
        // Fuzzy matching was causing valid user messages to "disappear".
        const prompt = getDescriptionPromptForService(bookingState.service || "").trim();
        const cleanT = trimmed.toLowerCase().replace(/\s+/g, ' ');
        const cleanP = prompt.toLowerCase().replace(/\s+/g, ' ');
        
        // Exact match check only (safer UX)
        if (cleanT === cleanP && cleanT.length > 20) {
            console.warn("[Chat] Exact prompt match detected. Suppressing.");
            showToast("Suspected echo. Please tell us your needs naturally.");
            return;
        }

        console.log("[Chat] Appending user message...");
        removeAllChips();
        setInputEnabled(false);

        // Await the append so the transition to "typing" or "review" is visually synced
        await appendMessage(trimmed, "user");
        userInput.value = "";
        
        // Intercept for history phone lookup
        if (bookingState.awaitingHistoryPhone) {
            const phoneDigits = trimmed.replace(/\D/g, "");
            if (phoneDigits.length === 10 || (phoneDigits.length === 12 && phoneDigits.startsWith("91"))) {
                const finalPhone = phoneDigits.length === 12 ? phoneDigits.slice(2) : phoneDigits;
                bookingState.phone = finalPhone;
                bookingState.awaitingHistoryPhone = false;
                fetchAndRenderHistory(finalPhone);
                return;
            } else {
                appendBotMessage("Please enter a valid **10-digit phone number**.");
                setInputEnabled(true);
                return;
            }
        }

        // Intercept the message if we are waiting for a booking description
        if (bookingState.awaitingDescription) {
        const validation = validateBookingDescription(trimmed);
        if (!validation.valid) {
            setInputEnabled(true);
            setTimeout(() => {
                appendBotMessage(validation.message);
                scrollToBottomIfNearBottom();
                setTimeout(() => maybeFocusElement(userInput), 100);
            }, 400);
            return;
        }

        // Client-side checks passed — ask LLM to verify relevance and validity
        setInputEnabled(false);
        showTyping(true);
        console.log("[Booking] Validating description via backend...");
        
        try {
            const resp = await apiFetch(FASTAPI_API_BASE, "/validate-booking-description", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    description: trimmed,
                    service: bookingState.service || "",
                }),
                timeout: 8000, // 8s specifically for validation
            });
            
            const data = await resp.json().catch(() => ({}));
            showTyping(false);

            const redirectSlug = (data.redirect_service || "").toLowerCase();
            const redirectServiceMap = {
                doctor: "Doctor Consultation",
                doula: "Doula — Support",
                lactation: "Lactation Consultant",
                nanny: "Nanny",
            };

            if (redirectSlug && redirectServiceMap[redirectSlug]) {
                console.log(`[Booking] AI suggested redirect to: ${redirectSlug}`);
                bookingState.service = redirectServiceMap[redirectSlug];
                bookingState.description = trimmed;
                bookingState.awaitingDescription = false;
                bookingState.editingFromReviewTarget = null;
                const switchMsg = (data.message && data.message.trim()) || "";
                if (switchMsg) await appendBotMessage(switchMsg);
                updateProgress(4); // Moving to confirmation prep
                renderReviewBookingCard();
                setInputEnabled(true);
                setTimeout(() => maybeFocusElement(userInput), 100);
                return;
            }

            if (data.valid === false) {
                // AI strictly rejects it — give user one more chance but explain why
                const llmMessage = (data.message && data.message.trim()) || "Please tell us why you need this service so we can help.\n\nTip: You can type or use the mic.";
                await appendBotMessage(llmMessage);
                setInputEnabled(true);
                setTimeout(() => maybeFocusElement(userInput), 100);
                return;
            }

            // data.valid is true OR undefined (fallback) -> Proceed
            bookingState.description = trimmed;
            bookingState.awaitingDescription = false;
            bookingState.editingFromReviewTarget = null;
            updateProgress(4);
            setInputEnabled(true);
            renderReviewBookingCard();
            return;

        } catch (err) {
            const apiName = "Python/FastAPI (8000)";
            console.error(`[Booking] ${apiName} validation failed:`, err);
            showTyping(false);
            
            // Graceful fallback: dont block the user if the server is slow or unreachable
            bookingState.description = trimmed;
            bookingState.awaitingDescription = false;
            bookingState.editingFromReviewTarget = null;
            updateProgress(4);
            
            if (err.name === 'AbortError') {
                await appendBotMessage("Taking a bit long to verify, but let's proceed with your description!");
            } else {
                console.warn(`[Booking] Proceeding to review despite ${apiName} error.`);
            }
            
            setInputEnabled(true);
            renderReviewBookingCard();
            return;
        }
    }

    showTyping(true);
    try {
        const response = await apiFetch(FASTAPI_API_BASE, "/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: trimmed, history: chatHistory }),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        showTyping(false);
        await appendMessage(data.response, "bot");

        chatHistory.push({ role: "user", content: trimmed });
        chatHistory.push({ role: "assistant", content: data.response });
        maybeRenderBookingChipsAfterChat(trimmed);
    } catch (err) {
        const apiName = "Python/FastAPI (8000)";
        console.error(`[Chat] ${apiName} Error:`, err);
        showTyping(false);
        await appendMessage(`Oops — I couldn't reach the ${apiName} server. Please ensure it is running.`, "bot");
    } finally {
        setInputEnabled(true);
        setTimeout(() => maybeFocusElement(userInput), 100);
        saveSessionSnapshot();
    }
} catch (err) {
    console.error("[Chat] Global sendMessage error:", err);
    showTyping(false);
    setInputEnabled(true);
}
}

// ── Reset flow ────────────────────────────────────────────────────────
async function resetChat() {
    if (isResettingChat) return;
    isResettingChat = true;

    const resetBtn = document.getElementById("btn-reset");
    if (resetBtn) resetBtn.disabled = true;
    try {
        const wrapper = document.querySelector('.chat-wrapper');
        const messages = document.getElementById('chat-messages');
        const inputBar = document.querySelector('.chat-input-bar');
        const typingInd = document.getElementById('typing-indicator');
        wrapper.style.height = '';
        messages.style.display = '';
        inputBar.style.display = '';
        typingInd.style.display = '';

        chatHistory = [];
        bookingState = {};
        messagesContainer.innerHTML = "";
        showTyping(false);
        updateProgress(1);
        await sendWelcomeMessage();
        saveSessionSnapshot();
    } finally {
        if (resetBtn) resetBtn.disabled = false;
        isResettingChat = false;
    }
}

// ── Resume icon action (restores existing session) ────────────────────
window.resumeSession = resumeSession;

// ── Close chat (collapse panel; FAB stays visible) ───────────────────
function closeChat() {
    closeChatPanel();
}

// Expose for inline handlers and external use
if (typeof window !== "undefined") {
    // Already defined as standalone functions above
}

// ── Progress indicator ────────────────────────────────────────────────
const DEFAULT_STEP_SUBTITLE = "Your maternal care assistant";
const STEP_LABELS = ["", "Step 1 of 4 – Service", "Step 2 of 4 – Schedule", "Step 3 of 4 – Contact", "Step 4 of 4 – Confirmation"];

function updateProgress(step) {
    const label = document.getElementById('step-label');
    const bar = document.getElementById('progress-fill');
    if (!label || !bar) return;
    if (step === 0) {
        label.textContent = DEFAULT_STEP_SUBTITLE;
        bar.style.width = "0%";
        return;
    }
    label.textContent = STEP_LABELS[step] || "";
    bar.style.width = `${(step / 4) * 100}%`;
}

// ── Welcome message ───────────────────────────────────────────────────
async function sendWelcomeMessage() {
    const quickActionsBar = document.getElementById("quick-actions-bar");
    if (quickActionsBar) quickActionsBar.classList.remove("quick-actions-bar--visible");

    const text = "Hi, I'm **Mothrly Assistant**. I can help you book a doula or consultation.\n\n**What do you need help with today?**";

    await appendMessage(text, "bot", true);
    
    // Render both primary grid and slider cards after the bot finishes typing
    sendWelcomeChips();
}

// ── Step 1 — Service Selection (with sub-options) ────────────────────
async function handleServiceSelection(service) {
    removeAllChips();
    appendMessage(service, "user");
    chatHistory.push({ role: "user", content: service });
    updateProgress(1);

    if (service === "Contact Support") {
        setTimeout(() => renderContactSupportCard(), 400);
        return;
    }

    if (service === "Booking History") {
        startBookingHistoryFlow();
        return;
    }

    if (service === "Book Doula") {
        await appendBotMessage("Great! What kind of support do you need?");
        bookingState.subType = "Doula";
        renderSubOptions("doula-reason", [
            { label: "Pregnancy Support",    desc: "Pregnancy Guidance" },
            { label: "Labor & Delivery",     desc: "Labor Support" },
            { label: "After Birth Care",     desc: "Postpartum Care" },
            { label: "Breastfeeding Help",   desc: "Nursing Support" },
        ]);
        return;
    }

    if (service === "Book Nanny") {
        bookingState = { step: 1, service: "Nanny" };
        setTimeout(async () => {
            await appendBotMessage(`Perfect! Let me set up your **Nanny** booking for childcare at home.\n\nFirst, tell us about the child(ren) we'll be caring for.`);
            renderNannyChildDetailsCard();
        }, 400);
        return;
    }

    if (service === "Book Doctor Consultation") {
        await appendBotMessage("Would you prefer an **Online Consultation** or an **In-Clinic Visit**?");
        renderSubOptions("consult-mode", [
            { label: "Online Consultation", desc: "Video Call With Doctor" },
            { label: "In-Clinic Visit",     desc: "Visit Our Clinic In Person" },
        ]);
        return;
    }

    if (service === "Book Lactation Consultant") {
        await appendBotMessage("How would you like to meet your lactation consultant?");
        renderSubOptions("lactation-mode", [
            { label: "Home Visit",          desc: "Consultant Visits You" },
            { label: "Online Session",      desc: "Video Call Support" },
            { label: "Clinic Appointment",  desc: "Visit Our Clinic" },
        ]);
        return;
    }

    if (service === "Prenatal Nutrition") {
        await appendBotMessage(
            "Maintaining a healthy diet during pregnancy is essential for both you and your baby's well-being. " +
            "Proper nutrition supports your baby's growth, brain development, and your overall health.\n\n" +
            "**What would you like to learn about?**"
        );
        renderPrenatalLearnOptions();
        return;
    }

    if (service === "About Motherly") {
        await appendBotMessage("Here's a quick overview of **Motherly**.\n\nWe are a maternal care platform connecting mothers with certified doulas, doctors, lactation consultants, and nutritionists — all in one place.\n\n[Chennai, India](https://www.google.com/maps/search/?api=1&query=Motherly+Care+Ethos+Chennai)\n[+91 99448 90577](tel:+919944890577)\n[motherlycareethos@gmail.com](mailto:motherlycareethos@gmail.com)\n\nWould you like to book a service now?");
        renderSubOptions("about-next", [
            { label: "Book a Service",   desc: "Start booking now" },
            { label: "Contact Support",  desc: "Talk to our team" },
        ]);
        return;
    }

    // Fallback — go directly to schedule
    bookingState = { step: 1, service };
    setTimeout(async () => {
        await appendBotMessage(`Perfect! Let me set up your **${service}** booking.`);
        renderScheduleCard();
    }, 400);
}

// ── Prenatal Nutrition: "What would you like to learn about?" (8 options, 2-col grid + SVG icons)
const PRENATAL_LEARN_OPTIONS = [
    { label: "Pregnancy Diet Plan", icon: "diet" },
    { label: "Baby Brain Development Foods", icon: "brain" },
    { label: "Managing Pregnancy Symptoms with Food", icon: "symptoms" },
    { label: "Foods to Avoid During Pregnancy", icon: "avoid" },
    { label: "Hydration & Healthy Drinks", icon: "hydration" },
    { label: "Healthy Weight Gain Guide", icon: "weight" },
    { label: "Postpartum Recovery Diet", icon: "postpartum" },
    { label: "Daily Pregnancy Diet Recommendation", icon: "daily" },
];

function getPrenatalTopicIcon(iconKey) {
    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
    switch (iconKey) {
        case "diet":   s += '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>'; break;
        case "brain":  s += '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>'; break;
        case "symptoms": s += '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>'; break;
        case "avoid":  s += '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>'; break;
        case "hydration": s += '<path d="M12 22c4-4 8-7.5 8-12a8 8 0 0 0-16 0c0 4.5 4 8 8 12z"/>'; break;
        case "weight":  s += '<rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="12" cy="12" r="7"/><path d="M12 12l-3 4"/><path d="M12 5v2"/><path d="M5 12h2"/><path d="M17 12h2"/><path d="M12 17v2"/>'; break;
        case "postpartum": s += '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'; break;
        case "daily":   s += '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'; break;
        default: s += '<circle cx="12" cy="12" r="10"/>';
    }
    return s + '</svg>';
}

// ── Prenatal Nutrition: Curated important tips for quick reference ─────────
const PRENATAL_TIPS = {
    "Pregnancy Diet Plan": "A balanced diet is key! Aim for 3 solid meals and 2 healthy snacks.\n\n**Quick Tips:**\n• **Protein:** Eggs, lentils, or lean meat in every meal.\n• **Veggies:** Half your plate should be colorful vegetables.\n• **Grains:** Opt for whole grains like brown rice or whole wheat.\n• **Snacks:** Fresh fruits or yogurt are great choices.",
    "Baby Brain Development Foods": "Support your baby's growth with these essential nutrients!\n\n**Best Foods:**\n• **DHA (Omega-3):** Walnuts, flaxseeds, or cooked fish (2x per week).\n• **Folate:** Spinach, Broccoli, and citrus fruits.\n• **Iron:** Pomegranate, beetroots, and spinach to keep energy up.\n• **Iodine:** Use iodized salt in moderation.",
    "Managing Pregnancy Symptoms with Food": "Small changes to what you eat can help you feel much better.\n\n**Common Fixes:**\n• **Nausea:** Ginger tea or dry crackers first thing in the morning.\n• **Heartburn:** Eat smaller meals often; avoid spicy/fried foods before bed.\n• **Constipation:** Increase fiber (lentils, oats) and drink 2-3L of water.\n• **Swelling:** Limit extra salt and stay well hydrated.",
    "Foods to Avoid During Pregnancy": "Safety first! Steer clear of these to protect you and your baby.\n\n**Avoid These:**\n• **Raw Foods:** No raw meat, uncooked eggs, or unwashed veg.\n• **Unpasteurized Dairy:** Avoid raw milk and soft cheeses like Brie/Feta.\n• **High Mercury:** Avoid large fish like Shark or King Mackerel.\n• **Caffeine:** Limit to 1 small cup of coffee or tea per day.",
    "Hydration & Healthy Drinks": "Staying hydrated prevents fatigue and keeps your baby's environment safe.\n\n**What to Sip:**\n• **Water:** Aim for 8-10 glasses daily.\n• **Coconut Water:** Great for natural electrolytes.\n• **Buttermilk:** Excellent for cooling the body and digestion.\n• **Fresh Juice:** Stick to homemade versions without added sugar.",
    "Healthy Weight Gain Guide": "It's about nutrient density, not just 'eating for two'.\n\n**Guidelines:**\n• **First Trimester:** Minimal extra calories needed (focus on quality).\n• **Second Trimester:** Add about 300 extra calories (like a fruit + yogurt snack).\n• **Third Trimester:** Add about 450 extra calories.\n• **Tip:** Gain weight gradually and stay active with walking.",
    "Postpartum Recovery Diet": "Your body needs help to heal after delivery.\n\n**Recovery Tips:**\n• **Soft Foods:** Warm porridges and soups are easier on digestion.\n• **Laddus/Dry Fruits:** Traditional nursing snacks help with energy.\n• **Hydration:** Crucial for milk production (3-4L per day).\n• **Iron & Calcium:** Focus on ragi, milk, and dates.",
    "Daily Pregnancy Diet Recommendation": "Keep it simple with the 'Mothrly Plate' approach.\n\n**Daily Proportions:**\n• **50% Vegetables:** Greens, gourds, and local seasonal veg.\n• **25% Protein:** Dals, eggs, paneer, or low-mercury fish.\n• **25% Carbohydrates:** Millets, red rice, or whole wheat chapatis.\n• **Bonus:** A piece of seasonal fruit with every lunch."
};

// ── Text casing helpers (Option boxes) ─────────────────────────────────
function sentenceCaps(input) {
    if (input == null) return "";
    const s = String(input);
    // Capitalize first non-space char, and first char after sentence boundaries (.?! or newline)
    let out = "";
    let capNext = true;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (capNext && /[a-zA-Z]/.test(ch)) {
            out += ch.toUpperCase();
            capNext = false;
            continue;
        }
        out += ch;
        if (ch === "." || ch === "!" || ch === "?" || ch === "\n") {
            capNext = true;
        } else if (!/\s/.test(ch)) {
            // Once we hit any non-space character in a sentence, stop auto-capping until boundary
            capNext = false;
        }
    }
    return out;
}

function formatServiceForDisplay(service) {
    const raw = String(service || "").trim();
    if (!raw) return "—";
    // Convert separators like "Doula — Pregnancy Support" to "Doula for Pregnancy Support"
    return raw.replace(/\s+[—-]\s+/g, " for ");
}

function renderPrenatalLearnOptions() {
    var row = document.createElement("div");
    row.className = "options-container chips-container prenatal-learn-grid";
    row.dataset.context = "prenatal-learn";
    PRENATAL_LEARN_OPTIONS.forEach(function (opt) {
        var btn = document.createElement("button");
        btn.className = "option-btn option-btn--prenatal fade-in";
        // Create stacked layout identical to welcome primary options
        btn.innerHTML = `
            <span style="display:flex;align-items:center;justify-content:center;width:20px;height:20px;margin-bottom:2px;flex-shrink:0;">
                ${getPrenatalTopicIcon(opt.icon)}
            </span>
            <span style="text-align:center;">${sentenceCaps(opt.label)}</span>
        `;
        btn.addEventListener("click", function () { handleSubOptionSelection("prenatal-learn", opt.label); });
        row.appendChild(btn);
    });
    messagesContainer.appendChild(row);
    scrollToShowOptions(row);
}

// ── Sub-option chips renderer ─────────────────────────────────────────
function renderSubOptions(context, options) {
    const row = document.createElement("div");
    row.className = "options-container chips-container";
    row.dataset.context = context;

    options.forEach(({ label, desc }) => {
        const btn = document.createElement("button");
        btn.className = "option-btn fade-in";
        btn.style.textAlign = "left";
        btn.innerHTML = `
            <span style="display:flex;flex-direction:column;gap:3px;line-height:1.4;">
                <span style="font-weight:600;font-size:11px;color:#1F2937;">${sentenceCaps(label)}</span>
                ${desc ? `<span style="font-size:10px;color:#6B7280;font-weight:400;">${sentenceCaps(desc)}</span>` : ""}
            </span>`;
        btn.addEventListener("click", () => handleSubOptionSelection(context, label));
        row.appendChild(btn);
    });

    messagesContainer.appendChild(row);
    scrollToShowOptions(row);
}

// ── Sub-option selection handler ──────────────────────────────────────
async function handleSubOptionSelection(context, subOption) {
    removeAllChips();
    appendMessage(subOption, "user");
    chatHistory.push({ role: "user", content: subOption });

    // ── About Motherly follow-up ─────────────────────────────────────
    if (context === "about-next") {
        if (subOption === "Contact Support") {
            setTimeout(() => renderContactSupportCard(), 400);
        } else {
            // Re-show main menu
            setTimeout(() => {
                appendBotMessage("Which service would you like to book?");
                setTimeout(() => sendWelcomeChips(), 600);
            }, 300);
        }
        return;
    }

    // ── Doula type → ask reason ──────────────────────────────────────
    if (context === "doula-type") {
        bookingState.subType = subOption;
        await appendBotMessage(`Got it! You'd like a **${subOption}**.\n\nWhat kind of support do you need?`);
        renderSubOptions("doula-reason", [
            { label: "Pregnancy Support",    desc: "Guidance During pregnancy" },
            { label: "Labor & Delivery",     desc: "Support During Birth" },
            { label: "After Birth Care",     desc: "Post-Natal Recovery Help" },
            { label: "Breastfeeding Help",   desc: "Nursing & Lactation Support" },
        ]);
        return;
    }

    // ── Doula reason → schedule ──────────────────────────────────────
    if (context === "doula-reason") {
        bookingState.reason = subOption;
        bookingState.service = `${bookingState.subType || "Doula"} for ${subOption}`;
        await appendBotMessage(`Got it! Let me schedule your **${bookingState.service}** session.`);
        renderScheduleCard();
        return;
    }

    // ── Doctor consultation mode (Online / In-Clinic) → schedule ─────────────────────────────────
    if (context === "consult-mode") {
        bookingState.service = `Doctor Consultation (${subOption})`;
        await appendBotMessage(`Perfect! Let me schedule your **${bookingState.service}**.`);
        renderScheduleCard();
        return;
    }

    // ── Lactation consultant mode (Home Visit / Online / Clinic) → schedule ─────────────────────
    if (context === "lactation-mode") {
        bookingState.service = `Lactation Consultant (${subOption})`;
        await appendBotMessage(`Perfect! Let me schedule your **${bookingState.service}**.`);
        renderScheduleCard();
        return;
    }

    // ── Prenatal learn (topic selected) → Provide curated tips immediately ───────────────────
    if (context === "prenatal-learn") {
        const localTip = PRENATAL_TIPS[subOption];
        
        if (localTip) {
            await appendBotMessage(localTip);
            chatHistory.push({ role: "user", content: subOption });
            chatHistory.push({ role: "assistant", content: localTip });
            setTimeout(function () { maybeFocusElement(userInput); }, 100);
            return;
        }

        // Fallback to chat API if tip not found locally
        setInputEnabled(false);
        showTyping(true);
        try {
            var resp = await apiFetch(FASTAPI_API_BASE, "/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: subOption, history: chatHistory }),
            });
            if (!resp.ok) throw new Error("Chat request failed");
            var data = await resp.json();
            showTyping(false);
            await appendBotMessage(data.response);
            chatHistory.push({ role: "user", content: subOption });
            chatHistory.push({ role: "assistant", content: data.response });
        } catch (err) {
            console.error("Prenatal chat error:", err);
            showTyping(false);
            await appendBotMessage("I'm sorry, I'm having a little trouble providing those details right now. Please try again soon.");
        }
        setInputEnabled(true);
        setTimeout(function () { maybeFocusElement(userInput); }, 100);
        return;
    }

    // ── All other sub-options → schedule directly ────────────────────
    bookingState.subType = subOption;
    bookingState.service = `${bookingState.service} (${subOption})`;
    await appendBotMessage(`Perfect! Let me schedule your **${bookingState.service}** appointment.`);
    renderScheduleCard();
}

// ── Show only the main option chips (for re-use) ──────────────────────
function sendWelcomeChips(renderPrimary = true, renderSecondary = true) {
    const opts = [
        { label: "Book Doula", icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>' },
        { label: "Book Nanny", icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' },
        { label: "Book Doctor Consultation", icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>' },
        { label: "Book Lactation Consultant", icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a8 8 0 0 0 8-8c0-4.42-4-8-8-12-4 4-8 7.58-8 12a8 8 0 0 0 8 8z"/><circle cx="12" cy="14" r="2"/></svg>' },
        { label: "Prenatal Nutrition", icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>' },
        { label: "About Motherly", icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' },
        { label: "Contact Support", icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.32 2 2 0 0 1 3.58 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.56a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.72 16z"/></svg>' },
        { label: "Booking History", icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' },
    ];

    const secondarySet = new Set(["Booking History", "Contact Support", "Prenatal Nutrition", "About Motherly"]);
    const secondaryOrder = ["Booking History", "Contact Support", "Prenatal Nutrition", "About Motherly"];

    if (renderPrimary) {
        const optionsWrap = document.createElement("div");
        optionsWrap.className = "welcome-options-wrap chips-container";
        const primaryGrid = document.createElement("div");
        primaryGrid.className = "welcome-options-main";

        opts.forEach(({ label, icon }) => {
            if (!secondarySet.has(label)) {
                const btn = document.createElement("button");
                btn.className = "option-btn fade-in option-btn--welcome-primary";
                btn.innerHTML = `
                    <span style="display:flex;align-items:center;justify-content:center;width:18px;height:18px;margin-bottom:2px;flex-shrink:0;">${icon}</span>
                    <span style="text-align:center;">${sentenceCaps(label)}</span>
                `;
                btn.addEventListener("click", () => handleServiceSelection(label));
                primaryGrid.appendChild(btn);
            }
        });
        
        optionsWrap.appendChild(primaryGrid);
        messagesContainer.appendChild(optionsWrap);
        scrollToShowOptions(optionsWrap);
    }

    if (renderSecondary) {
        const quickActionsBar = document.getElementById("quick-actions-bar");
        if (quickActionsBar) {
            quickActionsBar.innerHTML = "";
            
            secondaryOrder.forEach((label) => {
                const opt = opts.find(o => o.label === label);
                if (opt) {
                    const btn = document.createElement("button");
                    btn.className = "option-btn fade-in option-btn--welcome-secondary";
                    // Use horizontal flex layout for quick-action slider cards
                    btn.innerHTML = `
                        <span style="display:flex;align-items:center;justify-content:center;width:14px;height:14px;flex-shrink:0;">${opt.icon}</span>
                        <span>${sentenceCaps(opt.label)}</span>
                    `;
                    btn.addEventListener("click", () => handleServiceSelection(opt.label));
                    quickActionsBar.appendChild(btn);
                }
            });
            
            quickActionsBar.classList.add("quick-actions-bar--visible");
        }
    }
}

// ── Step 2a — Nanny: Child details (age + names) ─────────────────────
function renderNannyChildDetailsCard() {
    updateProgress(2);

    // Reset any previously selected age for this card
    delete bookingState._pendingChildAge;

    const AGE_OPTIONS = [
        { value: "0-1", label: "0 – 1 year",     sub: "Infant"   },
        { value: "1-3", label: "1 – 3 years",    sub: "Toddler"  },
        { value: "3+",  label: "3 years & above", sub: "Child"    },
    ];

    const card = document.createElement("div");
    card.className = "booking-card chips-container fade-in";
    card.id = "nanny-child-card";

    // Title row
    const titleDiv = document.createElement("div");
    titleDiv.className = "booking-card-title";
    titleDiv.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Tell us about the child(ren)
    `;
    card.appendChild(titleDiv);

    // Label
    const label = document.createElement("label");
    label.className = "booking-label";
    label.innerHTML = `Child's age range <span class="booking-required">*</span>`;
    card.appendChild(label);

    // 3-column age card grid
    const grid = document.createElement("div");
    grid.className = "nanny-age-grid";
    grid.id = "nanny-age-grid";

    AGE_OPTIONS.forEach(({ value, label: ageLabel, sub }) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "nanny-age-card";
        btn.dataset.value = value;
        btn.innerHTML = `
            <span class="nanny-age-label">${sentenceCaps(ageLabel)}</span>
            <span class="nanny-age-sub">${sentenceCaps(sub)}</span>
        `;
        btn.addEventListener("click", () => {
            grid.querySelectorAll(".nanny-age-card").forEach(b => b.classList.remove("nanny-age-card--selected"));
            btn.classList.add("nanny-age-card--selected");
            bookingState._pendingChildAge = value;
            clearCardError("nanny-child-card");
        });
        grid.appendChild(btn);
    });
    card.appendChild(grid);

    // Submit button
    const submitBtn = document.createElement("button");
    submitBtn.className = "booking-btn";
    submitBtn.textContent = "Next → Schedule";
    submitBtn.onclick = () => submitNannyChildDetails();
    card.appendChild(submitBtn);

    messagesContainer.appendChild(card);
    scrollToBottomIfNearBottom();
}

window.submitNannyChildDetails = function() {
    const age = bookingState._pendingChildAge;

    if (!age) {
        showCardError("nanny-child-card", "Please select the child's age range.");
        return;
    }

    bookingState.childAgeRange = age;
    delete bookingState._pendingChildAge;
    removeAllChips();
    const ageLabel = { "0-1": "0–1 year (infant)", "1-3": "1–3 years (toddler)", "3+": "3 years & above" }[age] || age;
    appendMessage(`Child age: ${ageLabel}`, "user");
    setTimeout(() => renderScheduleCard(), 400);
};

// ── Contact Support Card ──────────────────────────────────────────────
function renderContactSupportCard() {
    const row = document.createElement("div");
    row.className = "message bot-message fade-in";
    
    // Bot Avatar Box
    const avatarHtml = `<div class="message-avatar-box" style="background:#fff;border:1px solid #E5E7EB;overflow:hidden;"><img src="/static/motherly_logo_v3.png" style="width:100%;height:100%;object-fit:cover;padding:0;"></div>`;
    
    const card = document.createElement("div");
    card.className = "booking-card fade-in"; // Removed chips-container to avoid conflict
    card.id = "contact-support-card";
    card.style.width = "fit-content";
    card.style.minWidth = "260px";
    card.style.padding = "14px 18px 14px 22px";
    card.style.marginTop = "0";
    card.style.boxShadow = "var(--shadow-bubble)";
    console.log("Contact Support Card Rendered (safeguards enabled)");
    
    card.innerHTML = `
        <div class="booking-card-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
            Contact Support
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;padding:4px 0;">
            <a href="tel:+919944890577" onclick="event.stopPropagation();" style="display:flex;align-items:center;gap:14px;text-decoration:none;cursor:pointer;transition:transform 0.2s;pointer-events:auto !important;position:relative;z-index:99;" onmouseenter="this.style.transform='translateX(4px)'" onmouseleave="this.style.transform='translateX(0)'">
                <span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#FEE2E2;flex-shrink:0;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.32 2 2 0 0 1 3.58 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.56a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.72 16z"/></svg>
                </span>
                <span style="color:#1F2937;font-weight:600;font-size:14px;">+91 99448 90577</span>
            </a>
            <a href="mailto:motherlycareethos@gmail.com" onclick="event.stopPropagation();" style="display:flex;align-items:center;gap:14px;text-decoration:none;cursor:pointer;transition:transform 0.2s;pointer-events:auto !important;position:relative;z-index:99;" onmouseenter="this.style.transform='translateX(4px)'" onmouseleave="this.style.transform='translateX(0)'">
                <span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#FEE2E2;flex-shrink:0;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                </span>
                <span style="color:#9B1A52;font-weight:600;font-size:13px;">motherlycareethos@gmail.com</span>
            </a>
            <a href="https://www.google.com/maps/search/?api=1&query=Motherly+Care+Ethos+Chennai" target="_blank" onclick="event.stopPropagation();" style="display:flex;align-items:center;gap:14px;text-decoration:none;cursor:pointer;transition:transform 0.2s;pointer-events:auto !important;position:relative;z-index:99;" onmouseenter="this.style.transform='translateX(4px)'" onmouseleave="this.style.transform='translateX(0)'">
                <span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#FEE2E2;flex-shrink:0;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                </span>
                <span style="color:#6B7280;font-size:14px;font-weight:500;">Chennai, India</span>
            </a>
        </div>
    `;
    
    row.innerHTML = avatarHtml;
    row.appendChild(card);
    
    messagesContainer.appendChild(row);
    scrollToBottomIfNearBottom();
}


// ── Step 2 — Schedule Card ────────────────────────────────────────────
function renderScheduleCard() {
    updateProgress(2);
    const todayStr = new Date().toISOString().split('T')[0];

    const card = document.createElement("div");
    card.className = "booking-card chips-container fade-in";
    card.id = "schedule-card";
    card.innerHTML = `
        <div class="booking-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Schedule Your Appointment
        </div>

        <label class="booking-label">Location <span class="booking-required">*</span></label>
        <div class="location-row">
            <div class="location-input-wrap">
                <input type="text" id="loc-input" class="booking-input booking-input--location" placeholder="Enter your location..." autocomplete="off">
                <button type="button" id="loc-clear-btn" class="location-clear-btn" title="Clear location" aria-label="Clear location">×</button>
            </div>
            <button onclick="detectLocation()" class="detect-btn" title="Detect my location">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
                Detect
            </button>
        </div>
        <p id="loc-status" style="font-size:12px;color:#9CA3AF;margin-top:4px; min-height:16px;"></p>

        <label class="booking-label">Date <span class="booking-required">*</span></label>
        <input type="text" id="date-input" class="booking-input booking-input--picker" placeholder="Select Date" readonly inputmode="none" aria-label="Select Date">

        <label class="booking-label">Time <span class="booking-required">*</span></label>
        <input type="text" id="time-input" class="booking-input booking-input--picker" placeholder="Select Time" readonly inputmode="none" aria-label="Select Time">
        <p class="booking-hint">Available: 9:00 AM – 6:00 PM</p>

        <button onclick="submitSchedule()" class="booking-btn">Next →</button>
    `;
    messagesContainer.appendChild(card);
    // Ensure the full schedule card (especially time selector + button) is visible inside the chat viewport
    scrollToRevealMessage(card);

    // Pre-fill location if already detected from page-load GPS request
    prefillLocationField();
    initLocationClearControl();
    initLocationAutocomplete();
    initSchedulePickers(todayStr);
}

function initSchedulePickers(todayStr) {
    const dateEl = document.getElementById("date-input");
    const timeEl = document.getElementById("time-input");
    if (!dateEl || !timeEl) return;

    // ── Date: custom in-panel calendar widget ──────────────────────────
    const openDatePicker = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openCustomDatePicker(dateEl, todayStr);
    };
    dateEl.addEventListener("pointerup", openDatePicker);
    dateEl.addEventListener("click", openDatePicker);

    const openTimePicker = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openCustomTimePicker(timeEl);
    };
    timeEl.addEventListener("click", openTimePicker);
    // On mobile, touchend fires before click — use it so the picker opens on the FIRST tap
    if (isMobileOrTablet()) {
        timeEl.addEventListener("touchend", (e) => {
            e.preventDefault();
            e.stopPropagation();
            openCustomTimePicker(timeEl);
        }, { passive: false });
    }
}

function parseIsoDate(isoDate) {
    if (!isoDate || typeof isoDate !== "string") return null;
    const [y, m, d] = isoDate.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
}

function formatIsoDate(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function formatDisplayDate(dateObj) {
    return dateObj.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function isDateInRange(dateObj, minDate, maxDate) {
    return dateObj >= minDate && dateObj <= maxDate;
}

function openCustomDatePicker(dateInputEl, todayStr) {
    const panelEl = document.getElementById("chat-panel");
    if (!panelEl) return;

    const existing = panelEl.querySelector(".date-picker-overlay");
    if (existing) existing.remove();

    const minDate = parseIsoDate(todayStr) || new Date();
    minDate.setHours(0, 0, 0, 0);
    const maxDate = new Date(minDate);
    maxDate.setFullYear(maxDate.getFullYear() + 1);
    maxDate.setHours(23, 59, 59, 999);

    const savedIso = dateInputEl.dataset.iso || bookingState.date || "";
    const savedDate = parseIsoDate(savedIso);
    let selectedDate = savedDate && isDateInRange(savedDate, minDate, maxDate) ? savedDate : null;
    let viewingDate = selectedDate ? new Date(selectedDate) : new Date(minDate);

    const overlay = document.createElement("div");
    overlay.className = "date-picker-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Select Date");

    const card = document.createElement("div");
    card.className = "date-picker-card";

    const header = document.createElement("div");
    header.className = "date-picker-header";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "date-picker-nav";
    prevBtn.textContent = "‹";

    const title = document.createElement("span");
    title.className = "date-picker-title";

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "date-picker-nav";
    nextBtn.textContent = "›";

    header.append(prevBtn, title, nextBtn);

    const daysRow = document.createElement("div");
    daysRow.className = "date-picker-days";
    ["MO", "TU", "WE", "TH", "FR", "SA", "SU"].forEach((d) => {
        const day = document.createElement("span");
        day.textContent = d;
        daysRow.appendChild(day);
    });

    const datesGrid = document.createElement("div");
    datesGrid.className = "date-picker-dates";

    const actions = document.createElement("div");
    actions.className = "date-picker-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "date-picker-btn date-picker-btn--cancel";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "date-picker-btn date-picker-btn--ok";
    okBtn.textContent = "OK";
    actions.append(cancelBtn, okBtn);

    function close() {
        overlay.classList.remove("date-picker-overlay--visible");
        setTimeout(() => overlay.remove(), 200);
    }

    function renderMonth() {
        title.textContent = viewingDate.toLocaleDateString("en-IN", {
            month: "short",
            year: "numeric",
        });
        datesGrid.innerHTML = "";

        const year = viewingDate.getFullYear();
        const month = viewingDate.getMonth();
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const startDay = firstDay === 0 ? 6 : firstDay - 1;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let i = 0; i < startDay; i++) {
            const empty = document.createElement("div");
            empty.className = "date-picker-empty";
            datesGrid.appendChild(empty);
        }

        for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
            const cellDate = new Date(year, month, dayNum);
            cellDate.setHours(0, 0, 0, 0);
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "date-picker-date";
            btn.textContent = String(dayNum);

            if (sameDay(cellDate, today)) btn.classList.add("date-picker-date--today");
            if (selectedDate && sameDay(cellDate, selectedDate)) btn.classList.add("date-picker-date--selected");

            if (!isDateInRange(cellDate, minDate, maxDate)) {
                btn.classList.add("date-picker-date--inactive");
                btn.disabled = true;
            } else {
                btn.addEventListener("click", () => {
                    selectedDate = cellDate;
                    renderMonth();
                });
            }

            datesGrid.appendChild(btn);
        }

        const viewMonthStart = new Date(year, month, 1);
        const minMonthStart = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
        const maxMonthStart = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
        prevBtn.disabled = viewMonthStart <= minMonthStart;
        nextBtn.disabled = viewMonthStart >= maxMonthStart;
    }

    prevBtn.addEventListener("click", () => {
        viewingDate = new Date(viewingDate.getFullYear(), viewingDate.getMonth() - 1, 1);
        renderMonth();
    });
    nextBtn.addEventListener("click", () => {
        viewingDate = new Date(viewingDate.getFullYear(), viewingDate.getMonth() + 1, 1);
        renderMonth();
    });
    cancelBtn.addEventListener("click", close);
    okBtn.addEventListener("click", () => {
        if (selectedDate) {
            dateInputEl.dataset.iso = formatIsoDate(selectedDate);
            dateInputEl.value = formatDisplayDate(selectedDate);
            clearCardError("schedule-card");
        }
        close();
    });

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close();
    });

    card.append(header, daysRow, datesGrid, actions);
    overlay.appendChild(card);
    panelEl.appendChild(overlay);
    renderMonth();
    requestAnimationFrame(() => overlay.classList.add("date-picker-overlay--visible"));
}

// Business hours: 9:00 AM – 6:00 PM, 30-min steps
function buildTimeSlots() {
    const slots = [];
    for (let h = 9; h <= 18; h++) {
        for (let m = 0; m < 60; m += 30) {
            if (h === 18 && m > 0) break;
            const hh = String(h).padStart(2, "0");
            const mm = String(m).padStart(2, "0");
            const value24 = `${hh}:${mm}`;
            const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
            const ampm = h < 12 ? "AM" : "PM";
            const label = `${hour12}:${mm} ${ampm}`;
            slots.push({ value24, label });
        }
    }
    return slots;
}

function openCustomTimePicker(timeInputEl) {
    if (isMobileOrTablet()) {
        openMdTimePicker(timeInputEl);
        return;
    }
    const panelEl = document.getElementById("chat-panel");
    if (!panelEl) return;

    // Remove any existing overlay
    const existing = panelEl.querySelector(".time-picker-overlay");
    if (existing) existing.remove();

    const currentValue24 = timeInputEl.dataset.value24 || "";
    const slots = buildTimeSlots();
    const dateInputEl = document.getElementById("date-input");
    const selectedDateIso = dateInputEl?.dataset?.iso || bookingState.date || "";
    const todayIso = formatIsoDate(new Date());
    const isSameDayBooking = selectedDateIso === todayIso;
    const now = new Date();
    const nowMinutes = (now.getHours() * 60) + now.getMinutes();
    const minLeadMinutes = 30;
    const minBookableMinutes = nowMinutes + minLeadMinutes;

    const overlay = document.createElement("div");
    overlay.className = "time-picker-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Select time");

    const card = document.createElement("div");
    card.className = "time-picker-card";

    const title = document.createElement("div");
    title.className = "time-picker-title";
    title.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Select Time`;

    const slotsWrap = document.createElement("div");
    slotsWrap.className = "time-picker-slots";

    const renderSlots = () => {
        const now = new Date();
        const nowMinutes = (now.getHours() * 60) + now.getMinutes();
        const minBookableMinutes = nowMinutes + 30; // 30-min lead
        const currentIso = formatIsoDate(now);
        const isToday = selectedDateIso === currentIso;

        slotsWrap.innerHTML = "";
        slots.forEach(({ value24, label }) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "time-picker-slot";
            const [slotH, slotM] = value24.split(":").map(Number);
            const slotMinutes = (slotH * 60) + slotM;
            const isPastSlot = isToday && slotMinutes < minBookableMinutes;
            
            if (isPastSlot) {
                btn.classList.add("time-picker-slot--disabled");
                btn.disabled = true;
            }
            if (!isPastSlot && value24 === (timeInputEl.dataset.value24 || "")) {
                btn.classList.add("time-picker-slot--selected");
            }
            
            btn.textContent = label;
            btn.dataset.value24 = value24;
            btn.dataset.label = label;
            btn.addEventListener("click", () => {
                if (btn.disabled) return;
                slotsWrap.querySelectorAll(".time-picker-slot--selected").forEach((b) => b.classList.remove("time-picker-slot--selected"));
                btn.classList.add("time-picker-slot--selected");
            });
            slotsWrap.appendChild(btn);
        });
    };

    renderSlots();
    // Refresh every 30 seconds while open
    const refreshInterval = setInterval(renderSlots, 30000);

    const actions = document.createElement("div");
    actions.className = "time-picker-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "time-picker-btn time-picker-btn--cancel";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "time-picker-btn time-picker-btn--ok";
    okBtn.textContent = "OK";

    function close() {
        clearInterval(refreshInterval);
        overlay.classList.remove("time-picker-overlay--visible");
        setTimeout(() => overlay.remove(), 200);
    }

    cancelBtn.addEventListener("click", close);

    okBtn.addEventListener("click", () => {
        const selected = slotsWrap.querySelector(".time-picker-slot--selected");
        if (selected) {
            timeInputEl.dataset.value24 = selected.dataset.value24;
            timeInputEl.value = selected.dataset.label;
            clearCardError("schedule-card");
        }
        close();
    });

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close();
    });

    actions.append(cancelBtn, okBtn);
    card.append(title, slotsWrap, actions);
    overlay.appendChild(card);
    panelEl.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add("time-picker-overlay--visible"));
}

// ── Pre-fill location card once GPS address is ready ──────────────────
function prefillLocationField() {
    const locInput  = document.getElementById("loc-input");
    const statusEl  = document.getElementById("loc-status");
    if (!locInput || !statusEl) return;

    if (detectedLocation) {
        // Already resolved — fill immediately
        locInput.value = detectedLocation;
        updateLocationClearButtonVisibility();
        statusEl.textContent = "Location auto-detected";
        return;
    }

    // Not yet resolved — show loading state and poll
    if (navigator.geolocation) {
        locInput.placeholder = "Detecting your location…";
        locInput.disabled = true;
        statusEl.textContent = "Detecting your location…";

        const poll = setInterval(() => {
            if (detectedLocation) {
                clearInterval(poll);
                locInput.disabled = false;
                locInput.placeholder = "Enter your location...";
                locInput.value = detectedLocation;
                updateLocationClearButtonVisibility();
                statusEl.textContent = "Location auto-detected";
            }
        }, 300);

        // Give up after 12s if permission was denied or GPS is unavailable
        setTimeout(() => {
            clearInterval(poll);
            if (!locInput.value) {
                locInput.disabled = false;
                locInput.placeholder = "Enter your location...";
                updateLocationClearButtonVisibility();
                statusEl.textContent = "Could not detect location. Please type your location.";
            }
        }, 12000);
    }
}

function initLocationClearControl() {
    const locInput = document.getElementById("loc-input");
    const clearBtn = document.getElementById("loc-clear-btn");
    const statusEl = document.getElementById("loc-status");
    if (!locInput || !clearBtn) return;

    updateLocationClearButtonVisibility();

    locInput.addEventListener("input", () => {
        updateLocationClearButtonVisibility();
    });

    function clearLocationField() {
        locInput.value = "";
        locInput.dispatchEvent(new Event("input", { bubbles: true }));
        detectedLocation = null;
        if (bookingState && Object.prototype.hasOwnProperty.call(bookingState, "location")) {
            delete bookingState.location;
        }
        updateLocationClearButtonVisibility();
        if (statusEl) statusEl.textContent = "Location cleared. Type or tap Detect.";
        clearCardError("schedule-card");
        maybeFocusElement(locInput);
    }

    clearBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearLocationField();
    });
}

function updateLocationClearButtonVisibility() {
    const locInput = document.getElementById("loc-input");
    const clearBtn = document.getElementById("loc-clear-btn");
    if (!locInput || !clearBtn) return;
    const hasValue = Boolean(locInput.value && locInput.value.trim());
    clearBtn.classList.toggle("is-visible", hasValue);
}

// ── Auto-detect (fires on card open) ─────────────────────────────────
function autoDetectLocation() {
    const statusEl = document.getElementById("loc-status");
    const locInput = document.getElementById("loc-input");
    if (!statusEl || !locInput) return;

    if (!navigator.geolocation) {
        statusEl.textContent = "Geolocation is not supported by your browser. Please enter manually.";
        return;
    }

    // Immediately show loading state on the input
    locInput.placeholder = "Detecting your location…";
    locInput.disabled = true;
    statusEl.textContent = "Detecting your location, please allow access if prompted…";

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            locInput.disabled = false;
            locInput.placeholder = "Enter your location...";
            reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        },
        (err) => {
            locInput.disabled = false;
            locInput.placeholder = "Enter your location...";
            if (err.code === err.PERMISSION_DENIED) {
                statusEl.textContent = "Location access was denied. Please type your location.";
            } else {
                statusEl.textContent = "Could not detect location. Please type your location.";
            }
        },
        { timeout: 10000, enableHighAccuracy: false }
    );
}

// ── GPS location detection (manual Detect button) ─────────────────────
function detectLocation(silent = false) {
    const statusEl = document.getElementById("loc-status");
    const locInput = document.getElementById("loc-input");
    if (!statusEl || !locInput) return;

    if (!navigator.geolocation) {
        if (!silent) statusEl.textContent = "Geolocation not supported by your browser.";
        return;
    }

    if (!silent) {
        locInput.value = "";
        locInput.placeholder = "Detecting your location…";
        locInput.disabled = true;
        statusEl.textContent = "Detecting your location…";
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            if (!silent) {
                locInput.disabled = false;
                locInput.placeholder = "Enter your location...";
            }
            reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        },
        (err) => {
            if (!silent) {
                locInput.disabled = false;
                locInput.placeholder = "Enter your location...";
                statusEl.textContent = err.code === err.PERMISSION_DENIED
                    ? "Location access denied. Please type your location manually."
                    : "Could not detect location. Please type your location manually.";
            }
        },
        { timeout: 10000, enableHighAccuracy: false }
    );
}
window.detectLocation = detectLocation;

// ── Generate 30-min time slots (legacy) ───────────────────────────────
function generateTimeSlots() {
    const slots = [];
    for (let h = 7; h <= 20; h++) {
        for (let m = 0; m < 60; m += 30) {
            if (h === 20 && m > 0) break;
            const period = h < 12 ? "AM" : "PM";
            const displayH = h % 12 === 0 ? 12 : h % 12;
            const displayM = m === 0 ? "00" : "30";
            const label = `${displayH}:${displayM} ${period}`;
            const value = `${String(h).padStart(2, '0')}:${displayM}`;
            slots.push(`<option value="${value}">${label}</option>`);
        }
    }
    return slots.join("");
}

// ── GPS location detection ────────────────────────────────────────────


function reverseGeocode(lat, lng) {
    const statusEl = document.getElementById("loc-status");
    const locInput = document.getElementById("loc-input");

    // Use Google Geocoding API if Maps is loaded, else show coords
    if (window.google && window.google.maps) {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: { lat, lng } }, (results, status) => {
            if (status === "OK" && results[0]) {
                locInput.value = results[0].formatted_address;
                detectedLocation = results[0].formatted_address;
                updateLocationClearButtonVisibility();
                if (statusEl) statusEl.textContent = "Location detected";
            } else {
                locInput.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
                updateLocationClearButtonVisibility();
                if (statusEl) statusEl.textContent = "Coordinates detected";
            }
        });
    } else {
        // Fallback: open-source Nominatim reverse geocoding (no key required)
        fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=en`)
            .then(r => r.json())
            .then(data => {
                const addr = data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
                locInput.value = addr;
                detectedLocation = addr;
                updateLocationClearButtonVisibility();
                if (statusEl) statusEl.textContent = "Location detected";
            })
            .catch(() => {
                locInput.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
                updateLocationClearButtonVisibility();
                if (statusEl) statusEl.textContent = "Coordinates detected";
            });
    }
}

// ── Google Places Autocomplete ────────────────────────────────────────
function initLocationAutocomplete() {
    const locInput = document.getElementById("loc-input");
    const statusEl = document.getElementById("loc-status");
    if (!locInput) return;

    // If Maps API isn't ready yet, show manual guidance and exit.
    if (!window.google || !window.google.maps || !window.google.maps.places) {
        if (statusEl && !statusEl.textContent) {
            statusEl.textContent = "Type your location or use Detect.";
        }
        return;
    }

    // Avoid duplicate bindings when the schedule card is reopened.
    if (placesAutocomplete && placesAutocomplete.input === locInput) return;

    placesAutocomplete = new google.maps.places.Autocomplete(locInput, {
        fields: ["formatted_address", "name", "geometry"],
        types: ["geocode"],
    });
    placesAutocomplete.input = locInput;

    placesAutocomplete.addListener("place_changed", () => {
        const place = placesAutocomplete.getPlace();
        const fullAddress = place?.formatted_address || place?.name || locInput.value;
        locInput.value = fullAddress || "";
        detectedLocation = fullAddress || detectedLocation;
        updateLocationClearButtonVisibility();
        if (statusEl) statusEl.textContent = "Address selected";
        clearCardError("schedule-card");
    });
}

// Called by Google Maps script callback once API is loaded.
window.onGoogleMapsReady = function() {
    initLocationAutocomplete();
};

// ── Submit schedule ───────────────────────────────────────────────────
window.submitSchedule = function() {
    const loc = document.getElementById("loc-input")?.value.trim();
    const dateEl = document.getElementById("date-input");
    const timeEl = document.getElementById("time-input");
    const dateIso = dateEl?.dataset?.iso || "";
    const time24 = timeEl?.dataset?.value24 || "";

    if (!loc) { showCardError("schedule-card", "Please enter or detect your location."); return; }
    if (!dateIso) { showCardError("schedule-card", "Please select a date."); return; }
    if (!time24) { showCardError("schedule-card", "Please select a time."); return; }

    // ── Real-time validation ──
    const now = new Date();
    const todayIso = formatIsoDate(now);
    if (dateIso === todayIso) {
        const [h, m] = time24.split(":").map(Number);
        const slotMinutes = (h * 60) + m;
        const nowMinutes = (now.getHours() * 60) + now.getMinutes();
        const minLeadMinutes = 30;
        if (slotMinutes < nowMinutes + minLeadMinutes) {
            showCardError("schedule-card", "The selected time just became unavailable. Please select a later time.");
            timeEl.value = "";
            delete timeEl.dataset.value24;
            return;
        }
    }

    bookingState.location = loc;
    bookingState.date = dateIso;
    bookingState.time = time24;
    bookingState.step = 2;

    // Remove card, send summary as user message
    removeAllChips();
    const formattedDate = new Date(dateIso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const formattedTime = formatTime(time24);
    appendMessage(`${loc}\n${formattedDate} at ${formattedTime}`, "user");

    // If user is rescheduling an existing booking
    if (bookingState.reschedulingBookingId) {
        handleRescheduleSubmit();
        return;
    }

    // If user is editing only schedule from review, return to review directly.
    if (bookingState.editingFromReviewTarget === "schedule") {
        bookingState.editingFromReviewTarget = null;
        setTimeout(() => {
            appendBotMessage("Updated your schedule. Please review once again.");
            setTimeout(() => renderReviewBookingCard(), 300);
        }, 300);
        return;
    }

    setTimeout(() => {
        appendBotMessage("Perfect! Last step — just need your contact details.");
        setTimeout(() => renderContactCard(), 600);
    }, 400);
};

// ── Step 3 — Contact Card ─────────────────────────────────────────────
function renderContactCard() {
    updateProgress(3);
    const card = document.createElement("div");
    card.className = "booking-card chips-container fade-in";
    card.id = "contact-card";
    card.innerHTML = `
        <div class="booking-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Your Contact Details
        </div>

        <label class="booking-label">Full Name <span class="booking-required">*</span></label>
        <input type="text" id="c-name" class="booking-input" placeholder="Your Full Name" autocomplete="name">

        <label class="booking-label">Phone Number <span class="booking-required">*</span></label>
        <input type="tel" id="c-phone" class="booking-input" placeholder="+91 98765 43210" autocomplete="tel">

        <label class="booking-label">Email Address</label>
        <input type="email" id="c-email" class="booking-input" placeholder="you@example.com (optional)" autocomplete="email">
        <p class="email-hint">Tip: Using Gmail lets us sync your booking to Google Calendar.</p>

        <label class="booking-label" id="rel-label">Relation to Patient <span class="booking-required">*</span></label>
        <select id="c-relation" class="booking-input">
            <option value="">Select relation…</option>
            <option value="wife">Wife</option>
            <option value="family">Family Member</option>
            <option value="other">Other</option>
        </select>

        <label class="self-check-label">
            <input type="checkbox" id="c-self" onchange="toggleSelfBooking(this)">
            <span>Booking for myself</span>
        </label>

        <button onclick="submitContact()" class="booking-btn">Confirm Booking</button>
    `;
    messagesContainer.appendChild(card);
    const nameEl = document.getElementById("c-name");
    const phoneEl = document.getElementById("c-phone");
    const emailEl = document.getElementById("c-email");
    const relationEl = document.getElementById("c-relation");
    const selfEl = document.getElementById("c-self");
    if (nameEl) nameEl.value = bookingState.name || "";
    if (phoneEl) phoneEl.value = bookingState.phone || "";
    if (emailEl) emailEl.value = bookingState.email || "";
    if (relationEl) relationEl.value = bookingState.relation || "";
    if (selfEl && bookingState.forSelf) {
        selfEl.checked = true;
        window.toggleSelfBooking(selfEl);
    }
    scrollToBottomIfNearBottom();
}

window.toggleSelfBooking = function(checkbox) {
    const relLabel = document.getElementById("rel-label");
    const relSelect = document.getElementById("c-relation");
    if (checkbox.checked) {
        relLabel.style.display = "none";
        relSelect.style.display = "none";
        relSelect.value = "self";
    } else {
        relLabel.style.display = "";
        relSelect.style.display = "";
        relSelect.value = "";
    }
};

// ── Submit contact & Ask for Description ──────────────────────────────
window.submitContact = async function() {
    const name    = document.getElementById("c-name")?.value.trim();
    const phoneRaw = document.getElementById("c-phone")?.value.trim();
    const email   = document.getElementById("c-email")?.value.trim();
    const self_   = document.getElementById("c-self")?.checked;
    const relation= self_ ? "self" : document.getElementById("c-relation")?.value;
    const phoneDigits = (phoneRaw || "").replace(/\D/g, "");
    const phoneLocal = phoneDigits.length === 12 && phoneDigits.startsWith("91")
        ? phoneDigits.slice(2)
        : phoneDigits;

    if (!name)   { showCardError("contact-card", "Please enter your Full Name."); return; }
    if (/\d/.test(name)) {
        showCardError("contact-card", "Full name should not contain numbers.");
        return;
    }
    if (phoneLocal.length !== 10) {
        showCardError("contact-card", "Please enter a valid 10-digit phone number carefully."); return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showCardError("contact-card", "Please enter a valid email address."); return;
    }
    if (!relation) { showCardError("contact-card", "Please select your relation to the patient."); return; }

    bookingState = { ...bookingState, name, phone: phoneLocal, email, relation, forSelf: self_, step: 3 };

    removeAllChips();
    appendMessage(`${name} | ${phoneLocal} | ${email}`, "user");

    // If user is editing only contact details from review, return to review directly.
    if (bookingState.editingFromReviewTarget === "contact") {
        bookingState.editingFromReviewTarget = null;
        setTimeout(() => {
            appendBotMessage("Updated your contact details. Please review once again.");
            setTimeout(() => renderReviewBookingCard(), 300);
        }, 300);
        return;
    }

    // Ask for description to complete the booking (question varies by service)
    bookingState.awaitingDescription = true;
    
    setTimeout(async () => {
        const prompt = getDescriptionPromptForService(bookingState.service);
        await appendBotMessage(prompt);
        setInputEnabled(true);
        setTimeout(() => maybeFocusElement(userInput), 100);
    }, 400);
};

/**
 * Returns the "describe your situation" prompt tailored to the booked service.
 */
function getDescriptionPromptForService(service) {
    const svc = (service || "").toLowerCase();
    const tip = "\nTip: Type or use the mic.";
    if (svc.includes("doula")) {
        return "Tell us your needs so we can match you with the right doula.\nInclude: support type, concerns, and pregnancy stage." + tip;
    }
    if (svc.includes("nanny")) {
        return "Tell us your childcare needs so we can match you with the right nanny.\nInclude: care timing, child routine, and special requirements." + tip;
    }
    if (svc.includes("lactation")) {
        return "Tell us your feeding needs so we can match you with the right support.\nInclude: feeding challenge, baby's age, and concerns." + tip;
    }
    if (svc.includes("doctor") || svc.includes("consultation")) {
        return "Tell us why you need this consultation.\nInclude: main symptom, duration, and relevant history." + tip;
    }
    return "Tell us your needs so we can help.\nInclude: reason for booking and any concerns." + tip;
}

/**
 * Lightweight local check before LLM validation.
 * Keep this permissive so the backend LLM can respond naturally in context.
 * @returns {{ valid: boolean, message?: string }}
 */
function validateBookingDescription(text) {
    const trimmed = (text || "").trim();

    if (!trimmed) {
        return {
            valid: false,
            message: "Tell us your needs so we can help.\nInclude: reason for booking and any concerns.\nTip: Type or use the mic.",
        };
    }

    // Non-empty input should go to backend LLM for contextual handling.
    return { valid: true };
}

// ── Review booking (confirm before submit) ────────────────────────────
function renderReviewBookingCard() {
    const date = bookingState.date;
    const formattedDate = date
        ? new Date(date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
        : "—";
    const formattedTime = bookingState.time ? formatTime(bookingState.time) : "—";
    const serviceLabel = formatServiceForDisplay(bookingState.service);

    const card = document.createElement("div");
    card.className = "booking-card confirmation-card fade-in";
    card.id = "review-booking-card";
    card.innerHTML = `
        <div class="booking-card-title" style="margin-bottom:12px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            Is everything correct?
        </div>
        <p style="font-size:10.5px;color:#6B7280;margin-bottom:16px;">Please review your booking details before confirming.</p>
        <div class="confirm-grid" style="margin-bottom:20px;">
            <div class="confirm-row">
                <span class="confirm-key">Name</span>
                <span class="confirm-val">${bookingState.name || "—"}</span>
            </div>
            <div class="confirm-row">
                <span class="confirm-key">Service</span>
                <span class="confirm-val">${serviceLabel}</span>
            </div>
            ${(bookingState.service || "").toLowerCase().includes("nanny") && bookingState.childAgeRange ? `
            <div class="confirm-row">
                <span class="confirm-key">Child age</span>
                <span class="confirm-val">${formatChildAgeLabel(bookingState.childAgeRange) || "—"}</span>
            </div>
            ` : ""}
            <div class="confirm-row confirm-row--full">
                <span class="confirm-key">Location</span>
                <span class="confirm-val">${bookingState.location || "—"}</span>
            </div>
            <div class="confirm-row">
                <span class="confirm-key">Date & time</span>
                <span class="confirm-val">${formattedDate}, ${formattedTime}</span>
            </div>
            <div class="confirm-row confirm-row--last">
                <span class="confirm-key">Contact</span>
                <span class="confirm-val">${bookingState.phone || "—"}${bookingState.email ? " · " + bookingState.email : ""}</span>
            </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
            <button type="button" onclick="confirmBookingSubmit()" class="booking-btn">Yes, confirm booking</button>
            <button type="button" onclick="needToChangeBooking()" class="booking-btn" style="background:#F3F4F6;color:#1F2937;box-shadow:none;">Need to change</button>
        </div>
    `;
    messagesContainer.appendChild(card);
    scrollToRevealMessage(card);
}

window.confirmBookingSubmit = function () {
    const card = document.getElementById("review-booking-card");
    if (card) card.remove();
    finalizeBooking();
};

window.needToChangeBooking = function () {
    const card = document.getElementById("review-booking-card");
    if (card) card.remove();
    appendBotMessage("What would you like to change?");
    const row = document.createElement("div");
    row.className = "options-container chips-container";
    row.id = "review-change-options";
    [
        { label: "Schedule (Date, Time, Location)", value: "schedule" },
        { label: "Contact Details", value: "contact" },
        { label: "Description", value: "description" },
    ].forEach(({ label, value }) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "option-btn option-btn--review-change fade-in";
        btn.textContent = label;
        btn.addEventListener("click", () => {
            document.getElementById("review-change-options")?.remove();
            if (value === "schedule") {
                bookingState.editingFromReviewTarget = "schedule";
                renderScheduleCard();
            }
            else if (value === "contact") {
                bookingState.editingFromReviewTarget = "contact";
                renderContactCard();
            }
            else {
                bookingState.editingFromReviewTarget = "description";
                bookingState.awaitingDescription = true;
                appendBotMessage(getDescriptionPromptForService(bookingState.service));
                setInputEnabled(true);
            }
        });
        row.appendChild(btn);
    });
    messagesContainer.appendChild(row);
    scrollToShowOptions(row);
};

// ── Finalize Booking after Description ────────────────────────────────
async function finalizeBooking() {
    showTyping(true);
    latestBooking = null; // reset before new booking

    // Structured booking data object matching the DB schema
    const bookingData = {
        name:             bookingState.name,
        phone:            bookingState.phone,
        email:            bookingState.email || null,
        description:      bookingState.description || null,
        service_provider: formatServiceForDisplay(bookingState.service),
        relationship:     bookingState.relation || 'self',
        date:             bookingState.date,
        time:             bookingState.time,
        location:         bookingState.location || null,
        payment_status:   'pending',
    };

    try {
        const bookingResp = await apiFetch(NODE_API_BASE, "/api/book", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bookingData),
        });

        const result = await bookingResp.json();
        showTyping(false);

        if (bookingResp.ok) {
            // ✅ Store full backend response for UI use
            latestBooking = result.booking;
            const bookingId = result.bookingId;
            console.log("Real Booking ID:", bookingId);
            renderConfirmation({
                bookingId:      bookingId,
                payment_status: result.booking?.payment_status || 'pending',
            });
        } else {
            // ❌ API returned an error status (400/500)
            console.error("Booking API error:", { url: makeApiUrl(NODE_API_BASE, "/api/book"), error: result.error, result });
            showTyping(false);
            appendBotMessage("❌ Booking failed. Please try again or contact support.");
        }
    } catch (err) {
        const apiName = "Node.js (5000)";
        console.error(`[Booking] ${apiName} fetch failed:`, { url: makeApiUrl(NODE_API_BASE, "/api/book"), error: err });
        showTyping(false);
        appendBotMessage(`❌ Could not reach the ${apiName} server. Please ensure it is running and try again.`);
    }

    setInputEnabled(true);
}

// ── Step 4 — Confirmation screen ──────────────────────────────────────
// Uses latestBooking (from backend) when available, falls back to bookingState
function renderConfirmation(booking) {
    updateProgress(4);

    // Prefer backend data; fall back to local bookingState
    const b = latestBooking || {};
    const displayId      = booking.bookingId || b.booking_id || "—";
    const displayName    = b.name             || bookingState.name     || "—";
    const displayService = formatServiceForDisplay(b.service_provider  || bookingState.service);
    const displayLoc     = b.location         || bookingState.location || "—";
    const displayPayment = b.payment_status   || booking.payment_status || "Pending";

    // Date + time: prefer backend ISO strings, fall back to bookingState
    const rawDate = b.date || bookingState.date || "";
    const rawTime = b.time || bookingState.time || "";
    const formattedDate = rawDate
        ? new Date(rawDate.split('T')[0] + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        : "—";
    const formattedTime = rawTime ? formatTime(rawTime) : "—";

    chatHistory.push({ role: "assistant", content: "Booking confirmed: " + displayId });

    const card = document.createElement("div");
    card.className = "confirmation-card fade-in";
    card.innerHTML = `
        <div class="confirm-header">
            <div class="confirm-check">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div>
                <div class="confirm-title">Booking Confirmed</div>
                <div class="confirm-id">Booking ID: <strong>${displayId}</strong></div>
            </div>
        </div>

        <div class="confirm-grid">
            <div class="confirm-row">
                <span class="confirm-key">Name</span>
                <span class="confirm-val">${displayName}</span>
            </div>
            <div class="confirm-row">
                <span class="confirm-key">Service</span>
                <span class="confirm-val">${displayService}</span>
            </div>
            ${(bookingState.service || "").toLowerCase().includes("nanny") && bookingState.childAgeRange ? `
            <div class="confirm-row">
                <span class="confirm-key">Child age</span>
                <span class="confirm-val">${formatChildAgeLabel(bookingState.childAgeRange) || "—"}</span>
            </div>
            ` : ""}
            <div class="confirm-row confirm-row--full">
                <span class="confirm-key">Location</span>
                <span class="confirm-val">${displayLoc}</span>
            </div>
            <div class="confirm-row">
                <span class="confirm-key">Date &amp; time</span>
                <span class="confirm-val">${formattedDate}, ${formattedTime}</span>
            </div>
            <div class="confirm-row">
                <span class="confirm-key">Payment status</span>
                <span class="confirm-val" style="text-transform:capitalize;">${displayPayment}</span>
            </div>
            <div class="confirm-row confirm-row--last">
                <span class="confirm-key">Provider</span>
                <span class="confirm-val">Will be assigned shortly</span>
            </div>
        </div>

        <div class="confirm-next">
            <div class="confirm-next-title">What happens next?</div>
            <ul class="confirm-next-list">
                <li>A specialist will be assigned to your booking shortly.</li>
                <li>Confirmation will be sent via <strong>SMS</strong> and <strong>email</strong>.</li>
                <li>Our support team may reach out if additional details are needed.</li>
            </ul>
        </div>

        <p style="text-align:center;margin-top:16px;font-size:13px;color:#9CA3AF;">Thank you for choosing Motherly</p>
        <button onclick="resetChat()" class="booking-btn booking-btn--restart" style="margin-top:12px;background:#FAF5F5;color:#1F2937;border:1px solid #D1D5DB;box-shadow:none;">Start New Booking</button>
    `;
    messagesContainer.appendChild(card);
    scrollToBottomIfNearBottom();
}

// ── Fallback local booking ID ─────────────────────────────────────────
function generateLocalId() {
    return "MTH-" + Math.floor(100000 + Math.random() * 900000);
}

// ── Render bot messages and suggestion chips ──────────────────────────
async function appendBotMessage(text) {
    await appendMessage(text, "bot");
}

async function appendMessage(text, sender, isWelcome = false) {
    let displayText = text;
    let options = [];

    if (sender === "bot") {
        const parsed = parseOptionsFromText(text);
        displayText = parsed.body || text;
        options = parsed.options;
        
        // Auto-stop microphone when bot starts speaking/typing to prevent feedback echo
        if (typeof stopVoiceInput === "function") stopVoiceInput();
        if (userInput) userInput.value = "";
    }

    if (sender === "bot") {
        // Welcome message only: 1s typing then streaming. All other bot messages: short typing then full message.
        showTyping(true);
        setMeenaTyping(true);
        if (isWelcome) {
            await new Promise(r => setTimeout(r, 1000));
        } else {
            await new Promise(r => setTimeout(r, 400));
        }
        showTyping(false);
        setMeenaTyping(false);
    }

    const row = document.createElement("div");
    row.className = `message ${sender === "bot" ? "bot-message" : "user-message"}`;

    const avatarHtml = sender === "bot"
        ? `<div class="message-avatar-box" style="background:#fff;border:1px solid #E5E7EB;overflow:hidden;"><img src="/static/motherly_logo_v3.png" style="width:100%;height:100%;object-fit:cover;padding:0;"></div>`
        : ``;

    row.innerHTML = `${avatarHtml}<div class="message-bubble"><p></p></div>`;
    const bubbleContent = row.querySelector(".message-bubble p");

    if (sender === "bot") {
        const previousScroll = messagesContainer.scrollTop;
        messagesContainer.appendChild(row);
        messagesContainer.scrollTop = previousScroll;

        if (isWelcome) {
            // Welcome: character-by-character streaming (floating effect)
            await renderStreamingMessage(displayText, bubbleContent, previousScroll);
        } else {
            // Normal: show full message at once (bot loads and provides response)
            bubbleContent.innerHTML = formatMessageContent(displayText);
        }

        let optionsRow = null;
        if (options.length > 0) {
            optionsRow = document.createElement("div");
            optionsRow.className = "options-container chips-container";
            options.forEach(optText => optionsRow.appendChild(createChip(optText, false)));
            messagesContainer.appendChild(optionsRow);
        }
        if (optionsRow) scrollToShowOptions(optionsRow);
        else scrollToRevealMessage(row);
    } else {
        messagesContainer.appendChild(row);
        bubbleContent.innerHTML = formatMessageContent(displayText);

        let optionsRow = null;
        if (options.length > 0) {
            optionsRow = document.createElement("div");
            optionsRow.className = "options-container chips-container";
            options.forEach(optText => optionsRow.appendChild(createChip(optText, false)));
            messagesContainer.appendChild(optionsRow);
        }
        if (optionsRow) scrollToShowOptions(optionsRow);
        else scrollToRevealMessage(row);
    }
    saveSessionSnapshot();
}

/**
 * Format bot/user message text: bold, italic, line breaks. Safe for innerHTML.
 */
function formatMessageContent(text) {
    if (!text) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/^#{1,3}\s+(.*)$/gim, "<strong>$1</strong>")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" style="color:#9B1A52;font-weight:600;text-decoration:underline;">$1</a>')
        .replace(/\n/g, "<br>");
}

/**
 * Streaming formatter: never shows ** or * markers — bold/italic appear seamlessly as text streams.
 * Handles partial **... so the user never sees raw markdown.
 */
function formatMessageContentStreaming(text) {
    if (!text) return "";
    const s = String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    let out = "";
    let i = 0;
    let inBold = false;
    let inItalic = false;
    while (i < s.length) {
        if (s.substr(i, 2) === "**") {
            if (inItalic) { out += "</em>"; inItalic = false; }
            out += inBold ? "</strong>" : "<strong>";
            inBold = !inBold;
            i += 2;
        } else if (!inBold && s[i] === "*" && s[i + 1] !== "*") {
            out += inItalic ? "</em>" : "<em>";
            inItalic = !inItalic;
            i += 1;
        } else {
            if (s[i] === "\n") out += "<br>";
            else out += s[i];
            i += 1;
        }
    }
    if (inBold) out += "</strong>";
    if (inItalic) out += "</em>";
    return out;
}

/**
 * Streaming Text Utility
 * Renders text character-by-character with a typing effect.
 * Uses streaming formatter so ** and * never show — bold/italic appear seamlessly.
 * When preserveScroll is set, restores scrollTop after each update so the chat does not move.
 */
async function renderStreamingMessage(text, container, preserveScroll) {
    const chars = Array.from(String(text || ""));
    let currentText = "";
    const msPerChar = 14;
    const msVariance = 6;

    for (let i = 0; i < chars.length; i++) {
        currentText += chars[i];
        container.innerHTML = formatMessageContentStreaming(currentText);
        if (preserveScroll != null && messagesContainer) {
            messagesContainer.scrollTop = preserveScroll;
        }
        const delay = Math.max(8, msPerChar + (Math.random() * 2 - 1) * msVariance);
        await new Promise(r => setTimeout(r, delay));
    }
}

function setMeenaTyping(active) {
    const headerTitle = document.querySelector(".header-title");
    const headerSubtitle = document.getElementById("step-label");
    if (!headerTitle || !headerSubtitle) return;

    if (active) {
        headerSubtitle.dataset.oldText = headerSubtitle.textContent;
        headerSubtitle.textContent = "Mothrly Assistant is typing...";
        headerSubtitle.style.color = "#9B1A52";
        headerSubtitle.style.fontWeight = "600";
    } else {
        headerSubtitle.textContent = headerSubtitle.dataset.oldText || DEFAULT_STEP_SUBTITLE;
        headerSubtitle.style.color = "";
        headerSubtitle.style.fontWeight = "";
    }
}

// ── Parse option chips from bot text ─────────────────────────────────
function parseOptionsFromText(text) {
    const lines = text.split("\n");
    const optionLines = [];
    const bodyLines = [];
    let inOptionsSection = false;

    for (const line of lines) {
        const trimmed = line.trim();
        const lowerTrimmed = trimmed.toLowerCase();
        const numberedRegex = /^(\d+\.|[•\-\*])\s*(.+)$/;
        const match = trimmed.match(numberedRegex);

        if (lowerTrimmed.startsWith("options:") || lowerTrimmed.startsWith("quick booking:") || lowerTrimmed.startsWith("suggestion buttons:")) {
            inOptionsSection = true;
            continue;
        }

        if (inOptionsSection && match) {
            let cleanText = match[2].replace(/\*\*/g, "").trim();
            optionLines.push(cleanText);
        } else if (!inOptionsSection) {
            bodyLines.push(line);
        }
    }

    return { body: bodyLines.join("\n").trim(), options: optionLines };
}

// ── UI helpers ────────────────────────────────────────────────────────
function createChip(label, allowIcon = false) {
    const btn = document.createElement("button");
    btn.className = "option-btn fade-in";
    const icon = allowIcon ? getIconForLabel(label) : "";
    const displayLabel = sentenceCaps(label);
    if (icon) {
        btn.innerHTML = `<span class="btn-icon">${icon}</span> ${displayLabel}`;
    } else {
        btn.textContent = displayLabel;
    }
    btn.addEventListener("click", () => sendMessage(label));
    return btn;
}

function removeAllChips() {
    document.querySelectorAll(".chips-container").forEach(el => el.remove());
    const quickActionsBar = document.getElementById("quick-actions-bar");
    if (quickActionsBar) {
        quickActionsBar.innerHTML = "";
        quickActionsBar.classList.remove("quick-actions-bar--visible");
    }
}

function showTyping(visible) {
    typingIndicator.style.display = visible ? "flex" : "none";
    
    // Disable mic button while bot is typing to prevent accidental voice input/echoes
    if (micBtn) {
        micBtn.disabled = visible;
        micBtn.style.opacity = visible ? "0.5" : "1";
        micBtn.style.pointerEvents = visible ? "none" : "auto";
    }
}

function setInputEnabled(enabled) {
    userInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
}

const SCROLL_NEAR_BOTTOM_THRESHOLD = 80;
const SCROLL_REVEAL_PADDING = 24;

/**
 * When options/cards are shown, scroll so the full options block is visible (user sees all options).
 * Waits for layout then sets scroll so the bottom of the options is in view.
 */
function scrollToShowOptions(optionsElement) {
    if (!optionsElement || !messagesContainer) return;

    const doScroll = () => {
        const maxScroll = messagesContainer.scrollHeight - messagesContainer.clientHeight;
        const scrollTo = optionsElement.offsetTop + optionsElement.offsetHeight - messagesContainer.clientHeight + SCROLL_REVEAL_PADDING;
        messagesContainer.scrollTop = Math.max(0, Math.min(maxScroll, scrollTo));
    };

    // ASAP: sync scroll (fastest), then smooth nudge after layout settles
    doScroll();

    requestAnimationFrame(() => {
        doScroll();
        // Final nudge after fonts/images/layout: helps mobile where heights finalize late
        setTimeout(() => {
            doScroll();
        }, 80);
    });
}

/**
 * Scroll so the full message block is visible. Waits for layout then scrolls the minimum amount needed.
 */
function scrollToRevealMessage(element) {
    if (!element || !messagesContainer) return;
    // Wait for layout (options grid, etc.) to complete before measuring
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const messageRect = element.getBoundingClientRect();
            const containerRect = messagesContainer.getBoundingClientRect();
            if (messageRect.bottom > containerRect.bottom) {
                const scrollDelta = messageRect.bottom - containerRect.bottom + SCROLL_REVEAL_PADDING;
                messagesContainer.scrollBy({ top: scrollDelta, behavior: "smooth" });
            }
        });
    });
}

/**
 * Scroll to bottom only if the user is already near the bottom (e.g. they just sent a message).
 * If the user has scrolled up to read, do not move the view.
 */
function scrollToBottomIfNearBottom() {
    if (!messagesContainer) return;
    requestAnimationFrame(() => {
        const { scrollHeight, scrollTop, clientHeight } = messagesContainer;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < SCROLL_NEAR_BOTTOM_THRESHOLD;
        if (isNearBottom) {
            messagesContainer.scrollTop = scrollHeight;
        }
    });
}

function clearCardError(cardId) {
    const card = document.getElementById(cardId);
    if (card) card.querySelector(".card-error")?.remove();
}

function showCardError(cardId, msg) {
    const card = document.getElementById(cardId);
    if (!card) return;
    let err = card.querySelector(".card-error");
    if (!err) {
        err = document.createElement("p");
        err.className = "card-error";
        card.insertBefore(err, card.querySelector(".booking-btn"));
    }
    const warnSvg = '<svg class="card-error-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    err.innerHTML = warnSvg + '<span class="card-error-text"></span>';
    err.querySelector(".card-error-text").textContent = msg;
    err.style.cssText = "color:#9B1A52;font-size:13px;margin:4px 0 8px;font-weight:500;display:flex;align-items:flex-start;gap:6px;";
    setTimeout(() => err && err.remove(), 4000);
}

function formatTime(value) {
    const [h, m] = value.split(':').map(Number);
    const period = h < 12 ? 'AM' : 'PM';
    const displayH = h % 12 === 0 ? 12 : h % 12;
    return `${displayH}:${String(m).padStart(2,'0')} ${period}`;
}

function formatChildAgeLabel(value) {
    if (!value) return "";
    const labels = { "0-1": "0 – 1 year (infant)", "1-3": "1 – 3 years (toddler)", "3+": "3 years & above" };
    return labels[value] || value;
}

// ── Icon map ──────────────────────────────────────────────────────────
function getIconForLabel(label) {
    const text = label.toLowerCase();
    // Contact / support
    if (text.includes("contact") || text.includes("support") || text.includes("help")) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.19 19a19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.08 4.18 2 2 0 0 1 4.05 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.77.63 2.6a2 2 0 0 1-.45 2.11l-1.1 1.1a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.11-.45c.83.3 1.7.51 2.6.63A2 2 0 0 1 22 16.92z"/></svg>`;
    }

    // About
    if (text.includes("about") || text.includes("motherly")) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    }

    // Prenatal nutrition
    if (text.includes("nutrition") || text.includes("diet")) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>`;
    }

    // Doctor consultation
    if (text.includes("doctor") || text.includes("physician") || text.includes("consultation") || text.includes("speak")) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 8V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v2"/><path d="M7 8h10"/><path d="M9 20h6"/><path d="M12 8v12"/><path d="M9 11h6"/></svg>`;
    }

    // Lactation consultant
    if (text.includes("lactation") || text.includes("breastfeed")) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c4-4 8-7.5 8-12a8 8 0 0 0-16 0c0 4.5 4 8 8 12z"/></svg>`;
    }

    // Doula
    if (text.includes("doula")) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/><path d="M8.5 12.2c1.2 1.4 2.5 2.1 3.5 2.1s2.3-.7 3.5-2.1"/></svg>`;
    }

    // Nanny
    if (text.includes("nanny") || text.includes("childcare") || text.includes("baby")) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3"/><path d="M7 21v-2a5 5 0 0 1 10 0v2"/><path d="M5.5 12.5c.9-1.6 2.6-2.7 4.5-2.9"/><path d="M18.5 12.5c-.9-1.6-2.6-2.7-4.5-2.9"/></svg>`;
    }

    // Pregnancy / generic care (fallback icon for other pregnancy-related chips)
    if (text.includes("pregnan") || text.includes("prenatal") || text.includes("pregnancy")) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 1 0 0 8a4 4 0 0 0 0-8z"/><path d="M8 22v-3a4 4 0 0 1 8 0v3"/><path d="M9.5 12c.7 1.2 1.6 2 2.5 2s1.8-.8 2.5-2"/></svg>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9B1A52" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>`;
}

// ── Voice Input (Web Speech API) ──────────────────────────────────────
function toggleVoiceInput() {
    if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) {
        showToast("Voice input is not supported in this browser. Try Chrome or Edge.");
        return;
    }

    if (isRecording) {
        stopVoiceInput();
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = 'en-IN';
    speechRecognition.interimResults = true;
    speechRecognition.maxAlternatives = 1;
    speechRecognition.continuous = false;

    speechRecognition.onstart = () => {
        isRecording = true;
        setInputEnabled(false); // Locked during active recording
        micBtn.classList.add("recording");
        micBtn.title = "Stop recording";
        showToast("Listening… speak now");
    };

    speechRecognition.onresult = (event) => {
        const transcript = Array.from(event.results)
            .map(r => r[0].transcript)
            .join('');
        userInput.value = transcript;
        if (event.results[event.results.length - 1].isFinal) {
            stopVoiceInput();
            // Let the user review/edit the transcript and tap Send manually
            setTimeout(() => {
                setInputEnabled(true);
                maybeFocusElement(userInput);
                showToast("Review your message, then tap Send");
            }, 100);
        }
    };

    speechRecognition.onerror = (e) => {
        stopVoiceInput();
        let msg = "Voice error: " + e.error;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            if (!window.isSecureContext) {
                msg = "Chromium blocks Voice on HTTP. To fix: Go to chrome://flags/#unsafely-treat-insecure-origin-as-secure, add this IP, and Relaunch.";
            } else {
                msg = "Microphone access denied. Please allow it in settings.";
            }
        } else if (e.error === 'no-speech') {
            msg = "No speech detected. Try again.";
        }
        if (e.error !== 'aborted') {
            // Use longer timeout for the developer-fix message
            showToast(msg, (msg.includes("chrome://flags") ? 10000 : 3000));
        }
    };

    speechRecognition.onend = () => {
        // Only cleanup UI if we weren't already stopped
        if (isRecording) stopVoiceInput();
    };

    try {
        speechRecognition.start();
    } catch (err) {
        console.error("STT Start Error:", err);
        stopVoiceInput();
        showToast("Speech service failed to start.");
    }
}

function stopVoiceInput() {
    isRecording = false;
    if (micBtn) {
        micBtn.classList.remove("recording");
        micBtn.title = "Voice input";
    }
    if (speechRecognition) {
        try { speechRecognition.abort(); } catch {}
        speechRecognition = null;
    }
    // Crucial: ALWAYS re-enable UI after voice phase ends
    setInputEnabled(true);
}

function showToast(msg, duration = 3000) {
    let toast = document.getElementById("voice-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "voice-toast";
        toast.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1F2937;color:#fff;padding:12px 20px;border-radius:12px;font-size:13px;z-index:9999;opacity:0;transition:opacity 0.3s;pointer-events:none;max-width:320px;text-align:center;line-height:1.4;`;
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = "1";
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = "0"; }, duration);
}

// ── Secure Context & Permissions ─────────────────────────────────────
function showSecureContextWarning() {
    // Avoid double banners
    if (document.querySelector(".secure-context-banner")) return;
    
    const banner = document.createElement("div");
    banner.className = "secure-context-banner";
    banner.style.cssText = "background:#FEF2F2; color:#991B1B; padding:12px; font-size:11px; border-bottom:1px solid #FEE2E2; display:flex; gap:8px; line-height:1.3;";
    banner.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <div>
            <b>Secure Context Missing (HTTP):</b> Voice input is blocked on insecure connections. To enable it on this IP, see the instructions in the "Connect Now" card or use <b>chrome://flags</b>.
        </div>
    `;
    const container = document.getElementById("chat-panel");
    if (container) container.prepend(banner);
}

function renderPermissionRequestCard() {
    const isSecure = window.isSecureContext;
    const card = document.createElement("div");
    card.className = "permission-card fade-in";
    
    let insecureNotice = "";
    if (!isSecure) {
        insecureNotice = `
            <div style="margin-top:10px; padding:10px; background:#FFF7ED; border:1px solid #FED7AA; border-radius:8px; font-size:11px; color:#9A3412;">
                <strong>Developer Fix (for HTTP/Mobile):</strong><br/>
                1. Open: <code style="background:#fff;padding:2px 4px;border-radius:4px;">chrome://flags/#unsafely-treat-insecure-origin-as-secure</code><br/>
                2. Add: <code style="background:#fff;padding:2px 4px;border-radius:4px;">${window.location.origin}</code><br/>
                3. Set to <strong>Enabled</strong> & <strong>Relaunch</strong>.
            </div>
        `;
    }

    card.innerHTML = `
        <div class="permission-card__title">Enable Location & Voice</div>
        <div class="permission-card__text">
            To provide the best support, we need access to your location and microphone.
            ${insecureNotice}
        </div>
        <button class="permission-card__btn">${isSecure ? 'Connect Now' : 'I have enabled flags'}</button>
    `;
    
    const btn = card.querySelector(".permission-card__btn");
    btn.onclick = () => {
        triggerPermissionPrompts();
        if (isSecure) {
            card.style.opacity = "0";
            setTimeout(() => card.remove(), 400);
        } else {
            showToast("Checking permissions… if still blocked, ensure flags are set.");
        }
    };

    messagesContainer.appendChild(card);
    scrollToRevealMessage(card);
}

async function triggerPermissionPrompts() {
    showToast("Requesting permissions…");
    
    // 1. Geolocation
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(() => {
            prefetchLocation(); // Refresh now that we have permission
        }, (err) => {
            console.warn("Location permission denied or failed:", err);
        });
    }

    // 2. Microphone (Dummy trigger via Speech API)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        try {
            const dummyRec = new SpeechRecognition();
            dummyRec.onstart = () => {
                setTimeout(() => {
                    try { dummyRec.abort(); } catch {}
                }, 100);
            };
            dummyRec.start();
        } catch (err) {
            console.warn("STT Permission trigger failed:", err);
        }
    }
}

// ── Mobile/Tablet Platform Detection ──────────────────────────────────
function isMobileOrTablet() {
    const ua = navigator.userAgent;
    const isMobileString = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    const isSmallScreen = window.innerWidth <= 1024;
    return isMobileString || isSmallScreen;
}

// ── Circular Native/System Time Picker for Mobile ────────────────────
function openMdTimePicker(timeInputEl) {
    let native = document.getElementById("native-time-input");
    if (!native) {
        native = document.createElement("input");
        native.type = "time";
        native.id = "native-time-input";
        native.setAttribute("aria-hidden", "true");
        // Position over the time input so the browser considers it user-activated
        native.style.cssText = "position:fixed;top:50%;left:50%;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;";
        document.body.appendChild(native);
    }
    
    native.onchange = () => {
        const hhmm = native.value; // "HH:mm"
        if (hhmm) {
            const [h, m] = hhmm.split(":").map(Number);
            const period = h >= 12 ? "PM" : "AM";
            const displayH = h % 12 || 12;
            const label = `${displayH}:${String(m).padStart(2, '0')} ${period}`;
            
            // ── Mobile validation ──
            const dateEl = document.getElementById("date-input");
            const dateIso = dateEl?.dataset?.iso || "";
            const now = new Date();
            const todayIso = formatIsoDate(now);
            if (dateIso === todayIso) {
                const slotMinutes = (h * 60) + m;
                const nowMinutes = (now.getHours() * 60) + now.getMinutes();
                if (slotMinutes < nowMinutes + 30) {
                    showCardError("schedule-card", "Please select a future time (at least 30 mins from now).");
                    native.value = "";
                    return;
                }
            }

            timeInputEl.dataset.value24 = hhmm;
            timeInputEl.value = label;
            
            clearCardError("schedule-card");
            timeInputEl.dispatchEvent(new Event('input', { bubbles: true }));
            timeInputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
    };
    
    // Set current value if it exists
    if (timeInputEl.dataset.value24) {
        native.value = timeInputEl.dataset.value24;
    }

    // Focus first, then trigger picker in the next frame — this ensures
    // the browser sees it as a direct user gesture continuation
    native.focus({ preventScroll: true });
    requestAnimationFrame(() => {
        if (typeof native.showPicker === 'function') {
            try {
                native.showPicker();
                return;
            } catch (_) { /* fall through */ }
        }
        // Fallback: simulate a click
        native.click();
    });
}

// ── Booking History & Management ─────────────────────────────────────
async function startBookingHistoryFlow() {
    // Last-ditch effort to find credentials if not already set (e.g. if script loaded late)
    if (!bookingState.phone) initSessionFromContext();

    if (bookingState.phone) {
        await appendBotMessage(`Searching for history with your registered phone number: **${bookingState.phone}**...`);
        fetchAndRenderHistory(bookingState.phone);
    } else {
        await appendBotMessage("I can search for your booking history. What is the **phone number** you used for booking?");
        bookingState.awaitingHistoryPhone = true;
        setInputEnabled(true);
    }
}

async function fetchAndRenderHistory(phone) {
    showTyping(true);
    try {
        const resp = await apiFetch(NODE_API_BASE, `/api/bookings/${phone}`);
        const data = await resp.json();
        showTyping(false);

        if (!resp.ok) throw new Error(data.error || "Failed to fetch history");

        if (data.count === 0) {
            await appendBotMessage(`It looks like you haven't booked anything with us yet! No previous bookings found for **${phone}**.`);
            setTimeout(() => {
                appendBotMessage("Would you like to book your first service today?");
                setTimeout(() => sendWelcomeChips(), 600);
            }, 400);
            return;
        }

        const now = new Date();
        const todayIso = now.toISOString().split('T')[0];
        
        // Split into Current and Finished
        const currentBookings = [];
        const finishedBookings = [];

        data.bookings.forEach(b => {
            const bDate = (b.date && b.date.includes('T')) ? b.date.split('T')[0] : b.date;
            // A booking is "Current" if it's today or in the future
            if (bDate >= todayIso) {
                currentBookings.push(b);
            } else {
                finishedBookings.push(b);
            }
        });

        await appendBotMessage(`I found your booking history for ${phone}:`);

        if (currentBookings.length > 0) {
            const header = document.createElement("div");
            header.className = "history-section-header";
            header.innerHTML = `<span style="font-size:12px; font-weight:700; color:#111827; margin: 12px 0 6px 4px; display:block;">🗓️ Current Bookings</span>`;
            messagesContainer.appendChild(header);
            
            // Render latest current booking first
            currentBookings.forEach(b => renderHistoryCard(b, true));
        }

        if (finishedBookings.length > 0) {
            const header = document.createElement("div");
            header.className = "history-section-header";
            header.innerHTML = `<span style="font-size:12px; font-weight:700; color:#6B7280; margin: 16px 0 6px 4px; display:block;">✅ Finished Bookings</span>`;
            messagesContainer.appendChild(header);
            
            finishedBookings.forEach(b => renderHistoryCard(b, false));
        }
        
    } catch (err) {
        const urlTried = makeApiUrl(NODE_API_BASE, `/api/bookings/${phone}`);
        console.error("History fetch error:", err, "URL tried:", urlTried);
        showTyping(false);
        await appendBotMessage(`❌ Could not reach the server to fetch your history.
        
        Tried: **${urlTried}**
        
        Please ensure the Node backend (port 5000) is running and accessible.`);
    }
}

function renderHistoryCard(b, isCurrent = true) {
    const card = document.createElement("div");
    card.className = "booking-card history-card fade-in";
    if (!isCurrent) card.style.opacity = "0.85"; // Dim finished bookings slightly
    
    // In PostgreSQL, DATE comes back as "YYYY-MM-DD", but let's be safe
    const dateStr = (b.date && b.date.includes('T')) ? b.date.split('T')[0] : b.date;
    const formattedDate = dateStr
        ? new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
        : "—";
    const formattedTime = b.time ? formatTime(b.time) : "—";
    
    card.innerHTML = `
        <div class="booking-card-title" style="font-size:13px; color:#9B1A52; display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                Booking ${b.booking_id}
            </div>
            ${!isCurrent ? '<span style="font-size:9px; background:#F3F4F6; color:#6B7280; padding:2px 6px; border-radius:10px;">Finished</span>' : ""}
        </div>
        <div style="font-size:11.5px; margin:8px 0; color:#4B5563; line-height:1.6;">
            <b>Service:</b> ${b.service_provider}<br>
            <b>Date:</b> ${formattedDate} at ${formattedTime}<br>
            <b>Location:</b> ${b.location || "—"}
        </div>
        ${isCurrent ? `
        <div style="display:flex; gap:8px; margin-top:12px;">
            <button class="booking-btn" style="padding:8px 14px; font-size:11px; flex:1;" onclick="initiateReschedule('${b.booking_id}')">Reschedule</button>
            <button class="booking-btn" style="padding:8px 14px; font-size:11px; flex:1; background:#F3F4F6; color:#1F2937; box-shadow:none;" onclick="initiateCancel('${b.booking_id}')">Cancel</button>
        </div>
        ` : ""}
    `;
    messagesContainer.appendChild(card);
    scrollToRevealMessage(card);
}

window.initiateReschedule = function(bookingId) {
    bookingState.reschedulingBookingId = bookingId;
    appendBotMessage(`Sure! Let's pick a new date and time for booking **${bookingId}**.`);
    renderScheduleCard();
};

async function handleRescheduleSubmit() {
    const bookingId = bookingState.reschedulingBookingId;
    const payload = {
        date: bookingState.date,
        time: bookingState.time
    };
    
    showTyping(true);
    try {
        const resp = await apiFetch(NODE_API_BASE, `/api/reschedule/${bookingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const result = await resp.json();
        showTyping(false);

        if (resp.ok) {
            const formattedDate = new Date(payload.date + "T00:00:00").toLocaleDateString("en-IN", {day:"numeric", month:"long"});
            await appendBotMessage(`✅ Success! Your booking **${bookingId}** has been rescheduled to **${formattedDate}** at **${formatTime(payload.time)}**.`);
            bookingState.reschedulingBookingId = null;
        } else {
            throw new Error(result.error || "Failed to reschedule");
        }
    } catch (err) {
        showTyping(false);
        appendBotMessage(`❌ Reschedule failed: ${err.message}`);
    }
}

window.initiateCancel = async function(bookingId) {
    if (!confirm(`Are you sure you want to cancel booking ${bookingId}?`)) return;
    
    showTyping(true);
    try {
        const resp = await apiFetch(NODE_API_BASE, `/api/cancel/${bookingId}`, { method: "DELETE" });
        const result = await resp.json();
        showTyping(false);
        if (resp.ok) {
            await appendBotMessage(`✅ Booking **${bookingId}** has been successfully cancelled.`);
        } else {
            appendBotMessage(`❌ Cancellation failed: ${result.error || "Please contact support."}`);
        }
    } catch (err) {
        showTyping(false);
        appendBotMessage("❌ Error communicating with server.");
    }
}

