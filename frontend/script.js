/**
 * script.js — Motherly Chat Frontend Logic v23
 * 4-step booking flow with voice input, progress bar, and auto-open.
 */

// ── DOM refs ──────────────────────────────────────────────────────────
const messagesContainer = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const typingIndicator = document.getElementById("typing-indicator");
const micBtn = document.querySelector(".mic-button");

// ── State ─────────────────────────────────────────────────────────────
let chatHistory = [];
let bookingState = {};          // tracks 4-step booking data
let isRecording = false;
let speechRecognition = null;
let detectedLocation = null;   // pre-fetched GPS address, filled on load

// ── Floating chat state: tooltip once, panel open/close ─────────────
let userHasOpenedChat = false;
let tooltipTimeoutId = null;

// ── Auto-open on load ─────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
    prefetchLocation();

    setTimeout(async () => {
        messagesContainer.innerHTML = "";
        await sendWelcomeMessage();
        updateProgress(0);
    }, 1000);

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

    // Ensure close button works (bind in JS so it never fails)
    const closeBtn = document.getElementById("btn-close");
    if (closeBtn) {
        closeBtn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            closeChat();
        });
    }
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

function openChat() {
    const panelEl = document.getElementById("chat-panel");
    const floatingChatEl = document.querySelector(".floating-chat");
    if (!panelEl || !floatingChatEl) return;

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
        if (minBtn) minBtn.title = "Minimize chat";
    }

    panelEl.classList.remove("chat-panel--closed");
    panelEl.classList.add("chat-panel--open");
    floatingChatEl.classList.add("chat-panel-open");

    setTimeout(() => userInput.focus(), 150);
}

function closeChatPanel() {
    const panelEl = document.getElementById("chat-panel");
    const floatingChatEl = document.querySelector(".floating-chat");
    if (!panelEl || !floatingChatEl) return;

    panelEl.classList.remove("chat-panel--open");
    panelEl.classList.add("chat-panel--closed");
    floatingChatEl.classList.remove("chat-panel-open");
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
if (micBtn) micBtn.addEventListener("click", toggleVoiceInput);

// ── Send helpers ──────────────────────────────────────────────────────
function handleSend() {
    sendMessage(userInput.value.trim());
}

async function sendMessage(text) {
    if (!text || !text.trim()) return;

    removeAllChips();
    setInputEnabled(false);

    appendMessage(text.trim(), "user");
    userInput.value = "";
    
    // Intercept the message if we are waiting for a booking description
    if (bookingState.awaitingDescription) {
        const validation = validateBookingDescription(text.trim());
        if (!validation.valid) {
            setInputEnabled(true);
            setTimeout(() => {
                appendBotMessage(validation.message);
                scrollToBottomIfNearBottom();
                setTimeout(() => userInput.focus(), 100);
            }, 400);
            return;
        }
        // Client-side checks passed — ask LLM to verify relevance and validity
        setInputEnabled(false);
        showTyping(true);
        try {
            const resp = await fetch("/validate-booking-description", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    description: text.trim(),
                    service: bookingState.service || "",
                }),
            });
            const data = await resp.json().catch(() => ({}));
            showTyping(false);
            if (data.valid) {
                bookingState.description = text.trim();
                bookingState.awaitingDescription = false;
                renderReviewBookingCard();
                return;
            }
            const llmMessage = (data.message && data.message.trim()) || "Please tell us why you need this service so we can help.\n\nTip: You can type or use the mic.";
            await appendBotMessage(llmMessage);
            setInputEnabled(true);
            setTimeout(() => userInput.focus(), 100);
        } catch (err) {
            console.error("Validate description error:", err);
            showTyping(false);
            await appendBotMessage("We couldn't verify your response right now. Please try again, or tell us about your situation and submit.\n\nTip: You can type or use the mic.");
            setInputEnabled(true);
            setTimeout(() => userInput.focus(), 100);
        }
        return;
    }

    showTyping(true);

    try {
        const response = await fetch("/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text.trim(), history: chatHistory }),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        showTyping(false);
        await appendMessage(data.response, "bot");

        chatHistory.push({ role: "user", content: text.trim() });
        chatHistory.push({ role: "assistant", content: data.response });

    } catch (err) {
        console.error("Chat error:", err);
        showTyping(false);
        await appendMessage("Oops — I couldn't reach the server. Please check your connection and try again.", "bot");
    } finally {
        setInputEnabled(true);
        setTimeout(() => userInput.focus(), 100);
    }
}

