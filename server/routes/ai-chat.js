// POST /api/ai/chat/completions
//
// A narrow relay in front of the free hosted model, so "Free (no setup)" in the
// gallery works without a key. The page calls this same-origin path; this
// handler makes the cross-origin call.
//
// Why a relay and not a direct browser call: the upstream worker answers no
// preflight and sends no access-control-allow-origin, so a browser cannot read
// its response at all. A relay is also the only version that keeps working if
// the upstream ever needs a key, since the key stays server-side.
//
// The request and response shapes are OpenAI chat-completions, which is what
// sh-icon-genie's callOpenAICompat already speaks. That is deliberate: the
// prompt, the JSON parsing, the path-count and coordinate gate all stay in the
// bundled generator the page already runs for the bring-your-own-key source, so
// free mode and key mode differ by exactly one thing — who pays. Nothing about
// icons is duplicated here.
//
// What this is NOT: an open pass-through. The model, token ceiling, and
// temperature are pinned server-side and the client's values for them are
// dropped; only `messages` and a JSON `response_format` cross. The upstream URL
// comes from the environment and never from the request, so no caller can aim
// this at an internal address.
//
// It is still an unauthenticated endpoint that spends someone's model quota, and
// a caller can put any text in `messages` — the same exposure the upstream
// already has open to the internet, now also reachable through this origin. The
// per-IP limit below is what stands in the way; it is a speed bump, not a
// control. Requiring a session, or moving the limit into a shared store, is the
// upgrade if this is ever abused.
import { handler, json, methodIs, readJson, HttpError, clientIp } from "../lib/http.js";

const DEFAULT_BASE = "https://icon-genie-proxy.shashihans.workers.dev/v1";
const DEFAULT_MODEL = "@cf/qwen/qwen2.5-coder-32b-instruct";

// One icon fits in far less; the ceiling is here so a single call cannot be
// turned into a long generation.
const MAX_TOKENS = 2000;
const MAX_MESSAGES = 4;
const MAX_PROMPT_CHARS = 16000;
const UPSTREAM_TIMEOUT_MS = 12_000; // under the 15s function limit, so we answer

const ROLES = new Set(["system", "user", "assistant"]);

/**
 * The pinned upstream, with any trailing slash removed. https only, the one
 * exception being loopback, so a worker running on this machine can be tested
 * without a certificate. A bad value is a misconfiguration and not a caller
 * error, so it fails loudly rather than sending the prompt somewhere unencrypted.
 */
function upstreamUrl() {
  const base = (process.env.FREE_MODEL_BASE || DEFAULT_BASE).trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new HttpError(503, "The free model is not configured correctly.");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new HttpError(503, "The free model is not configured correctly.");
  }
  return `${base}/chat/completions`;
}

/** Keep only well-formed messages, and only as many as an icon prompt needs. */
function cleanMessages(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "No messages supplied.");
  }
  if (value.length > MAX_MESSAGES) {
    throw new HttpError(400, `Too many messages (limit ${MAX_MESSAGES}).`);
  }
  const messages = value.map((m) => {
    const role = String(m?.role ?? "");
    if (!ROLES.has(role)) throw new HttpError(400, `Unsupported message role "${role}".`);
    const content = m?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new HttpError(400, "A message has no text content.");
    }
    return { role, content };
  });
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  if (chars > MAX_PROMPT_CHARS) {
    throw new HttpError(413, `Prompt too long (limit ${MAX_PROMPT_CHARS} characters).`);
  }
  return messages;
}

// Per-IP call counters. In-memory, so on serverless this is per-instance and a
// caller spread across instances gets more calls than the number suggests. Same
// limitation as the login throttle, and the same fix: move it to the storage
// layer once that is a real database or KV.
const calls = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_CALLS = 6;

function throttled(ip) {
  const now = Date.now();
  const rec = calls.get(ip);
  if (!rec || now > rec.resetAt) {
    calls.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    // Drop expired buckets while we are here, so a long-lived instance does not
    // hold an entry per IP that ever called.
    if (calls.size > 5000) {
      for (const [key, val] of calls) if (now > val.resetAt) calls.delete(key);
    }
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_CALLS;
}

export default handler(async (req, res) => {
  if (!methodIs(req, res, "POST")) return;

  if (throttled(clientIp(req))) {
    res.setHeader("retry-after", String(WINDOW_MS / 1000));
    throw new HttpError(429, "Too many generations. Wait a minute, or use your own API key.");
  }

  const body = await readJson(req);
  const messages = cleanMessages(body.messages);

  // Rebuilt from scratch rather than spread from the request: a field nobody
  // vetted must not reach the model provider.
  const payload = {
    model: (process.env.FREE_MODEL || DEFAULT_MODEL).trim(),
    max_tokens: MAX_TOKENS,
    temperature: 0.3,
    messages,
  };
  // Honoured only in the one shape the generator asks for. Providers that reject
  // it answer 400, and the caller retries without it.
  if (body.response_format?.type === "json_object") {
    payload.response_format = { type: "json_object" };
  }

  const headers = { "content-type": "application/json" };
  // Optional: the default upstream needs no key. One set here is never exposed
  // to the page, which is the point of relaying at all.
  const key = process.env.FREE_MODEL_KEY?.trim();
  if (key) headers.authorization = `Bearer ${key}`;

  let upstream;
  try {
    upstream = await fetch(upstreamUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    // Includes the timeout. The upstream host is left out of the response: the
    // caller can do nothing with it, and it is in the server's log already.
    console.error("free model unreachable:", err);
    throw new HttpError(502, "The free model did not respond. Try again shortly.");
  }

  const text = await upstream.text();
  // Status and body pass through unchanged so the caller's own handling of 429
  // and 5xx still applies, and an upstream error message survives to the page.
  res.statusCode = upstream.status;
  res.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(text);
});
