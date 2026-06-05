#!/usr/bin/env node
// One-off generator for ORIGINAL, hand-defined icons that fill gaps the
// Phosphor set does not cover (insurance-specific vehicles/perils). These are
// NOT Phosphor assets — they are constructed here from filled-outline
// primitives parameterised by Phosphor's per-weight stroke widths so the six
// weights stay visually consistent with the rest of the library:
//
//   thin 8 · light 12 · regular 16 · bold 24 · fill solid · duotone tint+regular
//
// Output goes to ./raw-svgs/<icon>/<icon>-<weight>.svg, matching the layout the
// build pipeline (optimize -> generate-components -> generate-index) expects.
//
//   node scripts/draft-gap-icons.js
import fs from "node:fs";
import path from "node:path";
import { RAW_SVGS_DIR, WEIGHTS } from "./utils.js";

const SW = { thin: 8, light: 12, regular: 16, bold: 24, fill: 16, duotone: 16 };

// ---- number / path helpers ------------------------------------------------
const n = (v) => {
  const r = Math.round(v * 10) / 10;
  return (Object.is(r, -0) ? 0 : r).toString();
};

// Full circle, clockwise (CW) — used as the outer ring / a solid disc.
function circleCW(cx, cy, r) {
  return `M${n(cx)} ${n(cy - r)}A${n(r)} ${n(r)} 0 1 1 ${n(cx)} ${n(cy + r)}A${n(r)} ${n(r)} 0 1 1 ${n(cx)} ${n(cy - r)}Z`;
}
// Full circle, counter-clockwise (CCW) — punches a hole under nonzero fill.
function circleCCW(cx, cy, r) {
  return `M${n(cx)} ${n(cy - r)}A${n(r)} ${n(r)} 0 1 0 ${n(cx)} ${n(cy + r)}A${n(r)} ${n(r)} 0 1 0 ${n(cx)} ${n(cy - r)}Z`;
}
const disc = (cx, cy, r) => circleCW(cx, cy, r);
const ring = (cx, cy, R, sw) =>
  circleCW(cx, cy, R) + circleCCW(cx, cy, Math.max(0.5, R - sw));

// Rounded rectangle, clockwise.
function rrectCW(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return (
    `M${n(x + r)} ${n(y)}` +
    `H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}` +
    `V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}` +
    `H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}` +
    `V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}Z`
  );
}
// Rounded rectangle, counter-clockwise (hole).
function rrectCCW(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return (
    `M${n(x + r)} ${n(y)}` +
    `A${n(r)} ${n(r)} 0 0 0 ${n(x)} ${n(y + r)}` +
    `V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 0 ${n(x + r)} ${n(y + h)}` +
    `H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 0 ${n(x + w)} ${n(y + h - r)}` +
    `V${n(y + r)}A${n(r)} ${n(r)} 0 0 0 ${n(x + w - r)} ${n(y)}Z`
  );
}
const rrectSolid = (x, y, w, h, r) => rrectCW(x, y, w, h, r);
function rrectOutline(x, y, w, h, r, sw) {
  return (
    rrectCW(x, y, w, h, r) +
    rrectCCW(x + sw, y + sw, w - 2 * sw, h - 2 * sw, Math.max(1, r - sw))
  );
}

