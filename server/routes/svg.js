// GET /api/svg/<name>.svg[?weight=]   one icon, as a standalone SVG file
//
// This is the plain-HTML path: <img src=".../api/svg/heart.svg">, a CSS
// background, an <object>, or the <icon-genie> web component. None of it needs
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
import { WEIGHTS, innerFor } from "../lib/icons.js";

// A year: the artwork behind a given name and weight does not change without a
// rebuild, and a rebuild is a deploy.
const CACHE = "public, max-age=31536000, immutable";
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]{3,20}$|^rgba?\([\d\s.,%]+\)$/;

/**
 * Split "heart-fill.svg" into an icon and a weight, against a catalogue already
 * in hand.
 *
 * An icon may itself end in something that looks like a weight — "light-bulb-off"
 * next to a "fill" weight, or a real icon called "cloud-fill" — so a name that
 * exists as-is always wins over the suffix reading.
 */
function resolve(icons, file) {
  const stem = file.replace(/\.svg$/i, "");
  const exact = icons.find((icon) => icon.name === stem);
  if (exact) return { icon: exact, weight: "regular" };
  for (const weight of WEIGHTS) {
    if (!stem.endsWith(`-${weight}`)) continue;
    const name = stem.slice(0, -(weight.length + 1));
    const hit = icons.find((icon) => icon.name === name);
    if (hit) return { icon: hit, weight };
  }
  return null;
}

export default handler(async (req, res) => {
  if (!methodIs(req, res, "GET")) return;

  const asked = String(req.query?.weight ?? "").trim();
  if (asked && !WEIGHTS.includes(asked)) {
    throw new HttpError(400, `Unknown weight "${asked}". Use ${WEIGHTS.join(", ")}.`);
  }
  const color = String(req.query?.color ?? "").trim();
  if (color && !COLOR_RE.test(color)) {
    throw new HttpError(400, "Unrecognised colour.");
  }

  // One catalogue read answers both the lookup and the markup. It is the
  // catalogue rather than a membership check so a hidden icon is not reachable
  // by direct link, and reading it once costs one query instead of the five a
  // suffix search used to make.
  const hit = resolve(await getStore().listIcons(), String(req.query?.file ?? ""));
  if (!hit) throw new HttpError(404, "No such icon.");

  const weight = asked || hit.weight;
  // Derived here for this one icon when it is a stroke icon, rather than for all
  // 4,053 of them when the catalogue loads.
  const inner = innerFor(hit.icon, weight);
  const fill = color || "currentColor";
  // `color` as well as `fill`, because the two kinds of icon take their paint
  // from different places. A drawn icon's paths carry no paint attribute and
  // inherit `fill`; a stroke-derived one paints with stroke="currentColor" and
  // fill="currentColor" per path (scripts/derive-weights.js), which ignores the
  // wrapper's fill entirely. Setting the CSS color property is what makes
  // ?color= reach those, and omitting it when no colour was asked for leaves an
  // inherited one alone.
  const colorAttr = color ? ` color="${color}"` : "";

  const size = Number.parseInt(String(req.query?.size ?? ""), 10);
  const dims = Number.isFinite(size) && size > 0 && size <= 1024 ? ` width="${size}" height="${size}"` : "";

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"${dims} fill="${fill}"${colorAttr}>${inner}</svg>`;

  res.statusCode = 200;
  res.setHeader("content-type", "image/svg+xml; charset=utf-8");
  res.setHeader("cache-control", CACHE);
  // Usable from any origin: this is public artwork, and the point is that a page
  // that is not this one can render it.
  res.setHeader("access-control-allow-origin", "*");
  res.end(svg);
});
