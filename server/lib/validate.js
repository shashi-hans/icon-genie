// Server-side validation for submitted icons. The browser already runs the
// generator's own gate before rendering, but that gate protects the page, not
// this API: a submission arrives over HTTP and can be crafted by hand, so
// nothing here trusts it.
//
// The rules are deliberately duplicated rather than imported from
// sh-icon-genie. That package is a devDependency used to build the gallery
// bundle; making it a runtime dependency would add it to the published
// `@shashi-hans/icons` dependency tree, so every consumer of the icon library
// would install an icon generator. Keep these constants in step with
// MAX_PATHS in sh-icon-genie and MAX_CENTERLINE_PATHS in scripts/utils.js.
import { HttpError } from "./http.js";

const PATH_D_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\s+-]+$/;
const MAX_PATHS = 8;
const MAX_PATH_CHARS = 4000;
const MAX_TOTAL_PATH_CHARS = 8000;
const MAX_NAME_CHARS = 60;
const MAX_TEXT_CHARS = 200;
const MAX_CONTRIBUTOR_CHARS = 20;
// A generated icon lives on the 256 grid. Some slack either side allows for a
// stroke that overhangs slightly; anything beyond is not a framed icon.
const COORD_MIN = -64;
const COORD_MAX = 320;

/** kebab-case a display name, or "" when nothing usable survives. */
export function kebabName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME_CHARS);
}

function validatePath(d) {
  if (typeof d !== "string" || !d.trim()) throw new HttpError(422, "A path is empty.");
  const t = d.trim();
  if (t.length > MAX_PATH_CHARS) throw new HttpError(413, "A path is too long.");
  if (!PATH_D_RE.test(t)) throw new HttpError(422, "A path contains illegal characters.");
  if (!/^[Mm]/.test(t)) throw new HttpError(422, "A path must start with a moveto.");
  for (const n of t.match(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/g) ?? []) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < COORD_MIN || v > COORD_MAX) {
      throw new HttpError(422, "A path has coordinates outside the icon grid.");
    }
  }
  return t;
}

/**
 * Validate the `paths` of a submission. Accepts ["d"] and [{d}], the two shapes
 * models produce, plus a bare `d` for a single-path icon.
 */
export function validatePaths(body) {
  const raw = Array.isArray(body?.paths) ? body.paths : body?.d != null ? [body.d] : [];
  if (raw.length === 0) throw new HttpError(422, "No path data supplied.");
  if (raw.length > MAX_PATHS) throw new HttpError(422, `Too many paths (limit ${MAX_PATHS}).`);
  const paths = raw.map((p) => validatePath(typeof p === "string" ? p : p?.d));
  const total = paths.reduce((n, d) => n + d.length, 0);
  if (total > MAX_TOTAL_PATH_CHARS) {
    throw new HttpError(413, `Path data too long (limit ${MAX_TOTAL_PATH_CHARS} characters).`);
  }
  return paths;
}

/** Trim free text to a bounded, single-line string. */
export function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/**
 * The contributor's display name, capped at 20 characters.
 *
 * This one is shown publicly on the icon, so it is deliberately the only piece
 * of self-described identity the API accepts: no email, no handle, nothing that
 * could be used to contact or resolve a person. Control characters are stripped
 * because they render as invisible or direction-flipping text; an empty value
 * becomes "Anonymous" rather than being rejected, so declining to be named is
 * always an option.
 */
export function cleanContributor(value) {
  const cleaned = String(value ?? "")
    // Strip C0/C1 control characters, zero-width characters, and the bidi
    // overrides that let displayed text read in a different order than it is
    // stored. Written as escapes so the rule is readable in review.
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CONTRIBUTOR_CHARS);
  return cleaned || "Anonymous";
}

/**
 * Identity of an icon for the one-submission-per-icon rule: its name plus its
 * summary. The name alone is too coarse — two different drawings can reasonably
 * both be called "shield" — and the paths are too fine, since a regenerated
 * icon differs by a coordinate or two and would slip through as new.
 *
 * Both parts are normalized so trivial differences in case or spacing do not
 * read as a different icon.
 */
export function dedupeKey(name, summary) {
  return `${kebabName(name)}|${cleanText(summary).toLowerCase()}`;
}

const SOURCES = new Set(["hosted", "key", "paste", "unknown"]);

/** Constrain the source label to the known set. */
export function cleanSource(value) {
  const s = String(value ?? "unknown");
  return SOURCES.has(s) ? s : "unknown";
}

/** Assemble validated paths into the geometry-only source file for the repo. */
export function toCenterlineSvg(paths) {
  const inner = paths.map((d) => `<path d="${d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${inner}</svg>\n`;
}
