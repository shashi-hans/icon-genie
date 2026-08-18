// Derivation of the four weights from centerline paths for everything running on
// Node: generate-index.js filling docs/icons.json, and server/lib/icons.js
// building a catalogue entry from an approved submission. Emits raw SVG inner
// markup (both consumers render it as markup, not as React).
//
// Three copies of these widths exist, one per runtime, and they must agree:
// this file (Node), src/strokeWeights.ts with src/StrokeIcon.tsx (the published
// React library), and docs/stroke-weights.js (the two gallery pages).
export const STROKE_WIDTHS = { thin: 9, regular: 18 };

function stroked(paths, w) {
  return paths
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
}

function filled(paths, opacity) {
  const op = opacity == null ? "" : ` opacity="${opacity}"`;
  return paths.map((d) => `<path d="${d}" fill="currentColor"${op}/>`).join("");
}

// 1–4 centerline paths -> { thin, regular, fill, duotone } inner
// SVG markup. Accepts a bare string for a single-path icon.
export function deriveWeightInner(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  return {
    thin: stroked(list, STROKE_WIDTHS.thin),
    regular: stroked(list, STROKE_WIDTHS.regular),
    fill: filled(list),
    duotone: filled(list, 0.2) + stroked(list, STROKE_WIDTHS.regular),
  };
}
