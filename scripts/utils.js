// Shared helpers for the build scripts. ESM ("type": "module").
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Absolute path to the project root (one level up from /scripts).
export const ROOT = path.resolve(__dirname, "..");
export const RAW_SVGS_DIR = path.join(ROOT, "raw-svgs");
export const ICONS_OUT_DIR = path.join(ROOT, "src", "icons");
export const SRC_DIR = path.join(ROOT, "src");
export const DOCS_DIR = path.join(ROOT, "docs");
export const MANIFEST_PATH = path.join(ICONS_OUT_DIR, "manifest.json");

// The six Phosphor weights and how each is suffixed in Phosphor's asset repo.
// "regular" has no suffix in Phosphor; we normalise everything to a suffix.
export const WEIGHTS = ["thin", "light", "regular", "bold", "fill", "duotone"];

// "airplane-in-flight" -> "AirplaneInFlight". Guards against a leading digit
// (not valid as the start of a JS identifier) by prefixing "Icon".
export function toPascalCase(name) {
  const pascal = name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return /^[0-9]/.test(pascal) ? `Icon${pascal}` : pascal;
}

// Pull the inner markup out of an <svg>…</svg> string. Phosphor SVGs contain
// only <path> elements whose attributes (`d`, `opacity`) are already valid
// JSX, so the extracted string can be spliced into a component verbatim.
export function extractSvgInner(svg) {
  const match = svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>\s*$/i);
  if (!match) {
    throw new Error("Could not find an <svg>…</svg> wrapper to extract from.");
  }
  return match[1].trim();
}

// A centerline icon carries at most this many paths — one per disconnected line
// (a clock is a ring plus its hands; a TV remote is a body plus its buttons).
// Matches MAX_PATHS in sh-icon-genie, which enforces the same ceiling upstream.
export const MAX_CENTERLINE_PATHS = 8;

// AI-generated (stroke-based) icons ship as one "<name>.centerline.svg" holding
// up to MAX_CENTERLINE_PATHS <path d="…"> elements and no paint attributes.
// Returns those path strings,
// or null when the icon is a normal hand-drawn six-weight set. Throws if the file
// exists but is malformed.
//
// The paths are expected to sit on the 256 grid with no wrapping transform: the
// weights are derived by varying stroke-width, so a residual scale would make one
// icon's "bold" thicker than another's.
export function centerlinePaths(dir, name) {
  const file = path.join(dir, `${name}.centerline.svg`);
  if (!fs.existsSync(file)) return null;
  const svg = fs.readFileSync(file, "utf8");
  if (/<g\b|\btransform=/i.test(svg)) {
    throw new Error(
      `${name}.centerline.svg has a transform. Bake it into the path coordinates ` +
        `so every weight strokes at the same apparent width.`,
    );
  }
  const paths = [...svg.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);
  if (paths.length === 0) {
    throw new Error(`${name}.centerline.svg has no <path d="…">.`);
  }
  if (paths.length > MAX_CENTERLINE_PATHS) {
    throw new Error(
      `${name}.centerline.svg has ${paths.length} paths; the limit is ${MAX_CENTERLINE_PATHS}.`,
    );
  }
  return paths;
}
