// Pulls a site's theme colours out of its HTML.
//
// Reads only what the page itself carries: inline <style> blocks, style
// attributes, and the colour-bearing meta tags. External stylesheets are not
// followed — that would be several more fetches per request, and in practice a
// brand colour is declared as a custom property or repeated often enough in the
// document to be found without them. When a page hides everything in a bundled
// stylesheet the answer is fewer swatches, not a wrong one.
//
// Sources are ranked, not merged, because they are not equally trustworthy:
// a variable literally named --primary-color states the brand colour, while a
// frequency count only observes one.

/** #abc, #aabbcc and #aabbccdd, normalised to #aabbcc. */
const HEX_RE = /#([0-9a-fA-F]{3,8})\b/g;
const RGB_RE = /rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/g;
// A custom property whose name says it holds a colour. Anything else may be a
// spacing or font token that happens to parse as a colour.
const COLOR_VAR_RE = /--([a-zA-Z0-9-]*(?:color|colour|brand|primary|accent|theme)[a-zA-Z0-9-]*)\s*:\s*([^;}]+)/gi;

/** Normalise any supported notation to #rrggbb, or null. */
function toHex(raw) {
  const value = String(raw).trim().toLowerCase();
  const hex = value.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const h = hex[1];
    // 3 and 4 are shorthand, the 4th digit being alpha; 6 and 8 are full, the
    // last pair alpha. Alpha is dropped either way — the swatch is the hue, and a
    // site's brand colour is not less its brand for being drawn at 80%.
    if (h.length === 3 || h.length === 4) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    if (h.length === 6 || h.length === 8) return `#${h.slice(0, 6)}`;
    // 5 and 7 are not valid CSS hex.
    return null;
  }
  const rgb = value.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/);
  if (rgb) {
    const parts = rgb.slice(1, 4).map(Number);
    if (parts.some((n) => n > 255)) return null;
    return `#${parts.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** Relative luminance, per WCAG. */
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 0 for grey, 1 for a fully saturated hue. */
function saturation(hex) {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Whether a colour can carry an icon on this gallery.
 *
 * Near-white and near-black are dropped: they are page background and body text
 * on almost every site, so they crowd out the brand colour without describing
 * it. Greys go too — an icon rendered in #888 tells you nothing about the site.
 * The contrast floor is against white, the gallery's own background.
 */
function isUsable(hex) {
  const lum = luminance(hex);
  // No upper bound here: the 3:1 contrast test below already refuses anything
  // above ~0.30, so a `lum > 0.75` arm could never be reached.
  if (lum < 0.02) return false;
  if (saturation(hex) < 0.15) return false;
  // 3:1 against white, the large-graphic threshold in WCAG. An icon lighter than
  // this is not legible on the gallery's background.
  return (1.05 / (lum + 0.05)) >= 3;
}

/** Rough perceptual distance, enough to drop two shades of the same brand red. */
function tooClose(a, b) {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) < 60;
}

/** Every inline <style> block plus every style="" attribute, as one string. */
function inlineCss(html) {
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const attrs = [...html.matchAll(/\sstyle=("|')([\s\S]*?)\1/gi)].map((m) => m[2]);
  return styles.concat(attrs).join("\n");
}

/**
 * Extract ranked theme colours from a page.
 *
 * Returns at most `limit` swatches, best first, each with the source that found
 * it so the caller can say why. An empty list is a valid answer for a page that
 * keeps its colours in an external bundle.
 */
export function extractPalette(html, limit = 5) {
  const css = inlineCss(html);
  // score -> higher wins. Ties break on how often the colour appears.
  const found = new Map(); // hex -> { hex, source, score, count }

  const add = (raw, source, score) => {
    const hex = toHex(raw);
    if (!hex || !isUsable(hex)) return;
    const existing = found.get(hex);
    if (!existing) {
      found.set(hex, { hex, source, score, count: 1 });
      return;
    }
    existing.count += 1;
    if (score > existing.score) {
      existing.score = score;
      existing.source = source;
    }
  };

  // 1. A custom property named for a colour states the site's intent.
  for (const m of css.matchAll(COLOR_VAR_RE)) {
    const name = m[1].toLowerCase();
    // --primary-color outranks --border-color: both are declared, only one is
    // the brand.
    const primary = /primary|brand|accent|theme/.test(name);
    add(m[2], `--${m[1]}`, primary ? 100 : 60);
  }

  // 2. The tags a site sets so browsers and app launchers can paint chrome in
  //    its colour. Deliberate, but often only one and sometimes just white.
  for (const m of html.matchAll(/<meta[^>]+name=("|')theme-color\1[^>]*>/gi)) {
    const content = m[0].match(/content=("|')([^"']+)\1/i);
    if (content) add(content[2], "theme-color", 90);
  }

  // 3. Everything else the document mentions, ranked by how often. Observed
  //    rather than declared, so it scores below the two above.
  for (const m of html.matchAll(HEX_RE)) add(`#${m[1]}`, "frequency", 10);
  for (const m of html.matchAll(RGB_RE)) add(`rgb(${m[1]},${m[2]},${m[3]})`, "frequency", 10);

  const ranked = [...found.values()].sort((a, b) => b.score - a.score || b.count - a.count);

  // Drop shades of one already chosen, so the list is five different colours
  // rather than five reds.
  const out = [];
  for (const swatch of ranked) {
    if (out.some((kept) => tooClose(kept.hex, swatch.hex))) continue;
    out.push(swatch);
    if (out.length === limit) break;
  }
  return out;
}
