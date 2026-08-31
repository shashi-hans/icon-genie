// POST /api/theme  { url } -> { site, swatches: [{ hex, source }] }
//
// Reads a public web page and reports the theme colours it declares, so the
// gallery can recolour icons to match a site. Only colours cross: no markup, no
// text, and nothing about the page is stored beyond the short-lived cache below.
//
// The fetch happens here rather than in the browser for two reasons. A page on
// another origin cannot be read by script without CORS, which no site grants.
// And a caller-supplied URL fetched by a server is an SSRF risk that has to be
// controlled somewhere the caller cannot reach — see server/lib/fetch-page.js,
// which is where every guard lives.
//
// Unauthenticated, like the AI relay, and it spends this server's egress on a
// destination the caller picks. The per-IP limit below is the brake. It is a
// speed bump, not a control: requiring a session is the upgrade if it is abused.
import { handler, json, methodIs, readJson, HttpError, clientIp } from "../lib/http.js";
import { fetchPage, robotsAllows } from "../lib/fetch-page.js";
import { extractPalette } from "../lib/palette.js";

const MAX_URL_CHARS = 2000;

// Per-IP call counters. In-memory, so on serverless this is per-instance and a
// caller spread across instances gets more calls than the number suggests. Same
// limitation as the AI relay, and the same fix: move it to the storage layer
// once that is worth doing.
const calls = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_CALLS = 10;

function throttled(ip) {
  const now = Date.now();
  const rec = calls.get(ip);
  if (!rec || now > rec.resetAt) {
    calls.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    if (calls.size > 5000) {
      for (const [key, val] of calls) if (now > val.resetAt) calls.delete(key);
    }
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_CALLS;
}

// A site's palette does not change between two people asking about it a minute
// apart, and re-reading someone's homepage for every click is rude as well as
// slow.
const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

function cached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function remember(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + CACHE_MS });
}

/**
 * Accept what a person would type. "coverfox.com" becomes
 * "https://coverfox.com/"; a path or query is dropped, because this reads a
 * site's homepage and keeping them would make the cache key needlessly specific.
 *
 * A bare host gets https, so the secure form is what a typed name resolves to.
 * Writing "http://" explicitly is honoured for sites that only serve it.
 */
function normalizeUrl(raw) {
  const text = String(raw ?? "").trim();
  if (!text) throw new HttpError(400, "Enter a website address.");
  if (text.length > MAX_URL_CHARS) throw new HttpError(413, "That address is too long.");
  // Rejected here rather than prefixed: "file:///etc/passwd" with https glued on
  // the front becomes a nonsense hostname and fails as "not found", which tells
  // the caller the wrong thing about why.
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^https?:\/\//i.test(text)) {
    throw new HttpError(400, "Only http and https addresses can be read.");
  }
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new HttpError(400, "That is not a valid website address.");
  }
  return `${url.origin}/`;
}

export default handler(async (req, res) => {
  if (!methodIs(req, res, "POST")) return;

  if (throttled(clientIp(req))) {
    res.setHeader("retry-after", String(WINDOW_MS / 1000));
    throw new HttpError(429, "Too many lookups. Wait a minute and try again.");
  }

  const body = await readJson(req);
  const target = normalizeUrl(body.url);

  const hit = cached(target);
  if (hit) return json(res, 200, hit);

  if (!(await robotsAllows(target, "/"))) {
    throw new HttpError(403, "That site asks not to be read automatically.");
  }

  const { html, url } = await fetchPage(target);
  const swatches = extractPalette(html);
  if (swatches.length === 0) {
    // Not an error: a page can legitimately keep every colour in a stylesheet
    // this deliberately does not follow. Say so plainly instead of failing.
    throw new HttpError(
      422,
      "No theme colours found on that page. Its colours are probably in an external stylesheet."
    );
  }

  const payload = { site: new URL(url).host, swatches };
  remember(target, payload);
  return json(res, 200, payload);
});
