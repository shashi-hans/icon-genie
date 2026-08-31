// The header every page shares: brand, links to the three tools, the theme
// toggle, and the welcome title.
//
// Built here rather than copied into four HTML files so a new page, a renamed
// tool, or a change to how identity is shown happens once. Each page says which
// one it is and whether it offers History; everything else is the same
// everywhere.
//
// The welcome title is decoration. The server decides what an admin may do and
// re-checks the session cookie on every call, so a role shown here is a label,
// never a permission.
import { api } from "./api.js";
import { applyTheme, wireToggles } from "./theme.js";

const PAGES = [
  { id: "gallery", href: "./gallery.html", label: "Icon Gallery" },
  { id: "generator", href: "./generator.html", label: "Icon Genie generator" },
  { id: "resizer", href: "./resizer.html", label: "Icon Resizer" },
];

/** The signed-in identity, resolved once per page and shared by every caller. */
let mePromise = null;

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

  const bar = document.createElement("div");
  bar.className = "site-bar";
  bar.innerHTML = `
    <a class="brand" href="./index.html">Icon Genie Gallery<span class="brand-mark" aria-hidden="true">🧞</span></a>
    <nav>
      ${home
        ? ""
        : PAGES.map(
            (p) =>
              `<a class="btn" href="${p.href}"${p.id === current ? ' aria-current="page"' : ""}>${p.label}</a>`
          ).join("\n      ")}
      <button class="btn" type="button" data-theme-toggle aria-label="Toggle theme"></button>
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
    </nav>`;
  host.prepend(bar);

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
  const label = bar.querySelector("#who-label");
  // Trailing space: the name is a separate <strong>, and without it the two
  // run together as "WelcomeGuest".
  label.replaceChildren(document.createTextNode("Welcome "));
  const who = document.createElement("strong");
  who.textContent = me.title || (admin ? "Admin" : "Guest");
  label.appendChild(who);

  bar.querySelector("#admin-link").hidden = !admin;
  bar.querySelector("#login-link").hidden = admin || me.offline;
  const logout = bar.querySelector("#logout-btn");
  logout.hidden = !admin;
  logout.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      location.reload();
    }
  });
  // With no backend there is nothing to log into and no history to read, so the
  // menu would offer dead options.
  if (me.offline && history) bar.querySelector("#hist-open")?.setAttribute("hidden", "");

  return me;
}

/** Unique-visitor count for a footer, judged by the guest cookie. Silent if absent. */
export async function renderVisitors(el) {
  if (!el) return;
  const me = await loadMe();
  const v = me.visits;
  if (!v || typeof v.visitors !== "number") return;
  el.textContent = `${v.visitors.toLocaleString()} ${v.visitors === 1 ? "visitor" : "visitors"}`;
  el.title = `${v.views.toLocaleString()} page views`;
  el.hidden = false;
}