// ── Reset flow ────────────────────────────────────────────────────────
function resetChat() {
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
    updateProgress(0);
    sendWelcomeMessage();
}

// ── Minimize chat ─────────────────────────────────────────────────────
function minimizeChat() {
    const wrapper = document.querySelector('.chat-wrapper');
    const messages = document.getElementById('chat-messages');
    const inputBar = document.querySelector('.chat-input-bar');
    const typingInd = document.getElementById('typing-indicator');
    const isMinimized = wrapper.dataset.minimized === 'true';

    if (!isMinimized) {
        messages.style.display = 'none';
        inputBar.style.display = 'none';
        typingInd.style.display = 'none';
        wrapper.style.height = 'auto';
        wrapper.dataset.minimized = 'true';
        document.getElementById('btn-minimize').title = 'Restore chat';
    } else {
        messages.style.display = '';
        inputBar.style.display = '';
        wrapper.style.height = '';
        wrapper.dataset.minimized = 'false';
        document.getElementById('btn-minimize').title = 'Minimize chat';
    }
}

// ── Close chat (collapse panel; FAB stays visible) ───────────────────
function closeChat() {
    closeChatPanel();
}

// Expose for inline handlers and external use
if (typeof window !== "undefined") {
    window.closeChat = closeChat;
    window.openChat = openChat;
}

// ── Progress indicator ────────────────────────────────────────────────
const STEP_LABELS = ["", "Step 1 of 4 – Service", "Step 2 of 4 – Schedule", "Step 3 of 4 – Contact", "Step 4 of 4 – Confirmation"];

function updateProgress(step) {
    const label = document.getElementById('step-label');
    const bar = document.getElementById('progress-fill');
    if (!label || !bar) return;
    if (step === 0) {
        label.textContent = "";
        bar.style.width = "0%";
        return;
    }
    label.textContent = STEP_LABELS[step] || "";
    bar.style.width = `${(step / 4) * 100}%`;
}

