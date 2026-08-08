// Build-time derivation of the six weights from centerline paths, used by
// generate-index.js to fill docs/icons.json for stroke-based (AI) icons. Emits
// raw SVG inner markup (the gallery renders it via innerHTML, not React).
//
// This mirrors src/StrokeIcon.tsx, which does the same derivation at runtime in
// JSX. Keep STROKE_WIDTHS in sync with src/strokeWeights.ts.
export const STROKE_WIDTHS = { thin: 9, light: 13, regular: 18, bold: 27 };

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

// 1–4 centerline paths -> { thin, light, regular, bold, fill, duotone } inner
// SVG markup. Accepts a bare string for a single-path icon.
export function deriveWeightInner(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  return {
    thin: stroked(list, STROKE_WIDTHS.thin),
    light: stroked(list, STROKE_WIDTHS.light),
    regular: stroked(list, STROKE_WIDTHS.regular),
    bold: stroked(list, STROKE_WIDTHS.bold),
    fill: filled(list),
    duotone: filled(list, 0.2) + stroked(list, STROKE_WIDTHS.regular),
  };
}
