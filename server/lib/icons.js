// The icon catalogue the gallery reads from.
//
// Built icons are seeded from docs/icons.json, which `npm run build:icons`
// generates from raw-svgs/. Git stays the source of truth for artwork; this is
// the serving copy. Approved contributions are added on top, which is what makes
// an approval visible immediately instead of at the next build.
//
// Two shapes are served, because the full catalogue is ~4.4 MB of path markup
// and the gallery only needs one weight to paint the grid:
//
//   summary  every icon, regular weight only  (~1/6 the bytes)
//   full     every icon, all six weights
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

// server/lib -> server -> repo root
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEED = join(ROOT, "docs", "icons.json");

export const WEIGHTS = ["thin", "light", "regular", "bold", "fill", "duotone"];

/** Read the built catalogue. Returns [] when the build has not run yet. */
export function readSeed() {
  try {
    const data = JSON.parse(readFileSync(SEED, "utf8"));
    return Array.isArray(data.icons) ? data.icons : [];
  } catch {
    return [];
  }
}

/** Strip an icon down to the regular weight for the first, fast payload. */
export function toSummary(icon) {
  const entry = {
    name: icon.name,
    component: icon.component,
    regular: icon.weights?.regular ?? "",
  };
  // Only community icons carry these, and the gallery needs them to show the
  // credit and the admin controls.
  if (icon.contributed) {
    entry.contributed = true;
    entry.contributor = icon.contributor || "Anonymous";
    entry.submissionId = icon.submissionId ?? null;
  }
  return entry;
}

/** Derive the six weights of a stroke-based icon from its centerline paths. */
export function deriveWeightInner(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  const stroked = (w) =>
    list
      .map(
        (d) =>
          `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`,
      )
      .join("");
  const filled = (opacity) =>
    list
      .map((d) => `<path d="${d}" fill="currentColor"${opacity == null ? "" : ` opacity="${opacity}"`}/>`)
      .join("");
  // Widths match src/strokeWeights.ts and scripts/derive-weights.js, so what the
  // gallery shows is what the React component renders.
  return {
    thin: stroked(9),
    light: stroked(13),
    regular: stroked(18),
    bold: stroked(27),
    fill: filled(),
    duotone: filled(0.2) + stroked(18),
  };
}

/** Build a catalogue entry from an approved submission. */
export function iconFromSubmission(submission) {
  return {
    name: submission.name,
    component: toPascalCase(submission.name),
    kind: "stroke",
    contributed: true,
    contributor: submission.contributor || "Anonymous",
    submissionId: submission.id,
    centerline: submission.paths,
    weights: deriveWeightInner(submission.paths),
  };
}

/** "airplane-in-flight" -> "AirplaneInFlight", guarding a leading digit. */
export function toPascalCase(name) {
  const pascal = String(name)
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return /^[0-9]/.test(pascal) ? `Icon${pascal}` : pascal || "Icon";
}
