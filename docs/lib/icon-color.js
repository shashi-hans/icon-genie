// What the Icon Theme page chose: the colour, the site it came from, and the
// swatches that site offered.
//
// theme.html is the only place that picks one. The gallery, the generator and
// the resizer read the colour here and start with it, so matching a site once
// carries through to whatever you do next instead of being re-typed on each
// page. Every page's own colour control still wins for that page and that visit
// — this is the default, not a lock.
//
// The site and the swatches are kept as well as the colour so that returning to
// the theme page shows the state you left it in: the address still typed, the
// palette still on screen, the applied swatch still marked. Re-fetching a site
// to see what you already chose is a round trip to someone else's server for an
// answer this tab already had.
//
// Scope: sessionStorage, so a second tab and the next browser session both start
// at the project default. Within a tab it survives navigation *and* reload; the
// one thing that clears it is reloading the homepage, which is the deliberate
// "start again" gesture — see clearOnHomeReload, called only from index.html.
//
// Every access is guarded because storage can throw outright — a private window,
// a page opened over file:// — in which case nothing is carried and every page
// simply uses its default.

const STORE = "icon-genie.icon-theme";
const MAX_SITE_CHARS = 300;
// The API returns at most two; this is the read-side guard on what is replayed.
const MAX_SWATCHES = 2;

/** #abc or #aabbcc, with or without the hash, normalised to #aabbcc. Null otherwise. */
export function parseHex(raw) {
  const value = String(raw ?? "").trim().replace(/^#?/, "#").toLowerCase();
  const short = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/.test(value) ? value : null;
}

/**
 * The whole carried state, always in a usable shape.
 *
 * Re-validated field by field rather than trusted: the value is whatever is in
 * this tab's storage, which another script or an older version of this app could
 * have written, and the colours go straight into style properties.
 */
export function readIconTheme() {
  const empty = { color: null, site: "", swatches: [] };
  try {
    const raw = JSON.parse(sessionStorage.getItem(STORE) || "null");
    if (!raw || typeof raw !== "object") return empty;
    return {
      color: parseHex(raw.color),
      site: typeof raw.site === "string" ? raw.site.slice(0, MAX_SITE_CHARS) : "",
      swatches: Array.isArray(raw.swatches)
        ? raw.swatches
            .map((s) => ({ hex: parseHex(s?.hex), source: String(s?.source ?? "") }))
            .filter((s) => s.hex)
            .slice(0, MAX_SWATCHES)
        : [],
    };
  } catch {
    return empty;
  }
}

/** Merge a change into the carried state, leaving the other fields alone. */
export function writeIconTheme(patch) {
  const next = { ...readIconTheme(), ...patch };
  try {
    sessionStorage.setItem(STORE, JSON.stringify(next));
  } catch {
    /* not carried; the choice still holds for this page and this visit */
  }
}

/** Forget everything: back to the project's own colour. */
export function clearIconTheme() {
  try {
    sessionStorage.removeItem(STORE);
  } catch {
    /* nothing stored to clear */
  }
}

/**
 * Reset when the homepage is reloaded, and only then.
 *
 * Called from index.html alone. Reloading a tool page keeps the colour, because
 * losing it there means re-picking a site mid-task; the homepage is where you
 * start over, so a reload of it is read as exactly that. Arriving at the
 * homepage by clicking the brand is navigation, not a reload, and leaves the
 * colour alone.
 *
 * Unknown navigation type counts as "not a reload": keeping a colour that should
 * have cleared is a smaller surprise than dropping one that should have stayed.
 */
export function clearOnHomeReload() {
  let reload = false;
  try {
    const entry = performance.getEntriesByType?.("navigation")?.[0];
    // 1 is TYPE_RELOAD in the older API, which is all some browsers report.
    reload = entry?.type ? entry.type === "reload" : performance.navigation?.type === 1;
  } catch {
    reload = false;
  }
  if (reload) clearIconTheme();
}

/** Just the colour, for the pages that only consume it. */
export function storedIconColor() {
  return readIconTheme().color;
}

/** Set or clear the colour, leaving the site and swatches in place. */
export function storeIconColor(hex) {
  writeIconTheme({ color: hex === null ? null : parseHex(hex) });
}
