/**
 * CaptureMoment — Chat widget UI (visual layer).
 *
 * Placement:  asset/chat-ui.js   (loaded by index.html)
 * Owns:       FAB toggle, bubbles, typing indicator, suggestion chips,
 *             bilingual texts (EN/FR, read from the site dictionary).
 * Does NOT own: transport or history — that's chat.js's job.
 *
 * Optional sibling modules (loaded lazily, the widget degrades
 * gracefully if they are missing):
 *   - asset/js/chat.js     → export async function sendMessage(question, handlers)
 *                         with handlers = { onToken, onError, onDone }
 *   - asset/js/markdown.js → export function renderMarkdown(text) → HTML string
 *
 * The widget stays fully usable (open/close, welcome, chips) even before
 * chat.js exists: sending a question then shows a friendly error bubble.
 */

const fab = document.getElementById("chat-fab");
const badge = document.getElementById("chat-fab-badge");
const panel = document.getElementById("chat-panel");
const messagesEl = document.getElementById("chat-messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("chat-input");
const sendBtn = document.getElementById("chat-send");

let welcomed = false;          // first open -> bot greets + suggestion chips
let streaming = false;         // one response at a time
let chatModule;                // ./js/chat.js   (undefined = not loaded yet)
let markdownModule;            // ./js/markdown.js (null = missing, plain text fallback)
let welcomeBubble = null;      // kept to re-render it on language switch
let chipRefs = [];             // [{ chip, key }] kept for language switch

const FALLBACK = {
  "chat.welcome": "👋 Hi there! I'm the CaptureMoment assistant. Ask me anything about the app: features, installation, download…",
  "chat.sugg1": "How do I install CaptureMoment?",
  "chat.sugg2": "What are the main features?",
  "chat.sugg3": "Which systems are supported?",
  "chat.error": "Sorry, the service is temporarily unavailable. Please try again in a moment.",
};

// --- i18n ---------------------------------------------------------------

/** Reads a text from the site dictionary (index.html) in the current
    language; falls back to English, then to the key's default text. */
function t(key) {
  const lang = document.documentElement.lang === "fr" ? "fr" : "en";
  const table = window.CM_TRANSLATIONS || {};
  return (table[lang] && table[lang][key]) || FALLBACK[key] || key;
}

// --- rendering helpers ----------------------------------------------------

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** HTML string for a bubble. Uses asset/js/markdown.js when available,
    otherwise a safe plain-text fallback (escaped, line breaks kept). */
function renderContent(text) {
  if (markdownModule && typeof markdownModule.renderMarkdown === "function") {
    return markdownModule.renderMarkdown(text);
  }
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addBubble(sender, text = "") {
  const bubble = document.createElement("div");
  bubble.className = `chat-msg ${sender}`;
  if (text) bubble.innerHTML = renderContent(text);
  messagesEl.appendChild(bubble);
  scrollBottom();
  return bubble;
}

// --- lazy modules -----------------------------------------------------------

async function loadMarkdown() {
  if (markdownModule !== undefined) return markdownModule;
  try {
    markdownModule = await import("./js/markdown.js");
  } catch {
    markdownModule = null; // plain-text fallback, the chat still works
  }
  return markdownModule;
}

async function loadBackend() {
  if (chatModule) return chatModule;
  chatModule = await import("./js/chat.js");
  if (typeof chatModule.sendMessage !== "function") {
    throw new Error("chat.js must export sendMessage()");
  }
  return chatModule;
}

// --- welcome + suggestions ----------------------------------------------------

function welcome() {
  welcomed = true;
  welcomeBubble = addBubble("bot", t("chat.welcome"));

  const chips = document.createElement("div");
  chips.className = "chat-chips";
  chipRefs = [];
  for (const key of ["chat.sugg1", "chat.sugg2", "chat.sugg3"]) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chat-chip";
    chip.textContent = t(key);
    chip.addEventListener("click", () => { chips.remove(); ask(chip.textContent); });
    chips.appendChild(chip);
    chipRefs.push({ chip, key });
  }
  messagesEl.appendChild(chips);
  scrollBottom();
  loadMarkdown(); // warm-up, non-blocking
}

/** Re-renders the dynamic texts when the site language changes
    (the site dispatches a 'cm:lang' event from applyLang). */
function applyLanguage() {
  if (welcomeBubble && welcomeBubble.isConnected) {
    welcomeBubble.innerHTML = renderContent(t("chat.welcome"));
  }
  for (const { chip, key } of chipRefs) {
    if (chip.isConnected) chip.textContent = t(key);
  }
}
document.addEventListener("cm:lang", applyLanguage);

// --- FAB / panel ---------------------------------------------------------------

function setOpen(open) {
  panel.classList.toggle("open", open);
  fab.classList.toggle("open", open);
  panel.setAttribute("aria-hidden", String(!open));
  if (badge && badge.isConnected) badge.remove();
  if (open) {
    if (!welcomed) welcome();
    input.focus();
  } else if (panel.contains(document.activeElement)) {
    fab.focus(); // keep keyboard navigation coherent
  }
}

fab.addEventListener("click", () => setOpen(!panel.classList.contains("open")));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && panel.classList.contains("open")) setOpen(false);
});

// --- sending ----------------------------------------------------------------------

form.addEventListener("submit", (e) => {
  e.preventDefault();
  ask(input.value.trim());
});

async function ask(question) {
  if (!question || streaming) return;
  streaming = true;
  input.value = "";
  input.disabled = true;
  sendBtn.disabled = true;

  addBubble("user", question);

  // Typing indicator, shown until the first token arrives
  const typing = document.createElement("div");
  typing.className = "chat-msg bot";
  const dots = document.createElement("span");
  dots.className = "typing-dots";
  for (let i = 0; i < 3; i++) dots.appendChild(document.createElement("span"));
  typing.appendChild(dots);
  messagesEl.appendChild(typing);
  scrollBottom();

  let bubble = null;
  let bubbleText = "";
  const removeTyping = () => { if (typing.isConnected) typing.remove(); };

  try {
    const backend = await loadBackend();
    await backend.sendMessage(question, {
      onToken(token) {
        removeTyping();
        if (!bubble) {
          bubble = addBubble("bot");
          bubble.classList.add("streaming");
        }
        bubbleText += token;
        bubble.innerHTML = renderContent(bubbleText);
        scrollBottom();
      },
      onError(msg) {
        removeTyping();
        if (bubble) bubble.classList.remove("streaming");
        addBubble("bot", msg ? `⚠️ ${msg}` : t("chat.error"));
      },
      onDone() {
        removeTyping();
        if (bubble) bubble.classList.remove("streaming");
      },
    });
  } catch (err) {
    // chat.js missing or failed: the widget stays usable
    removeTyping();
    addBubble("bot", t("chat.error"));
  } finally {
    removeTyping();
    streaming = false;
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
    scrollBottom();
  }
}

// Defensive: in case data-lucide icons are ever added to dynamic content
try { if (window.lucide) window.lucide.createIcons(); } catch { /* CDN unavailable */ }