// ── Welcome message ───────────────────────────────────────────────────
async function sendWelcomeMessage() {
    const text = "Hi, I'm **Mothrly Assistant**. I can help you book a doula or consultation.\n\n**What do you need help with today?**";

    await appendMessage(text, "bot", true);

    const optionsRow = document.createElement("div");
    optionsRow.className = "options-container chips-container";

    const opts = [
        { label: "Book Doula",                icon: getIconForLabel("doula") },
        { label: "Book Nanny",                icon: getIconForLabel("nanny") },
        { label: "Book Doctor Consultation",  icon: getIconForLabel("book doctor consultation") },
        { label: "Book Lactation Consultant", icon: getIconForLabel("book lactation consultant") },
        { label: "Prenatal Nutrition",        icon: getIconForLabel("prenatal nutrition") },
        { label: "About Motherly",            icon: getIconForLabel("about motherly") },
        { label: "Contact Support",           icon: getIconForLabel("contact support") },
    ];

    opts.forEach(({ label, icon }) => {
        const btn = document.createElement("button");
        btn.className = "option-btn fade-in";
        btn.innerHTML = icon ? `<span class="btn-icon">${icon}</span> ${label}` : label;
        btn.addEventListener("click", () => handleServiceSelection(label));
        optionsRow.appendChild(btn);
    });

    messagesContainer.appendChild(optionsRow);
    scrollToShowOptions(optionsRow);
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

    if (service === "Book Doula") {
        await appendBotMessage("Great! What kind of support do you need?");
        bookingState.subType = "Doula";
        renderSubOptions("doula-reason", [
            { label: "Pregnancy Support",    desc: "Guidance during pregnancy" },
            { label: "Labor & Delivery",     desc: "Support during birth" },
            { label: "After Birth Care",     desc: "Post-natal recovery help" },
            { label: "Breastfeeding Help",   desc: "Nursing & lactation support" },
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
            { label: "Online Consultation", desc: "Video call with doctor" },
            { label: "In-Clinic Visit",     desc: "Visit our clinic in person" },
        ]);
        return;
    }

    if (service === "Book Lactation Consultant") {
        await appendBotMessage("How would you like to meet your lactation consultant?");
        renderSubOptions("lactation-mode", [
            { label: "Home Visit",          desc: "Consultant visits you" },
            { label: "Online Session",      desc: "Video call support" },
            { label: "Clinic Appointment",  desc: "Visit our clinic" },
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
        await appendBotMessage("Here's a quick overview of **Motherly**.\n\nWe are a maternal care platform connecting mothers with certified doulas, doctors, lactation consultants, and nutritionists — all in one place.\n\nChennai, India\n+91 99448 90577\nmotherlycareethos@gmail.com\n\nWould you like to book a service now?");
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
var PRENATAL_LEARN_OPTIONS = [
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
    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C22627" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
    switch (iconKey) {
        case "diet":   s += '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>'; break;
        case "brain":  s += '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>'; break;
        case "symptoms": s += '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>'; break;
        case "avoid":  s += '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>'; break;
        case "hydration": s += '<path d="M12 22c4-4 8-7.5 8-12a8 8 0 0 0-16 0c0 4.5 4 8 8 12z"/>'; break;
        case "weight":  s += '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/><path d="M9 6v12"/><path d="M15 6v12"/>'; break;
        case "postpartum": s += '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'; break;
        case "daily":   s += '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'; break;
        default: s += '<circle cx="12" cy="12" r="10"/>';
    }
    return s + '</svg>';
}

function renderPrenatalLearnOptions() {
    var row = document.createElement("div");
    row.className = "options-container chips-container prenatal-learn-grid";
    row.dataset.context = "prenatal-learn";
    PRENATAL_LEARN_OPTIONS.forEach(function (opt) {
        var btn = document.createElement("button");
        btn.className = "option-btn option-btn--prenatal fade-in";
        btn.innerHTML = '<span class="btn-icon">' + getPrenatalTopicIcon(opt.icon) + '</span> ' + opt.label;
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
            <span style="display:flex;flex-direction:column;gap:2px;">
                <span style="font-weight:600;font-size:13px;">${label}</span>
                ${desc ? `<span style="font-size:11px;color:#9CA3AF;font-weight:400;">${desc}</span>` : ""}
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
            { label: "Pregnancy Support",    desc: "Guidance during pregnancy" },
            { label: "Labor & Delivery",     desc: "Support during birth" },
            { label: "After Birth Care",     desc: "Post-natal recovery help" },
            { label: "Breastfeeding Help",   desc: "Nursing & lactation support" },
        ]);
        return;
    }

    // ── Doula reason → schedule ──────────────────────────────────────
    if (context === "doula-reason") {
        bookingState.reason = subOption;
        bookingState.service = `${bookingState.subType || "Doula"} — ${subOption}`;
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

    // ── Prenatal learn (topic selected) → send to chat for nutrition content ────────────────────
    if (context === "prenatal-learn") {
        setInputEnabled(false);
        showTyping(true);
        try {
            var resp = await fetch("/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: subOption, history: chatHistory }),
            });
            if (!resp.ok) throw new Error("Chat request failed");
            var data = await resp.json();
            showTyping(false);
            await appendMessage(data.response, "bot");
            chatHistory.push({ role: "user", content: subOption });
            chatHistory.push({ role: "assistant", content: data.response });
        } catch (err) {
            console.error("Prenatal chat error:", err);
            showTyping(false);
            await appendMessage("Sorry, I couldn't load that topic. Please try again.", "bot");
        }
        setInputEnabled(true);
        setTimeout(function () { userInput.focus(); }, 100);
        return;
    }

    // ── All other sub-options → schedule directly ────────────────────
    bookingState.subType = subOption;
    bookingState.service = `${bookingState.service} (${subOption})`;
    await appendBotMessage(`Perfect! Let me schedule your **${bookingState.service}** appointment.`);
    renderScheduleCard();
}

// ── Show only the main option chips (for re-use) ──────────────────────
function sendWelcomeChips() {
    const optionsRow = document.createElement("div");
    optionsRow.className = "options-container chips-container";
    const opts = [
        { label: "Book Doula",                icon: getIconForLabel("doula") },
        { label: "Book Nanny",                icon: getIconForLabel("nanny") },
        { label: "Book Doctor Consultation",  icon: getIconForLabel("book doctor consultation") },
        { label: "Book Lactation Consultant", icon: getIconForLabel("book lactation consultant") },
        { label: "Prenatal Nutrition",        icon: getIconForLabel("prenatal nutrition") },
        { label: "About Motherly",            icon: getIconForLabel("about motherly") },
        { label: "Contact Support",           icon: getIconForLabel("contact support") },
    ];
    opts.forEach(({ label, icon }) => {
        const btn = document.createElement("button");
        btn.className = "option-btn fade-in";
        btn.innerHTML = icon ? `<span class="btn-icon">${icon}</span> ${label}` : label;
        btn.addEventListener("click", () => handleServiceSelection(label));
        optionsRow.appendChild(btn);
    });
    messagesContainer.appendChild(optionsRow);
    scrollToShowOptions(optionsRow);
}

// ── Step 2a — Nanny: Child details (age + names) ─────────────────────
function renderNannyChildDetailsCard() {
    updateProgress(2);
    const card = document.createElement("div");
    card.className = "booking-card chips-container fade-in";
    card.id = "nanny-child-card";
    card.innerHTML = `
        <div class="booking-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Tell us about the child(ren)
        </div>

        <label class="booking-label">Child's age range <span class="booking-required">*</span></label>
        <select id="child-age" class="booking-input time-slot-select">
            <option value="">Select age range…</option>
            <option value="0-1">0 – 1 year (infant)</option>
            <option value="1-3">1 – 3 years (toddler)</option>
            <option value="3+">3 years & above</option>
        </select>

        <button onclick="submitNannyChildDetails()" class="booking-btn">Next → Schedule</button>
    `;
    messagesContainer.appendChild(card);
    scrollToBottomIfNearBottom();
}

window.submitNannyChildDetails = function() {
    const ageEl = document.getElementById("child-age");
    const age = ageEl?.value?.trim();

    if (!age) {
        showCardError("nanny-child-card", "Please select the child's age range.");
        return;
    }

    bookingState.childAgeRange = age;
    removeAllChips();
    const ageLabel = { "0-1": "0–1 year", "1-3": "1–3 years", "3+": "3+ years" }[age] || age;
    appendMessage(`Child age: ${ageLabel}`, "user");
    setTimeout(() => renderScheduleCard(), 400);
};

// ── Contact Support Card ──────────────────────────────────────────────
function renderContactSupportCard() {
    const card = document.createElement("div");
    card.className = "booking-card chips-container fade-in";
    card.id = "contact-support-card";
    card.innerHTML = `
        <div class="booking-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.32 2 2 0 0 1 3.58 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.56a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.72 16z"/></svg>
            Contact Support
        </div>
        <div style="display:flex;flex-direction:column;gap:18px;padding:4px 0;">
            <div style="display:flex;align-items:center;gap:12px;">
                <span style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:#FEE2E2;flex-shrink:0;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C22627" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.32 2 2 0 0 1 3.58 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.56a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.72 16z"/></svg>
                </span>
                <a href="tel:+919944890577" style="color:#C22627;font-weight:600;font-size:15px;text-decoration:none;">+91 99448 90577</a>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
                <span style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:#FEE2E2;flex-shrink:0;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C22627" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                </span>
                <a href="mailto:motherlycareethos@gmail.com" style="color:#C22627;font-weight:600;font-size:14px;text-decoration:none;">motherlycareethos@gmail.com</a>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
                <span style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:#FEE2E2;flex-shrink:0;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C22627" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                </span>
                <span style="color:#6B7280;font-size:15px;font-weight:500;">Chennai, India</span>
            </div>
        </div>
    `;
    messagesContainer.appendChild(card);
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
        <div style="position:relative;">
            <input type="text" id="loc-input" class="booking-input" placeholder="Enter your location..." autocomplete="off">
            <button onclick="detectLocation()" class="detect-btn" title="Detect my location">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
                Detect
            </button>
        </div>
        <p id="loc-status" style="font-size:12px;color:#9CA3AF;margin-top:4px; min-height:16px;"></p>

        <label class="booking-label">Date <span class="booking-required">*</span></label>
        <input type="text" id="date-input" class="booking-input booking-input--picker" placeholder="Select date" readonly inputmode="none" aria-label="Select date">

        <label class="booking-label">Time <span class="booking-required">*</span></label>
        <input type="text" id="time-input" class="booking-input booking-input--picker" placeholder="Select time" readonly inputmode="none" aria-label="Select time">
        <p class="booking-hint">Available: 9:00 AM – 6:00 PM</p>

        <button onclick="submitSchedule()" class="booking-btn">Next →</button>
    `;
    messagesContainer.appendChild(card);
    // Ensure the full schedule card (especially time selector + button) is visible inside the chat viewport
    scrollToRevealMessage(card);

    // Pre-fill location if already detected from page-load GPS request
    prefillLocationField();
    initSchedulePickers(todayStr);
}

function initSchedulePickers(todayStr) {
    const dateEl = document.getElementById("date-input");
    const timeEl = document.getElementById("time-input");
    if (!dateEl || !timeEl) return;

    // ── Date: keep Material picker if available ────────────────────────
    if (window.moment && window.mdDateTimePicker) {
        const existingDateIso = dateEl.dataset.iso || bookingState.date || null;
        const minDate = window.moment(todayStr, "YYYY-MM-DD");
        const maxDate = window.moment().add(1, "year").endOf("day");
        const initDate = existingDateIso
            ? window.moment(existingDateIso, "YYYY-MM-DD")
            : window.moment().startOf("day");

        const dateDialog = new window.mdDateTimePicker.default({
            type: "date",
            init: initDate,
            past: minDate,
            future: maxDate,
            ok: "OK",
            cancel: "CANCEL",
            orientation: "PORTRAIT",
        });
        dateDialog.trigger = dateEl;
        dateEl._mddtp = dateDialog;

        dateEl.addEventListener("onOk", function () {
            const m = dateDialog.time;
            if (!m || !m.isValid()) return;
            dateEl.dataset.iso = m.format("YYYY-MM-DD");
            dateEl.value = m.format("DD MMM YYYY");
        });

        const openDate = (e) => {
            e.preventDefault();
            e.stopPropagation();
            setTimeout(() => {
                dateDialog.toggle();
                setTimeout(mountDatePickerIntoChatPanel, 0);
            }, 0);
        };
        dateEl.addEventListener("pointerup", openDate);
    } else {
        dateEl.readOnly = false;
        dateEl.placeholder = "DD MMM YYYY";
    }

    // ── Time: custom in-panel widget (no external library) ─────────────
    timeEl.addEventListener("pointerup", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openCustomTimePicker(timeEl);
    });
    timeEl.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openCustomTimePicker(timeEl);
    });
}

function mountDatePickerIntoChatPanel() {
    const panelEl = document.getElementById("chat-panel");
    if (!panelEl) return;
    const activePicker = Array.from(document.querySelectorAll(".mddtp-picker"))
        .find(el => !el.classList.contains("mddtp-picker--inactive"));
    if (!activePicker) return;
    if (!panelEl.contains(activePicker)) panelEl.appendChild(activePicker);
    activePicker.classList.add("mddtp-picker--in-chat");
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
    const panelEl = document.getElementById("chat-panel");
    if (!panelEl) return;

    // Remove any existing overlay
    const existing = panelEl.querySelector(".time-picker-overlay");
    if (existing) existing.remove();

    const currentValue24 = timeInputEl.dataset.value24 || "";
    const slots = buildTimeSlots();

    const overlay = document.createElement("div");
    overlay.className = "time-picker-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Select time");

    const card = document.createElement("div");
    card.className = "time-picker-card";

    const title = document.createElement("div");
    title.className = "time-picker-title";
    title.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Select time`;

    const slotsWrap = document.createElement("div");
    slotsWrap.className = "time-picker-slots";

    slots.forEach(({ value24, label }) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "time-picker-slot";
        if (value24 === currentValue24) btn.classList.add("time-picker-slot--selected");
        btn.textContent = label;
        btn.dataset.value24 = value24;
        btn.dataset.label = label;
        btn.addEventListener("click", () => {
            slotsWrap.querySelectorAll(".time-picker-slot--selected").forEach((b) => b.classList.remove("time-picker-slot--selected"));
            btn.classList.add("time-picker-slot--selected");
        });
        slotsWrap.appendChild(btn);
    });

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
                statusEl.textContent = "Location auto-detected";
            }
        }, 300);

        // Give up after 12s if permission was denied or GPS is unavailable
        setTimeout(() => {
            clearInterval(poll);
            if (!locInput.value) {
                locInput.disabled = false;
                locInput.placeholder = "Enter your location...";
                statusEl.textContent = "Could not detect location. Please type your location.";
            }
        }, 12000);
    }
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
window.detectLocation = function() {
    const statusEl = document.getElementById("loc-status");
    const locInput = document.getElementById("loc-input");
    if (!statusEl || !locInput) return;

    if (!navigator.geolocation) {
        statusEl.textContent = "Geolocation not supported by your browser.";
        return;
    }

    locInput.value = "";
    locInput.placeholder = "Detecting your location…";
    locInput.disabled = true;
    statusEl.textContent = "Detecting your location…";

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            locInput.disabled = false;
            locInput.placeholder = "Enter your location...";
            reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        },
        (err) => {
            locInput.disabled = false;
            locInput.placeholder = "Enter your location...";
            statusEl.textContent = err.code === err.PERMISSION_DENIED
                ? "Location access denied. Please type your location manually."
                : "Could not detect location. Please type your location manually.";
        },
        { timeout: 10000, enableHighAccuracy: false }
    );
};

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
window.detectLocation = function(silent = false) {
    const statusEl = document.getElementById("loc-status");
    const locInput = document.getElementById("loc-input");
    if (!statusEl || !locInput) return;

    if (!navigator.geolocation) {
        if (!silent) statusEl.textContent = "Geolocation not supported by your browser.";
        return;
    }

    statusEl.textContent = "Detecting your location…";
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude, longitude } = pos.coords;
            reverseGeocode(latitude, longitude);
        },
        (err) => {
            statusEl.textContent = silent ? "" : "Location access denied. Please enter manually.";
        },
        { timeout: 8000 }
    );
};

