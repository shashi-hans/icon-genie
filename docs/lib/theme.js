// Light/dark for every page, and the button that switches it.
//
// One choice for the whole app: whichever theme you pick is remembered and
// applied on every page and every reload until you switch back. The gallery, the
// generator, the resizer and the landing page all read the same key, so moving
// between them never flips the background.
//
// Light is the default for anyone who has not chosen. The system's
// prefers-color-scheme is deliberately not consulted: the gallery is judged on
// how the artwork reads, and that comparison starts from one known background.
//
// docs/app.css defines the light palette on bare :root and dark under
// [data-theme="dark"], so a first visit paints correctly with no script, and the
// attribute set here only matters once there is a choice to honour.
const root = document.documentElement;

// Shared by every page on this origin. Renaming it resets everyone to light,
// which is a harmless migration but a visible one.
const STORE = "icon-genie.theme";

/** Everything that must react when the theme changes, e.g. a colour swatch. */
const listeners = new Set();

/** Run `fn` after every theme change. */
export function onThemeChange(fn) {
  listeners.add(fn);
}

/** The remembered choice, or null. Storage can throw (private mode, blocked). */
function storedTheme() {
  try {
    const value = localStorage.getItem(STORE);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

export function applyTheme(theme, { remember = false } = {}) {
  const isLight = theme !== "dark";
  const name = isLight ? "light" : "dark";
  root.setAttribute("data-theme", name);
  // Glyph and word as separate spans, matching what build-header.js writes into
  // the page. A narrow bar hides .tgl-word to keep the header one row, and
  // assigning textContent here would flatten them back into one string the first
  // time the theme was applied.
  for (const el of document.querySelectorAll("[data-theme-toggle]")) {
    const glyph = el.querySelector(".tgl-icon");
    const word = el.querySelector(".tgl-word");
    if (glyph && word) {
      glyph.textContent = isLight ? "🌙" : "☀️";
      word.textContent = isLight ? "Dark" : "Light";
    } else {
      el.textContent = isLight ? "🌙 Dark" : "☀️ Light";
    }
  }
  // Only an actual choice is written. Re-applying the current theme — which
  // initHeader does to label a toggle it has just built — must not turn the
  // default into a stored preference.
  if (remember) {
    try {
      localStorage.setItem(STORE, name);
    } catch {
      /* the theme still applies for this page view */
    }
  }
  for (const fn of listeners) fn(name);
}

/**
 * Attach the switch behaviour to every [data-theme-toggle] that does not have it
 * yet. Called again by initHeader once it has built its toggle: the button does
 * not exist when a page first calls initTheme, so wiring only at start-up would
 * leave a toggle that changes nothing.
 */
export function wireToggles() {
  for (const el of document.querySelectorAll("[data-theme-toggle]")) {
    if (el.dataset.themeWired) continue;
    el.dataset.themeWired = "1";
    el.addEventListener("click", () => {
      const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      applyTheme(next, { remember: true });
    });
  }
}

/** Apply the remembered theme, or light, and wire whatever toggles exist yet. */
export function initTheme() {
  applyTheme(storedTheme() ?? "light");
  wireToggles();
}
