// Shared helpers for the build scripts. ESM ("type": "module").
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
