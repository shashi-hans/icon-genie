// The footer line every page shares: copyright, who made it, and the visitor
// count.
//
// Built here rather than repeated in five HTML files so the year, the credit and
// the count cannot drift apart between pages. A page supplies an empty
// [data-site-footer-bar] and optionally its own content above it — the landing
// page keeps its link columns and gets this as the bottom rule.
//
// The count comes from the same /api/auth/me call the header already makes, so
// this adds no request. It stays hidden when there is no backend, rather than
// rendering "0 visitors" and looking broken.
import { loadMe } from "./header.js";

const CREATOR = "Shashi";
const CREATOR_URL = "https://github.com/shashi-hans";

/** Fill every [data-site-footer-bar] on the page. */
export async function initFooter() {
  const bars = document.querySelectorAll("[data-site-footer-bar]");
  if (!bars.length) return;

  // Taken from the clock rather than hardcoded: a footer that says the wrong
  // year is the classic sign of a site nobody maintains.
  const year = new Date().getFullYear();

  for (const bar of bars) {
    bar.innerHTML = `
      <span>© ${year} Icon Genie Gallery. MIT licensed.</span>
      <span class="foot-dot" aria-hidden="true">·</span>
      <span>Created by <a href="${CREATOR_URL}" rel="author">${CREATOR}</a></span>
      <span class="spacer"></span>
      <span class="foot-visitors" hidden></span>
      <a href="https://github.com/shashi-hans/icon-genie">GitHub</a>`;
  }

  const me = await loadMe();
  const v = me.visits;
  if (!v || typeof v.visitors !== "number") return;
  const label = `${v.visitors.toLocaleString()} ${v.visitors === 1 ? "visitor" : "visitors"}`;
  for (const el of document.querySelectorAll(".foot-visitors")) {
    el.textContent = label;
    // Views are the less meaningful number of the two, so they sit in the title
    // rather than competing for the line.
    el.title = `${v.views.toLocaleString()} page views`;
    el.hidden = false;
  }
}
