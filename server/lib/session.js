// Cookie-backed identity for two roles.
//
//   admin — signed session cookie, issued only by /api/auth/login against
//           ADMIN_PASSWORD. Required by every admin endpoint.
//   guest — a signed, opaque id minted on first visit. It is an identifier, not
//           a credential: it grants nothing beyond reading back the history
//           filed under it, so a forged one is worthless.
//
// Both cookies are signed with SESSION_SECRET (HMAC-SHA256) and both are
// HttpOnly, so page scripts cannot read them and an XSS cannot exfiltrate a
// session. The signature is what makes them trustworthy — cookie values arrive
// from the client and are attacker-controlled until verified.
//
// Guest history is keyed by the cookie rather than held in it because a cookie
// caps at ~4KB and rides along on every request; icon path data would blow that
// immediately.
// Imported for its side effect: populates process.env from .env / .env.local so
// SESSION_SECRET and ADMIN_PASSWORD resolve outside `vercel dev` too. Every
// handler imports this module, so the load happens exactly once per process.
import "./env.js";
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";

const ADMIN_COOKIE = "sh_admin";
const GUEST_COOKIE = "sh_guest";
const ADMIN_TTL_S = 12 * 60 * 60; // 12h — an admin session should not be forever
const GUEST_TTL_S = 180 * 24 * 60 * 60; // 180d — history is only useful if it lasts

const b64u = (buf) => Buffer.from(buf).toString("base64url");

/**
 * The signing key. Absent in production is fatal, not a warning: unsigned
 * cookies would let anyone hand us `role=admin`. In development we derive an
 * ephemeral key so the app runs, which also invalidates sessions on restart.
 */
function secret() {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is not set. Refusing to sign sessions with a known key.");
  }
  globalThis.__shDevSecret ??= randomBytes(32).toString("hex");
  return globalThis.__shDevSecret;
}

function sign(payload) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Wrap a payload object as `<base64url-json>.<signature>`. */
function seal(obj) {
  const body = b64u(JSON.stringify(obj));
  return `${body}.${sign(body)}`;
}

/** Verify and decode a sealed token. Returns null on any tampering or expiry. */
function unseal(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const idx = token.lastIndexOf(".");
  const body = token.slice(0, idx);
  const provided = token.slice(idx + 1);
  const expected = sign(body);
  // Compare digests so the buffers are always equal length; timingSafeEqual
  // throws on a length mismatch, which would itself leak information.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(a, b)) return null;
  let obj;
  try {
    obj = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof obj?.exp !== "number" || obj.exp * 1000 < Date.now()) return null;
  return obj;
}

/** Parse a Cookie header into a plain object. */
function parseCookies(req) {
  const header = req.headers?.cookie;
  if (!header) return {};
  /** @type {Record<string,string>} */
  const out = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    if (!out[key]) out[key] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function cookieAttrs(maxAge) {
  const attrs = [`Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${maxAge}`];
  // Secure would make the cookie unusable over plain-HTTP localhost.
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs.join("; ");
}

function appendCookie(res, cookie) {
  const existing = res.getHeader("Set-Cookie");
  const list = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  res.setHeader("Set-Cookie", [...list, cookie]);
}

/** True when the request carries a valid admin session. */
export function isAdmin(req) {
  const token = parseCookies(req)[ADMIN_COOKIE];
  return unseal(token)?.role === "admin";
}

export function startAdminSession(res) {
  const exp = Math.floor(Date.now() / 1000) + ADMIN_TTL_S;
  const token = seal({ role: "admin", exp });
  appendCookie(res, `${ADMIN_COOKIE}=${token}; ${cookieAttrs(ADMIN_TTL_S)}`);
}

export function endAdminSession(res) {
  appendCookie(res, `${ADMIN_COOKIE}=; ${cookieAttrs(0)}`);
}

/**
 * The caller's guest id, minting and setting one if absent. Always returns an
 * id, so history works on a first visit without a round trip.
 */
export function ensureGuestId(req, res) {
  const existing = unseal(parseCookies(req)[GUEST_COOKIE]);
  if (existing?.sub) return existing.sub;
  const sub = randomBytes(16).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + GUEST_TTL_S;
  appendCookie(res, `${GUEST_COOKIE}=${seal({ sub, exp })}; ${cookieAttrs(GUEST_TTL_S)}`);
  return sub;
}

/**
 * Verify an admin password against ADMIN_PASSWORD in constant time.
 *
 * This is one shared credential, not per-person accounts: it gives no audit
 * trail of who acted, and revoking access means rotating it for everyone. That
 * is an acceptable interim for a private review queue and the wrong answer for
 * more than a couple of admins — the upgrade is an identity provider (GitHub
 * OAuth fits, since an admin here is already someone who merges the icon PRs).
 */
export function checkAdminPassword(candidate) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { ok: false, reason: "unconfigured" };
  if (typeof candidate !== "string" || !candidate) return { ok: false, reason: "invalid" };
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return { ok: timingSafeEqual(a, b), reason: "invalid" };
}
