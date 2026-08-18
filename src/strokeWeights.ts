// Apparent line thickness (in 256-grid units) for each stroke-derived weight.
// A centerline icon is one drawing rendered at these widths; fill and duotone are
// handled separately in StrokeIcon.
// Three copies of these widths exist, one per runtime, and they must agree:
// this file (the published React library), scripts/derive-weights.js (the build
// and the API), and docs/stroke-weights.js (the two gallery pages). This one
// cannot import from the others: the package ships it, and a published module
// must not reach into the repo's build scripts.
export const STROKE_WIDTHS: Record<"thin" | "regular", number> = {
  thin: 9,
  regular: 18,
};
