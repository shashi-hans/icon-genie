// Deriving the six weights of a stroke-based icon from its centerline paths, for
// the two pages served out of this directory. They have no bundler, so a module
// they can import has to live here beside them.
//
// Three copies of these widths exist, one per runtime, and they must agree:
//   src/strokeWeights.ts        the published React library (TypeScript)
//   scripts/derive-weights.js   the build and the API (Node)
//   this file                   docs/index.html and docs/admin.html (browser)
//
// Emits raw SVG inner markup, which is what both pages render with innerHTML.
export const STROKE_WIDTHS = { thin: 9, regular: 18 };

function stroked(paths, w) {
  return paths
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
    )
    .join("");
}

function filled(paths, opacity) {
  const op = opacity == null ? "" : ` opacity="${opacity}"`;
  return paths.map((d) => `<path d="${d}" fill="currentColor"${op}/>`).join("");
}

/**
 * Centerline paths -> { thin, regular, fill, duotone } inner markup.
 * Accepts a bare string for a single-path icon.
 */
export function deriveWeightInner(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  return {
    thin: stroked(list, STROKE_WIDTHS.thin),
    regular: stroked(list, STROKE_WIDTHS.regular),
    fill: filled(list),
    duotone: filled(list, 0.2) + stroked(list, STROKE_WIDTHS.regular),
  };
}
