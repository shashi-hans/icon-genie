// The header bar as a string, with no DOM and no imports.
//
// Deliberately free of both, so the same function serves two callers that share
// nothing else: scripts/build-header.js writes this into each page's HTML at
// build time, and lib/header.js falls back to it in the browser when a page has
// not been generated. One template either way, so a renamed tool or a new page
// is still a single edit.
//
// Why generate it at all: the bar used to exist only at runtime, so a page's
// <header> was empty until three module files had been fetched and run. The body
// is markup in the HTML and painted immediately; the header could not, and
// arrived visibly late on every navigation. Markup in the file paints with the
// body.
//
// What is NOT here is anything per-visitor. The identity badge renders as a bare
// "Welcome" and lib/header.js fills in the name, because generated markup is the
// same for everyone who asks for the page.

export const PAGES = [
  { id: "gallery", href: "./gallery.html", label: "Icon Gallery" },
  { id: "generator", href: "./generator.html", label: "Icon Generator" },
  { id: "resizer", href: "./resizer.html", label: "Icon Resizer" },
  { id: "theme", href: "./theme.html", label: "Icon Theme" },
];

/**
 * The complete `<div class="site-bar">…</div>`.
 *
 * `current` is the page's own id, so its link is marked and not offered as
 * somewhere to go. `history` adds the History item to the menu; only the pages
 * that carry the history dialog pass it. `home` drops the tool links entirely:
 * the homepage lists them as cards, so repeating them in the header says the
 * same thing twice.
 *
 * The theme toggle carries the light-theme label, light being the default for
 * anyone who has not chosen. A dark-theme visitor has it corrected by
 * lib/theme.js — the stored choice is per-visitor and cannot be baked in.
 */
export function headerBarHtml({ current = "", history = false, home = false } = {}) {
  const links = home
    ? ""
    : PAGES.map(
        (p) =>
          `<a class="btn" href="${p.href}"${p.id === current ? ' aria-current="page"' : ""}>${p.label}</a>`
      ).join("\n          ");

  return `<div class="site-bar">
        <a class="brand" href="./index.html">Genie Icons<span class="brand-mark" aria-hidden="true">🧞</span></a>
        <nav>${links ? `\n          ${links}` : ""}
          <button class="btn" type="button" data-theme-toggle aria-label="Toggle theme">🌙 Dark</button>
          <div class="who">
            <button class="who-badge" id="who-toggle" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="who-menu">
              <span id="who-label">Welcome</span>
              <span class="caret" aria-hidden="true">▾</span>
            </button>
            <div class="who-menu" id="who-menu" role="menu" hidden>
              ${history ? '<button class="who-item" id="hist-open" type="button" role="menuitem">History</button>' : ""}
              <a class="who-item" id="admin-link" href="./admin.html" role="menuitem" hidden>Icon approval</a>
              <a class="who-item" id="login-link" href="./admin.html" role="menuitem">Admin login</a>
              <button class="who-item" id="logout-btn" type="button" role="menuitem" hidden>Log out</button>
            </div>
          </div>
        </nav>
      </div>`;
}

/** Which options each generated page is built with. Read by the build script. */
export const HEADER_PAGES = {
  "index.html": { current: "", home: true },
  "gallery.html": { current: "gallery", history: true },
  "generator.html": { current: "generator", history: true },
  "resizer.html": { current: "resizer" },
  "theme.html": { current: "theme" },
  // Not a tool, so no link of its own is marked; it is reached from the
  // identity menu's "Icon approval".
  "admin.html": { current: "" },
};