// Round-capped thick segment (a filled capsule), thickness = 2*half. Always
// emitted clockwise so that overlapping capsules union under the nonzero fill
// rule (a direction-dependent winding would punch holes where strokes cross).
function capsule(x1, y1, x2, y2, half) {
  const dx = x2 - x1,
    dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len,
    uy = dy / len;
  let nx = -uy * half,
    ny = ux * half; // left normal * half
  let sweep = 1;
  // Signed area of the [A,B,C,D] hull tells us the winding; flip to keep CW.
  const a =
    (x1 + nx) * (y2 + ny) - (x2 + nx) * (y1 + ny) +
    (x2 + nx) * (y2 - ny) - (x2 - nx) * (y2 + ny) +
    (x2 - nx) * (y1 - ny) - (x1 - nx) * (y2 - ny) +
    (x1 - nx) * (y1 + ny) - (x1 + nx) * (y1 - ny);
  if (a < 0) {
    nx = -nx;
    ny = -ny;
    sweep = 0;
  }
  return (
    `M${n(x1 + nx)} ${n(y1 + ny)}L${n(x2 + nx)} ${n(y2 + ny)}` +
    `A${n(half)} ${n(half)} 0 0 ${sweep} ${n(x2 - nx)} ${n(y2 - ny)}` +
    `L${n(x1 - nx)} ${n(y1 - ny)}` +
    `A${n(half)} ${n(half)} 0 0 ${sweep} ${n(x1 + nx)} ${n(y1 + ny)}Z`
  );
}
// Polyline of round-capped segments + round joins (disc at interior vertices).
function poly(pts, sw) {
  const half = sw / 2;
  let d = "";
  for (let i = 0; i < pts.length - 1; i++) {
    d += capsule(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], half);
  }
  for (let i = 1; i < pts.length - 1; i++) d += disc(pts[i][0], pts[i][1], half);
  return d;
}

// Round-capped arc stroke (fenders, cuffs, hooks): sample the arc, draw as a
// polyline of capsules. Angles in degrees, point = (cx+r·cosθ, cy+r·sinθ),
// so θ=90 is the bottom and θ=270 the top (y-down coordinates).
function arcPts(cx, cy, r, a0, a1) {
  const steps = Math.max(6, Math.round(Math.abs(a1 - a0) / 12));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return pts;
}

// Filled wavy band between x0..x1, centred on yc; sine top & bottom edges.
function waveRibbon(x0, x1, yc, amp, wavelen, sw) {
  const half = sw / 2;
  const steps = Math.max(8, Math.round((x1 - x0) / 6));
  const k = (2 * Math.PI) / wavelen;
  const top = [];
  const bot = [];
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = yc + amp * Math.sin(k * (x - x0));
    top.push([x, y - half]);
    bot.push([x, y + half]);
  }
  let d = `M${n(top[0][0])} ${n(top[0][1])}`;
  for (let i = 1; i < top.length; i++) d += `L${n(top[i][0])} ${n(top[i][1])}`;
  for (let i = bot.length - 1; i >= 0; i--) d += `L${n(bot[i][0])} ${n(bot[i][1])}`;
  d += "Z";
  return d;
}

// Closed polygon path through pts (winding follows point order).
function polyClosed(pts) {
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += `L${n(pts[i][0])} ${n(pts[i][1])}`;
  return d + "Z";
}
// Inset a convex polygon inward (toward its centroid) by sw, via edge offset
// + adjacent-edge intersection. Used to build an even-width quad frame.
function insetPoly(pts, sw) {
  const N = pts.length;
  const cx = pts.reduce((s, p) => s + p[0], 0) / N;
  const cy = pts.reduce((s, p) => s + p[1], 0) / N;
  const lines = [];
  for (let i = 0; i < N; i++) {
    const a = pts[i],
      b = pts[(i + 1) % N];
    let dx = b[0] - a[0],
      dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    let nx = -dy,
      ny = dx; // edge normal
    const mx = (a[0] + b[0]) / 2,
      my = (a[1] + b[1]) / 2;
    if ((mx + nx - cx) ** 2 + (my + ny - cy) ** 2 > (mx - nx - cx) ** 2 + (my - ny - cy) ** 2) {
      nx = -nx;
      ny = -ny; // flip so the normal points inward
    }
    lines.push([a[0] + nx * sw, a[1] + ny * sw, dx, dy]);
  }
  const out = [];
  for (let i = 0; i < N; i++) {
    const [x0, y0, dx0, dy0] = lines[(i - 1 + N) % N];
    const [x1, y1, dx1, dy1] = lines[i];
    const denom = dx0 * dy1 - dy0 * dx1;
    if (Math.abs(denom) < 1e-6) {
      out.push([x1, y1]);
      continue;
    }
    const t = ((x1 - x0) * dy1 - (y1 - y0) * dx1) / denom;
    out.push([x0 + dx0 * t, y0 + dy0 * t]);
  }
  return out;
}