function reverseGeocode(lat, lng) {
    const statusEl = document.getElementById("loc-status");
    const locInput = document.getElementById("loc-input");

    // Use Google Geocoding API if Maps is loaded, else show coords
    if (window.google && window.google.maps) {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: { lat, lng } }, (results, status) => {
            if (status === "OK" && results[0]) {
                locInput.value = results[0].formatted_address;
                if (statusEl) statusEl.textContent = "Location detected";
            } else {
                locInput.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
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
                if (statusEl) statusEl.textContent = "Location detected";
            })
            .catch(() => {
                locInput.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
                if (statusEl) statusEl.textContent = "Coordinates detected";
            });
    }
}

// ── Google Places Autocomplete ────────────────────────────────────────
// ── Google Places Autocomplete (Disabled) ──────────────────────────────

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

    bookingState.location = loc;
    bookingState.date = dateIso;
    bookingState.time = time24;
    bookingState.step = 2;

    // Remove card, send summary as user message
    removeAllChips();
    const formattedDate = new Date(dateIso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const formattedTime = formatTime(time24);
    appendMessage(`${loc}\n${formattedDate} at ${formattedTime}`, "user");

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
        <input type="text" id="c-name" class="booking-input" placeholder="Your full name" autocomplete="name">

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
    const phone   = document.getElementById("c-phone")?.value.trim();
    const email   = document.getElementById("c-email")?.value.trim();
    const self_   = document.getElementById("c-self")?.checked;
    const relation= self_ ? "self" : document.getElementById("c-relation")?.value;

    if (!name)   { showCardError("contact-card", "Please enter your full name."); return; }
    if (!phone || !/^[+]?[\d\s\-()]{6,15}$/.test(phone.replace(/\s/g,''))) {
        showCardError("contact-card", "Please enter a valid phone number."); return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showCardError("contact-card", "Please enter a valid email address."); return;
    }
    if (!relation) { showCardError("contact-card", "Please select your relation to the patient."); return; }

    bookingState = { ...bookingState, name, phone, email, relation, forSelf: self_, step: 3 };

    removeAllChips();
    appendMessage(`${name} | ${phone} | ${email}`, "user");

    // Ask for description to complete the booking (question varies by service)
    bookingState.awaitingDescription = true;
    
    setTimeout(() => {
        const prompt = getDescriptionPromptForService(bookingState.service);
        appendBotMessage(prompt);
        setInputEnabled(true);
    }, 400);
};

