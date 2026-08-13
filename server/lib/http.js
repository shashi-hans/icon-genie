// Request/response plumbing shared by the API handlers.
import { isAdmin } from "./session.js";

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  // These endpoints are per-session; a shared cache must never serve one
  // caller's submissions or history to another.
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

/** Enforce the allowed methods, answering with 405 and an Allow header. */
export function methodIs(req, res, ...allowed) {
  if (allowed.includes(req.method)) return true;
  res.setHeader("allow", allowed.join(", "));
  json(res, 405, { error: `Method ${req.method} not allowed.` });
  return false;
}

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Read and parse a JSON body, capped so a large upload cannot be used to burn
 * memory or function time. Vercel may have parsed it already, in which case
 * req.body is used as-is.
 */
export async function readJson(req) {
  if (req.body != null && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new HttpError(400, "Invalid JSON body.");
    }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

/** An error carrying the status to report. Anything else becomes a 500. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Wrap a handler so thrown errors become responses. Unexpected errors are logged
 * server-side and reported as a bare 500 — an internal message could name a
 * table, a path, or a config key.
 */
export function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) return json(res, err.status, { error: err.message });
      console.error("api error:", err);
      json(res, 500, { error: "Internal error." });
    }
  };
}

/** 403 unless the caller holds a valid admin session. */
export function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  json(res, 403, { error: "Admin session required." });
  return false;
}

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0];
  return (first || req.socket?.remoteAddress || "unknown").trim();
}

// Per-IP attempt counters for the login route. In-memory, so on serverless this
// is per-instance and an attacker spread across instances gets more attempts
// than the number suggests. It raises the cost of online guessing; it is not a
// substitute for a strong ADMIN_PASSWORD. Move it to the database (or a KV) with
// the rest of the storage layer for a limit that actually holds.
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function loginThrottled(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

/** Called on success so a legitimate admin is not locked out by earlier typos. */
export function clearLoginThrottle(ip) {
  attempts.delete(ip);
}
