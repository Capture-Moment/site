/**
 * Chat widget logic — talks to the RAG API and forwards events to a UI.
 *
 * This layer owns:
 *   - the SSE transport (fetch + stream parsing)
 *   - the conversation history (the server is stateless)
 *   - the event dispatching (token / error / done)
 *
 */

// --- Configuration ---

// The page is served by Live Server (:5500), the API runs on :8000,
const API_URL =  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:8000/api/chat"
    : "https://llm-site.vercel.app/api/chat";

// Must stay in sync with ChatRequest.history.max_length in rag/schemas.py.
const MAX_HISTORY = 20;

// --- Conversation state (owned by the browser) ---

// The server is STATELESS: each request carries the whole conversation.
let history = []; // [{ role: "user" | "assistant", content: "..." }]

function rememberExchange(question, answer) {
  history.push({ role: "user", content: question });
  history.push({ role: "assistant", content: answer });
  // Same trimming rule as the server — belt and suspenders.
  history = history.slice(-MAX_HISTORY);
}

export function resetConversation() {
  history = [];
}

// --- Transport: POST + manual SSE parsing ---

async function fetchStream(question) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: question, history }),
  });

  if (!response.ok) {
    // Error BEFORE the stream: 422 validation, 503 retrieval down...
    throw new Error(`API returned ${response.status}`);
  }
  return response.body.getReader();
}

/**
 * Builds a frame parser. Returns a function to feed with network chunks;
 * it emits complete, parsed SSE events to onEvent.
 *
 * Why a factory? The buffer must survive between chunks — a closure is
 * the JS way of having a 'static' local variable in C.
 */
function makeSSEParser(onEvent) {
  let buffer = "";
  const decoder = new TextDecoder();

  return function handleChunk(bytes) {
    // stream:true handles multi-byte characters split across chunks (UTF-8)
    buffer += decoder.decode(bytes, { stream: true });

    // Frames are separated by a blank line. The last element may be an
    // incomplete frame -> put it back in the buffer for the next chunk.
    const frames = buffer.split("\n\n");
    buffer = frames.pop();

    for (const frame of frames) {
      if (!frame.startsWith("data: ")) continue;
      onEvent(JSON.parse(frame.slice(6))); // strip the "data: " prefix
    }
  };
}

// --- Public API: the single entry point for the future UI ---

export async function sendMessage(question, ui) {
  let answer = "";
  let failed = false;
  let finished = false;

  const handleChunk = makeSSEParser((event) => {
    switch (event.type) {
      case "token":
        answer += event.content;
        ui.onToken(event.content);
        break;

      case "error":
        failed = true;
        ui.onError(event.message);
        break;

      case "done":
        finished = true;
        if (!failed) rememberExchange(question, answer);
        ui.onDone();
        break;

      default:
        console.warn("Unknown SSE event type:", event.type);
    }
  });

  try {
    const reader = await fetchStream(question);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      handleChunk(value);
    }
  } catch (err) {
    ui.onError(err.message);
  } finally {
    // Guarantee the UI unlocks even if the stream died without its
    // "done" event (crash, timeout, network cut).
    if (!finished) ui.onDone();
  }
}