/**
 * Returns the "describe your situation" prompt tailored to the booked service.
 */
function getDescriptionPromptForService(service) {
    const svc = (service || "").toLowerCase();
    const tip = "\n\nTip: You can type or use the mic.";
    if (svc.includes("doula")) {
        return "Please tell us a little about your situation so we can match you with the right doula.\n\nWhat to include:\n• Type of support you need (birth, labour, postpartum)\n• Any concerns or special requests\n• Your pregnancy stage" + tip;
    }
    if (svc.includes("nanny")) {
        return "Tell us about your childcare needs so we can find the right fit.\n\nWhat to include:\n• Hours or days you need care\n• Child's routine or schedule\n• Any special care requirements" + tip;
    }
    if (svc.includes("lactation")) {
        return "Share a bit about your feeding situation so we can match you with the right support.\n\nWhat to include:\n• Current feeding goals or challenges\n• Baby's age (if relevant)\n• Any specific concerns" + tip;
    }
    if (svc.includes("doctor") || svc.includes("consultation")) {
        return "Briefly tell us why you're booking this consultation.\n\nWhat to include:\n• Main concern or symptom\n• How long it's been going on\n• Any relevant history" + tip;
    }
    return "Please tell us a little about your situation so we can help.\n\nWhat to include:\n• Why you need this booking\n• Any specific concerns or requests" + tip;
}

