// The header every page shares: brand, links to the three tools, the theme
// toggle, and the welcome title.
//
// The markup itself lives in header-markup.js and is written into each page by
// scripts/build-header.js, so the bar paints with the body rather than after
// three modules have loaded. This file is what makes it work: the theme toggle,
// the identity menu, and logging out. One template either way, so a new page or
// a renamed tool is still a single edit.
//
// The welcome title is decoration. The server decides what an admin may do and
// re-checks the session cookie on every call, so a role shown here is a label,
// never a permission.
import { api } from "./api.js";
import { applyTheme, wireToggles } from "./theme.js";

/** The signed-in identity, resolved once per page and shared by every caller. */
let mePromise = null;

// Last known identity for this tab, so the badge paints with a name instead of a
// bare "Welcome" that gains one 50-400ms later — a visible flash on every
// navigation. Only the display title is kept, and only for this tab: it is
// decoration, and the server re-checks the session cookie on every call, so a
// stale value can misname the badge for one paint but can never grant anything.
// The admin menu items are deliberately NOT painted from it; those wait for the
// real answer so a lapsed session never offers admin links.
const ME_CACHE = "icon-genie.me";

function cachedTitle() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(ME_CACHE) || "null");
    const title = typeof raw?.title === "string" ? raw.title.slice(0, 40) : "";
    return title || "";
  } catch {
    return "";
  }
}

function rememberTitle(title) {
  try {
    sessionStorage.setItem(ME_CACHE, JSON.stringify({ title: String(title || "").slice(0, 40) }));
  } catch {
    /* not remembered; the badge simply fills in when the API answers */
  }
}

/**
 * Who the server says we are. Cached, because the header and the page itself
 * both want it and it is one visit either way.
 *
 * `visit` counts this page view; only the pages a visitor lands on pass true, so
 * reviewing icons in the admin page never inflates the number.
 */
export function loadMe({ visit = false } = {}) {
  if (!mePromise) {
    mePromise = api(`/api/auth/me${visit ? "?visit=1" : ""}`).catch(() => ({
      role: "guest",
      title: "Guest",
      offline: true,
    }));
  }
  return mePromise;
}

/**
 * Render the header into <header data-site-header>.
 *
 * `current` is the page's own id, so its link is marked and not offered as
 * somewhere to go. `history` adds the History item to the menu; only the pages
 * that carry the history dialog pass it. `home` drops the tool links entirely:
 * the homepage lists them as cards, so repeating them in the header says the
 * same thing twice.
 */
export async function initHeader({ current, history = false, visit = false, home = false } = {}) {
  const host = document.querySelector("[data-site-header]");
  if (!host) return null;

  // Normally already in the page: scripts/build-header.js writes it into the HTML
  // so it paints with the body instead of waiting for these modules to load.
  // Built here only when it is absent — an ungenerated page, or one served from
  // a build made before this existed.
  let bar = host.querySelector(".site-bar");
  if (!bar) {
    // Imported here rather than at the top: on a generated page this branch never
    // runs, and a static import would still cost every page a serial round trip
    // for a template it does not use.
    const { headerBarHtml } = await import("./header-markup.js");
    host.insertAdjacentHTML("afterbegin", headerBarHtml({ current, history, home }));
    bar = host.querySelector(".site-bar");
  }

  // The name is per-visitor, so generated markup cannot carry it. Painted from
  // the last known value before the request goes out, which is what stops the
  // badge reading a bare "Welcome" for the length of a round trip.
  // Trailing space: the name is a separate <strong>, and without it the two run
  // together as "WelcomeGuest".
  const setWelcome = (name) => {
    // "Welcome" is an element, not a text node, so app.css can drop it on a
    // narrow bar and keep the name — which is the part that carries meaning.
    const greet = document.createElement("span");
    greet.className = "who-greet";
    greet.textContent = "Welcome ";
    const strong = document.createElement("strong");
    strong.textContent = name;
    bar.querySelector("#who-label").replaceChildren(greet, strong);
  };

  const cached = cachedTitle();
  if (cached) setWelcome(cached);

  // The toggle only exists now, so it is wired and labelled here. Re-applying
  // the current theme sets the label without changing the theme.
  wireToggles();
  applyTheme(document.documentElement.getAttribute("data-theme") || "light");

  const toggle = bar.querySelector("#who-toggle");
  const menu = bar.querySelector("#who-menu");
  const setMenu = (open) => {
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setMenu(menu.hidden);
  });
  document.addEventListener("click", () => setMenu(false));
  menu.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setMenu(false);
  });

  const me = await loadMe({ visit });
  const admin = me.role === "admin";
  const title = me.title || (admin ? "Admin" : "Guest");
  setWelcome(title);
  rememberTitle(title);

  bar.querySelector("#admin-link").hidden = !admin;
  bar.querySelector("#login-link").hidden = admin || me.offline;
  const logout = bar.querySelector("#logout-btn");
  logout.hidden = !admin;
  logout.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      // Before the reload, or the badge repaints "Admin" from this cache until
      // /api/auth/me answers — after you have just logged out.
      try {
        sessionStorage.removeItem(ME_CACHE);
      } catch {
        /* nothing cached to clear */
      }
      location.reload();
    }
  });
  // With no backend there is nothing to log into and no history to read, so the
  // menu would offer dead options.
  if (me.offline && history) bar.querySelector("#hist-open")?.setAttribute("hidden", "");

  return me;
}