// Shoelace signed area — used to detect when a polygon inset has collapsed
// or flipped (so we fall back to a solid shape instead of a self-intersecting one).
function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

// ---- shape DSL ------------------------------------------------------------
// Each icon is a list of shapes. A shape renders differently for outline
// weights vs. the solid (fill / duotone-tint) pass.
const S = {
  box: (x, y, w, h, r = 12) => ({ k: "box", x, y, w, h, r }),
  win: (x, y, w, h, r = 5) => ({ k: "win", x, y, w, h, r }), // small window/panel
  quadwin: (pts) => ({ k: "quadwin", pts }), // slanted quad window; pts CW [TL,TR,BR,BL]
  quad: (pts) => ({ k: "quad", pts }), // filled quad (solid) / quad frame (outline); pts CW
  coin: (cx, cy, r) => ({ k: "coin", cx, cy, r }), // circular cutout / thin ring
  circ: (cx, cy, r) => ({ k: "circ", cx, cy, r }), // plain circle: solid disc / weight-aware ring
  dline: (pts) => ({ k: "dline", pts }), // thin detail stroke; hidden on the solid (fill) pass
  tline: (pts) => ({ k: "tline", pts }), // thin stroke kept at constant width on every weight
  wheel: (cx, cy, R) => ({ k: "wheel", cx, cy, R }),
  hub: (cx, cy, R) => ({ k: "hub", cx, cy, R }), // always a solid dot
  line: (pts) => ({ k: "line", pts }),
  arc: (cx, cy, r, a0, a1) => ({ k: "line", pts: arcPts(cx, cy, r, a0, a1) }),
  wave: (x0, x1, yc, amp, wl) => ({ k: "wave", x0, x1, yc, amp, wl }),
};

function renderShapes(shapes, sw, solid) {
  let d = "";
  for (const s of shapes) {
    switch (s.k) {
      case "box":
        d += solid ? rrectSolid(s.x, s.y, s.w, s.h, s.r) : rrectOutline(s.x, s.y, s.w, s.h, s.r, sw);
        break;
      case "win":
        // Window reads as a hole in the solid pass, an outline otherwise.
        d += solid ? rrectCCW(s.x, s.y, s.w, s.h, s.r) : rrectOutline(s.x, s.y, s.w, s.h, s.r, Math.min(sw, 8));
        break;
      case "quadwin": {
        // Slanted window: a hole when solid, an even-width quad frame otherwise.
        const cw = s.pts;
        if (solid) {
          d += polyClosed(cw.slice().reverse());
        } else {
          d += polyClosed(cw) + polyClosed(insetPoly(cw, Math.min(sw, 8)).reverse());
        }
        break;
      }
      case "quad": {
        // Solid filled quad, or an outline frame at the current stroke width.
        d += polyClosed(s.pts);
        if (!solid) {
          const inner = insetPoly(s.pts, sw);
          const a0 = signedArea(s.pts);
          const a1 = signedArea(inner);
          // Skip the inner cut when the inset collapsed/flipped (thick weights).
          if (a0 * a1 > 0 && Math.abs(a1) > 16) d += polyClosed(inner.slice().reverse());
        }
        break;
      }
      case "coin":
        d += solid ? circleCCW(s.cx, s.cy, s.r) : ring(s.cx, s.cy, s.r, Math.min(sw, 8));
        break;
      case "circ":
        d += solid ? disc(s.cx, s.cy, s.r) : ring(s.cx, s.cy, s.r, sw);
        break;
      case "dline":
        // Thin interior detail (e.g. a "$"): constant slim width, dropped on fill.
        if (!solid) d += poly(s.pts, Math.min(sw, 9) / 1);
        break;
      case "tline":
        // Delicate stroke (insect legs/wings): constant slim width on every weight.
        d += poly(s.pts, 7);
        break;
      case "wheel":
        d += solid ? disc(s.cx, s.cy, s.R) + circleCCW(s.cx, s.cy, s.R * 0.4) : ring(s.cx, s.cy, s.R, sw);
        break;
      case "hub":
        d += disc(s.cx, s.cy, s.R);
        break;
      case "line":
        d += poly(s.pts, solid ? Math.max(sw, 18) : sw);
        break;
      case "wave":
        d += waveRibbon(s.x0, s.x1, s.yc, s.amp, s.wl, solid ? Math.max(sw, 18) : sw);
        break;
    }
  }
  return d;
}