/**
 * Validates the user's booking description. Rejects too short, unclear, or spam-like input.
 * @returns {{ valid: boolean, message?: string }}
 */
function validateBookingDescription(text) {
    const trimmed = (text || "").trim();
    const minLength = 20;
    const minWords = 3;

    if (!trimmed) {
        return {
            valid: false,
            message: "Please share a few words about your situation so we can help.\n\nTip: You can type or use the mic.",
        };
    }

    if (trimmed.length < minLength) {
        return {
            valid: false,
            message: "That's a bit brief. A few sentences help us match you with the right care.\n\nTip: You can type or use the mic.",
        };
    }

    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length < minWords) {
        return {
            valid: false,
            message: "Please add a bit more detail so we can support you better.\n\nTip: You can type or use the mic.",
        };
    }

    // Reject if mostly non-letters (numbers, symbols, repeated chars)
    const lettersOnly = trimmed.replace(/\s/g, "").replace(/[^a-zA-Z]/g, "");
    const letterRatio = lettersOnly.length / Math.max(trimmed.replace(/\s/g, "").length, 1);
    if (letterRatio < 0.4) {
        return {
            valid: false,
            message: "We couldn't quite understand that. Please describe your situation in a few words or sentences.\n\nTip: You can try the mic to speak your response.",
        };
    }

    // Reject single word or same word repeated (likely spam)
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    if (uniqueWords.size < 2 && words.length < 8) {
        return {
            valid: false,
            message: "Please share a bit more about your needs so we can help.\n\nTip: You can type or use the mic.",
        };
    }

    return { valid: true };
}

