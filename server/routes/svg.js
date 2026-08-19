// GET /api/svg/<name>.svg[?weight=]   one icon, as a standalone SVG file
//
// This is the plain-HTML path: <img src=".../api/svg/heart.svg">, a CSS
// background, an <object>, or the <sh-icon> web component. None of it needs
// React, a bundler, or the npm package.
//
// The files are served rather than shipped. One SVG per icon per weight is
// 33,872 files and 25 MB, which has no business in a package tarball that is
// already large; fetching one icon costs a few hundred bytes.
//
// `currentColor` is kept, so an <img> renders black (an <img> has no inherited
// colour) while an inline <svg>, an <object>, or a CSS mask follows the text
// colour. Callers that want a fixed colour pass ?color=.
import { handler, methodIs, HttpError } from "../lib/http.js";
import { getStore } from "../lib/store.js";
import { WEIGHTS } from "../lib/icons.js";

// A year: the artwork behind a given name and weight does not change without a
// rebuild, and a rebuild is a deploy.
const CACHE = "public, max-age=31536000, immutable";
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]{3,20}$|^rgba?\([\d\s.,%]+\)$/;

/**
 * Split "heart-fill.svg" into a name and a weight.
 *
 * An icon may itself end in something that looks like a weight — "light-bulb-off"
 * next to a "fill" weight, or a real icon called "cloud-fill" — so a name that
 * exists as-is always wins over the suffix reading.
 */
async function resolve(store, file) {
  const stem = file.replace(/\.svg$/i, "");
  if (await store.hasIcon(stem)) return { name: stem, weight: "regular" };
  for (const weight of WEIGHTS) {
    if (!stem.endsWith(`-${weight}`)) continue;
    const name = stem.slice(0, -(weight.length + 1));
    if (await store.hasIcon(name)) return { name, weight };
  }
  return null;
}

export default handler(async (req, res) => {
  if (!methodIs(req, res, "GET")) return;

  const store = getStore();
  const file = String(req.query?.file ?? "");
  const hit = await resolve(store, file);
  if (!hit) throw new HttpError(404, "No such icon.");

  const asked = String(req.query?.weight ?? "").trim();
  if (asked && !WEIGHTS.includes(asked)) {
    throw new HttpError(400, `Unknown weight "${asked}". Use ${WEIGHTS.join(", ")}.`);
  }
  const weight = asked || hit.weight;

  // Through the catalogue so a hidden icon is not reachable by direct link.
  const icon = (await store.listIcons()).find((i) => i.name === hit.name);
  if (!icon) throw new HttpError(404, "No such icon.");

  const inner = icon.weights?.[weight] ?? icon.weights?.regular ?? "";
  const color = String(req.query?.color ?? "").trim();
  if (color && !COLOR_RE.test(color)) {
    throw new HttpError(400, "Unrecognised colour.");
  }
  const fill = color || "currentColor";

  const size = Number.parseInt(String(req.query?.size ?? ""), 10);
  const dims = Number.isFinite(size) && size > 0 && size <= 1024 ? ` width="${size}" height="${size}"` : "";

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"${dims} fill="${fill}">${inner}</svg>`;

  res.statusCode = 200;
  res.setHeader("content-type", "image/svg+xml; charset=utf-8");
  res.setHeader("cache-control", CACHE);
  // Usable from any origin: this is public artwork, and the point is that a page
  // that is not this one can render it.
  res.setHeader("access-control-allow-origin", "*");
  res.end(svg);
});
