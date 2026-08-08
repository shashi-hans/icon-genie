// Apparent line thickness (in 256-grid units) for each stroke-derived weight.
// AI-generated icons are a single centerline path rendered at these widths, so
// one drawing yields all six Phosphor weights (fill/duotone handled separately).
// Keep in sync with scripts/derive-weights.js (the docs/build-time copy).
export const STROKE_WIDTHS: Record<"thin" | "light" | "regular" | "bold", number> = {
  thin: 9,
  light: 13,
  regular: 18,
  bold: 27,
};