// ── Review booking (confirm before submit) ────────────────────────────
function renderReviewBookingCard() {
    const date = bookingState.date;
    const formattedDate = date
        ? new Date(date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
        : "—";
    const formattedTime = bookingState.time ? formatTime(bookingState.time) : "—";

    const card = document.createElement("div");
    card.className = "booking-card confirmation-card fade-in";
    card.id = "review-booking-card";
    card.innerHTML = `
        <div class="booking-card-title" style="margin-bottom:12px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            Is everything correct?
        </div>
        <p style="font-size:13px;color:#6B7280;margin-bottom:16px;">Please review your booking details before confirming.</p>
        <div class="confirm-grid" style="margin-bottom:20px;">
            <div class="confirm-row">
                <span class="confirm-key">Name</span>
                <span class="confirm-val">${bookingState.name || "—"}</span>
            </div>
            <div class="confirm-row">
                <span class="confirm-key">Service</span>
                <span class="confirm-val">${bookingState.service || "—"}</span>
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
        { label: "Schedule (date, time, location)", value: "schedule" },
        { label: "Contact details", value: "contact" },
        { label: "Description", value: "description" },
    ].forEach(({ label, value }) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "option-btn fade-in";
        btn.textContent = label;
        btn.addEventListener("click", () => {
            document.getElementById("review-change-options")?.remove();
            if (value === "schedule") renderScheduleCard();
            else if (value === "contact") renderContactCard();
            else {
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

    try {
        const bookingResp = await fetch("/book", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                service:  bookingState.service,
                date:     bookingState.date,
                time:     bookingState.time,
                location: bookingState.location,
                name:     bookingState.name,
                phone:    bookingState.phone,
                email:    bookingState.email,
                forSelf:  bookingState.forSelf,
                relation: bookingState.relation,
                description: bookingState.description,
                child_age_range: bookingState.childAgeRange || null,
            }),
        });
        const booking = bookingResp.ok ? await bookingResp.json() : { bookingId: generateLocalId(), status: "confirmed" };
        showTyping(false);
        renderConfirmation(booking);
    } catch {
        showTyping(false);
        renderConfirmation({ bookingId: generateLocalId(), status: "confirmed" });
    }
    
    setInputEnabled(true);
}

// ── Step 4 — Confirmation screen ──────────────────────────────────────
function renderConfirmation(booking) {
    updateProgress(4);
    chatHistory.push({ role: "assistant", content: "Booking confirmed: " + (booking.bookingId || "N/A") });

    const date = bookingState.date;
    const formattedDate = date
        ? new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        : "—";
    const formattedTime = bookingState.time ? formatTime(bookingState.time) : "—";
    const paymentStatus = (booking && (booking.payment_status || booking.paymentStatus)) || bookingState.paymentStatus || "Pending";

    const card = document.createElement("div");
    card.className = "confirmation-card fade-in";
    card.innerHTML = `
        <div class="confirm-header">
            <div class="confirm-check">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div>
                <div class="confirm-title">Booking Confirmed</div>
                <div class="confirm-id">Booking ID: <strong>${booking.bookingId || "MTH-000000"}</strong></div>
            </div>
        </div>

        <div class="confirm-grid">
            <div class="confirm-row">
                <span class="confirm-key">Name</span>
                <span class="confirm-val">${bookingState.name || "—"}</span>
            </div>
            <div class="confirm-row">
                <span class="confirm-key">Service</span>
                <span class="confirm-val">${bookingState.service || "—"}</span>
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
            <div class="confirm-row">
                <span class="confirm-key">Payment status</span>
                <span class="confirm-val">${paymentStatus}</span>
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
        <button onclick="resetChat()" class="booking-btn" style="margin-top:12px;background:#F3F4F6;color:#1F2937;">Start New Booking</button>
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
        ? `<div class="message-avatar-box" style="background:#fff;border:1px solid #E5E7EB;overflow:hidden;"><img src="/static/motherly_logo.png?v=2" style="width:100%;height:100%;object-fit:contain;padding:2px;"></div>`
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
        headerSubtitle.style.color = "#C22627";
        headerSubtitle.style.fontWeight = "600";
    } else {
        headerSubtitle.textContent = headerSubtitle.dataset.oldText || "";
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
    if (icon) {
        btn.innerHTML = `<span class="btn-icon">${icon}</span> ${label}`;
    } else {
        btn.textContent = label;
    }
    btn.addEventListener("click", () => sendMessage(label));
    return btn;
}

function removeAllChips() {
    document.querySelectorAll(".chips-container").forEach(el => el.remove());
}

function showTyping(visible) {
    typingIndicator.style.display = visible ? "flex" : "none";
    // Do not scroll when typing indicator shows — user controls scroll position
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
    err.style.cssText = "color:#C22627;font-size:13px;margin:4px 0 8px;font-weight:500;display:flex;align-items:flex-start;gap:6px;";
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
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C22627" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.19 19a19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.08 4.18 2 2 0 0 1 4.05 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.77.63 2.6a2 2 0 0 1-.45 2.11l-1.1 1.1a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.11-.45c.83.3 1.7.51 2.6.63A2 2 0 0 1 22 16.92z"/></svg>`;
    }

    // About
    if (text.includes("about") || text.includes("motherly")) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C22627" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    }

    // Prenatal nutrition
    if (text.includes("nutrition") || text.includes("diet")) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C22627" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>`;
    }

    // Doctor consultation
    if (text.includes("doctor") || text.includes("physician") || text.includes("consultation") || text.includes("speak")) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C22627" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 8V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v2"/><path d="M7 8h10"/><path d="M9 20h6"/><path d="M12 8v12"/><path d="M9 11h6"/></svg>`;
    }

    // Lactation consultant
    if (text.includes("lactation") || text.includes("breastfeed")) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C22627" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c4-4 8-7.5 8-12a8 8 0 0 0-16 0c0 4.5 4 8 8 12z"/></svg>`;
    }

    // Doula
    if (text.includes("doula")) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C22627" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/><path d="M8.5 12.2c1.2 1.4 2.5 2.1 3.5 2.1s2.3-.7 3.5-2.1"/></svg>`;
    }

    // Nanny
    if (text.includes("nanny") || text.includes("childcare") || text.includes("baby")) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C22627" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3"/><path d="M7 21v-2a5 5 0 0 1 10 0v2"/><path d="M5.5 12.5c.9-1.6 2.6-2.7 4.5-2.9"/><path d="M18.5 12.5c-.9-1.6-2.6-2.7-4.5-2.9"/></svg>`;
    }

    // Pregnancy / generic care (fallback icon for other pregnancy-related chips)
    if (text.includes("pregnan") || text.includes("prenatal") || text.includes("pregnancy")) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C22627" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 1 0 0 8a4 4 0 0 0 0-8z"/><path d="M8 22v-3a4 4 0 0 1 8 0v3"/><path d="M9.5 12c.7 1.2 1.6 2 2.5 2s1.8-.8 2.5-2"/></svg>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C22627" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>`;
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
            setTimeout(() => handleSend(), 300);
        }
    };

    speechRecognition.onerror = (e) => {
        stopVoiceInput();
        if (e.error !== 'aborted') showToast("Voice error: " + e.error);
    };

    speechRecognition.onend = () => stopVoiceInput();

    speechRecognition.start();
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
}

function showToast(msg) {
    let toast = document.getElementById("voice-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "voice-toast";
        toast.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1F2937;color:#fff;padding:10px 18px;border-radius:20px;font-size:13px;z-index:9999;opacity:0;transition:opacity 0.3s;pointer-events:none;white-space:nowrap;`;
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = "1";
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = "0"; }, 3000);
}