// ---- icon definitions -----------------------------------------------------
// Note: the `snake` and `mosquito` icons are NOT generated here — they are
// sourced from the group-insurance product art (snake_bite.svg /
// mosquito_borne.svg), recoloured to currentColor and scaled onto the 256 grid
// directly in raw-svgs/snake/ and raw-svgs/mosquito/.
const ICONS = {
  // Caravan / motorhome: tall living box at the rear, a lower cab nose at the front.
  caravan: [
    S.box(80, 58, 148, 110, 16), // living quarters
    S.box(20, 100, 74, 68, 14), // cab
    S.win(34, 110, 30, 28, 6), // cab windshield
    S.win(98, 76, 38, 30, 6), // living window
    S.win(150, 76, 38, 30, 6),
    S.box(150, 118, 30, 50, 5), // door
    S.wheel(86, 176, 20),
    S.wheel(192, 176, 20),
  ],
  // Flatbed truck with a crane mast and a hanging hook.
  "tow-truck": [
    S.box(150, 92, 76, 72, 12), // cab
    S.win(162, 102, 30, 26, 5), // cab window
    S.box(22, 130, 130, 34, 8), // flatbed
    S.line([[150, 130], [150, 70], [44, 102]]), // mast + boom
    S.line([[44, 102], [44, 118]]), // hook drop
    S.arc(38, 120, 8, 300, 520), // hook
    S.wheel(76, 178, 22),
    S.wheel(192, 178, 22),
  ],
  // Quad bike (facing left): two fat tyres with flared fenders, seat, front
  // handlebar, footrest and a rear cargo rack.
  "quad-bike": [
    S.wheel(68, 174, 30), // front wheel
    S.wheel(188, 174, 30), // rear wheel
    S.arc(68, 174, 36, 206, 334), // front fender
    S.arc(188, 174, 36, 206, 334), // rear fender
    S.line([[102, 114], [150, 108], [180, 116]]), // seat / body
    S.line([[102, 114], [80, 82], [58, 82]]), // handlebar (front)
  ],
  // Canopied golf cart.
  "golf-cart": [
    S.line([[62, 48], [194, 48]]), // roof
    S.line([[74, 50], [74, 116]]), // front post
    S.line([[182, 50], [182, 116]]), // rear post
    S.box(52, 114, 152, 52, 12), // body
    S.line([[124, 92], [124, 114]]), // seat back
    S.line([[40, 150], [52, 150]]), // front bumper
    S.wheel(86, 178, 18),
    S.wheel(174, 178, 18),
  ],
  // Ski up front, tracked pod at the rear, cowl and windshield.
  snowmobile: [
    S.line([[10, 202], [150, 202]]), // ski
    S.line([[10, 202], [2, 184]]), // upturned tip
    S.line([[86, 202], [120, 178]]), // strut
    S.box(114, 176, 114, 24, 12), // track pod
    S.hub(140, 188, 5),
    S.hub(170, 188, 5),
    S.hub(200, 188, 5), // track rollers
    S.box(120, 138, 96, 40, 18), // engine cowl / seat
    S.line([[150, 138], [166, 108], [202, 110]]), // windshield
  ],
  // Personal watercraft: hull with an upswept nose, handlebars, on water.
  "jet-ski": [
    S.box(34, 150, 178, 38, 19), // hull
    S.line([[210, 169], [240, 148]]), // upswept nose
    S.line([[118, 150], [118, 106]]), // steering column
    S.line([[100, 106], [136, 106]]), // handlebar
    S.line([[140, 150], [152, 132], [196, 136]]), // seat hump
    S.wave(20, 80, 210, 7, 38),
    S.wave(112, 172, 210, 7, 38),
    S.wave(204, 244, 210, 7, 38),
  ],
  // Three-wheeler tuk-tuk: domed canopy, sloped windscreen with a rounded
  // scooter front, a small front wheel and a larger rear wheel.
  "auto-rickshaw": [
    S.box(70, 80, 126, 88, 30), // tall domed cabin
    S.quadwin([[100, 98], [120, 98], [110, 146], [84, 146]]), // raked windscreen (front)
    S.win(124, 98, 56, 48, 8), // passenger opening (rear); gap = centre pillar
    S.arc(72, 184, 24, 202, 338), // front fender flare
    S.wheel(72, 186, 16), // small front wheel (forward)
    S.wheel(176, 182, 22), // rear wheel
  ],
  // House half-submerged in rising water.
  flood: [
    S.line([[58, 116], [128, 58], [198, 116]]), // roof
    S.line([[80, 112], [80, 158]]), // left wall
    S.line([[176, 112], [176, 158]]), // right wall
    S.wave(24, 232, 174, 9, 58),
    S.wave(24, 232, 202, 9, 58),
  ],
  // Stacked gold bullion bars (gold loans). Trapezoidal ingots, wider at the base.
  "gold-bars": [
    S.quad([[104, 92], [152, 92], [162, 136], [94, 136]]), // top bar
    S.quad([[56, 140], [104, 140], [114, 184], [46, 184]]), // bottom-left bar
    S.quad([[152, 140], [200, 140], [210, 184], [142, 184]]), // bottom-right bar
  ],
  // Money sack: round body, flared tied mouth, a "$" mark.
  "money-bag": [
    S.circ(128, 158, 52), // round sack body
    S.quad([[114, 108], [142, 108], [166, 72], [90, 72]]), // flared tied mouth
    S.line([[96, 108], [160, 108]]), // tie band
    S.dline([[128, 132], [128, 188]]), // "$" vertical bar
    S.dline([[146, 142], [116, 142], [116, 159], [142, 161], [142, 178], [114, 178]]), // "$" S-curve
  ],
  // Awareness ribbon — cancer cover. Two strands crossing into a rounded loop + tails.
  ribbon: [
    S.line([[110, 210], [128, 150], [150, 106], [140, 80], [120, 90]]), // left strand over the top
    S.line([[146, 210], [128, 150], [106, 106], [116, 80], [136, 90]]), // right strand over the top
  ],
  // Forearm crutch: open arm cuff, grip, shaft, foot.
  crutch: [
    S.arc(128, 60, 22, 128, 412), // arm cuff (open at the bottom)
    S.line([[128, 80], [128, 206]]), // shaft
    S.line([[128, 120], [158, 120]]), // forearm grip
    S.line([[114, 208], [142, 208]]), // foot
  ],
};

// ---- emit -----------------------------------------------------------------
const svg = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 256 256">${inner}</svg>`;

let written = 0;
for (const [name, shapes] of Object.entries(ICONS)) {
  const dir = path.join(RAW_SVGS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  const regularInner = `<path d="${renderShapes(shapes, SW.regular, false)}"/>`;
  for (const weight of WEIGHTS) {
    let inner;
    if (weight === "fill") {
      inner = `<path d="${renderShapes(shapes, SW.regular, true)}"/>`;
    } else if (weight === "duotone") {
      const tint = renderShapes(shapes, SW.regular, true);
      inner = `<path d="${tint}" opacity=".2"/>` + regularInner;
    } else {
      inner = `<path d="${renderShapes(shapes, SW[weight], false)}"/>`;
    }
    fs.writeFileSync(path.join(dir, `${name}-${weight}.svg`), svg(inner));
    written++;
  }
}
console.log(`Drafted ${Object.keys(ICONS).length} icons (${written} SVG files) into raw-svgs/`);
