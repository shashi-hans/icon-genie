// GET /api/icons      one page of icons, all weights, optionally filtered
// GET /api/icons/all   the same, kept for callers that already use the path
//
// Both are paged. The catalogue passed 8,000 icons, and serving it whole meant a
// 25 MB response — over the body limit a serverless function will return, and
// more DOM than a browser will paint. So the page size and the search both moved
// here: the client asks for the slice it can draw, and the filter runs against
// the in-memory catalogue instead of shipping everything so the client can
// discard most of it.
//
// A page carries every weight, which is why there is no longer a second request
// for the full set: at these page sizes the difference is a few hundred KB, and
// the weight selector and the detail dialog work the moment the grid paints.
//
// Public: these are the icons the site exists to hand out. The response carries
// no submission detail beyond the credit a contributor asked to have shown.
import { handler, json, methodIs } from "../lib/http.js";
import { getStore } from "../lib/store.js";
import { WEIGHTS } from "../lib/icons.js";

const DEFAULT_LIMIT = 120;
// A page of this many icons with every weight is roughly 1.2 MB, which leaves
// headroom under the response cap. The client asks for what its viewport needs,
// well under this; the ceiling is here to stop a hand-written request from
// asking for the whole catalogue again.
const MAX_LIMIT = 400;
const MAX_QUERY_CHARS = 60;

function intParam(value, fallback, min, max) {
  const n = Number.parseInt(Array.isArray(value) ? value[0] : value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

// Folded component names, memoised per icon. Every keystroke searches the whole
// catalogue, and lowercasing 8,468 names per request was most of what the filter
// cost. A WeakMap rather than a field on the icon: these objects are serialised
// straight into the response, so anything added to them would ship to the client,
// and entries here are collected with the catalogue they came from.
const folded = new WeakMap();

function foldedComponent(icon) {
  let value = folded.get(icon);
  if (value === undefined) {
    value = icon.component.toLowerCase();
    folded.set(icon, value);
  }
  return value;
}

/** Substring match on the icon name and its component name, case-insensitive. */
function search(icons, q) {
  if (!q) return icons;
  // Names are kebab-case already, so only the component name needs folding.
  return icons.filter((icon) => icon.name.includes(q) || foldedComponent(icon).includes(q));
}

async function page(req, res) {
  const query = req.query ?? {};
  const q = String(Array.isArray(query.q) ? query.q[0] : (query.q ?? ""))
    .trim()
    .toLowerCase()
    .slice(0, MAX_QUERY_CHARS);
  const limit = intParam(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);

  const all = await getStore().listIcons();
  const matched = search(all, q);

  // Clamped to the start of the last full page so an offset past the end returns
  // that page, rather than an empty grid the user has to page back out of or the
  // single trailing icon a clamp to the result count would give.
  const maxOffset = Math.max(0, matched.length - limit);
  const offset = Math.min(intParam(query.offset, 0, 0, Number.MAX_SAFE_INTEGER), maxOffset);

  return json(res, 200, {
    icons: matched.slice(offset, offset + limit),
    weights: WEIGHTS,
    total: matched.length,
    catalogueTotal: all.length,
    offset,
    limit,
    q,
    detail: "all",
  });
}

export const list = handler(async (req, res) => {
  if (!methodIs(req, res, "GET")) return;
  return page(req, res);
});

export const all = handler(async (req, res) => {
  if (!methodIs(req, res, "GET")) return;
  return page(req, res);
});
