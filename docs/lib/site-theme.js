// "Match a website's theme colour", shared by the gallery's detail dialog and
// the generator page.
//
// Type a site, get its theme colour applied to the icons on the page. The page
// cannot read another origin itself — no site sends CORS headers for its own
// homepage — so /api/theme does the fetch, which is also where the SSRF guards
// live. Nothing here ever fetches the typed URL directly, even for a preview.
//
// The colour a panel picks is not this module's to apply: the gallery drives a
// global custom property and a swatch in its control bar, the generator drives
// its own preview. Both hand in an `applyColor` and read back through
// `activeColor`, so one panel implementation serves both without knowing either.
import { api } from "./api.js";

/** #abc or #aabbcc, with or without the hash, normalised to #aabbcc. Null otherwise. */
export function parseHex(raw) {
  const value = String(raw).trim().replace(/^#?/, "#").toLowerCase();
  const short = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/.test(value) ? value : null;
}

/**
 * Wire every [data-site-theme] panel on the page.
 *
 * `applyColor(hex)` puts the colour into effect. `activeColor()` reports what is
 * in effect now, which is what marks the right swatch — driven off the applied
 * colour rather than the last click, so a colour picked elsewhere, or a reset,
 * clears the selection instead of leaving a chip claiming to be active.
 */
export function initSiteTheme({ applyColor, activeColor }) {
  /** Mark whichever fetched swatch is currently in effect, across every panel. */
  function syncSelection() {
    const active = (activeColor() || "").toLowerCase();
    for (const chip of document.querySelectorAll(".swatch")) {
      const on = chip.dataset.hex === active;
      chip.classList.toggle("selected", on);
      chip.setAttribute("aria-pressed", String(on));
    }
  }

  function apply(hex) {
    applyColor(hex);
    syncSelection();
  }

  /**
   * Alternatives under the applied colour. The button takes the top-ranked
   * swatch, which is right when a site declares a --primary-color and a guess
   * when it does not, so the rest stay one click away.
   */
  function swatchChips(out, swatches) {
    out.replaceChildren();
    for (const { hex, source } of swatches) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "swatch";
      chip.style.background = hex;
      chip.dataset.hex = hex.toLowerCase();
      chip.title = `${hex} — ${source}`;
      chip.setAttribute("aria-label", `Use ${hex}`);
      chip.setAttribute("aria-pressed", "false");
      chip.addEventListener("click", () => apply(hex));
      out.appendChild(chip);
    }
  }

  /** Render the swatches with their label. Both entry points go through this. */
  function renderSwatches(out, swatches) {
    out.className = "site-theme-out ok";
    out.replaceChildren();
    const label = document.createElement("span");
    label.className = "swatch-label";
    label.textContent = "Applied colour";
    out.appendChild(label);
    const row = document.createElement("span");
    row.className = "swatch-row";
    swatchChips(row, swatches);
    out.appendChild(row);
  }

  function showAppliedColor(out, hex, source) {
    renderSwatches(out, [{ hex, source }]);
    apply(hex);
  }

  async function matchSiteTheme(panel) {
    const input = panel.querySelector("[data-site-url]");
    const button = panel.querySelector("[data-site-go]");
    const out = panel.querySelector("[data-site-out]");

    // A colour typed into the address box is taken as a colour rather than
    // fetched as a site. That box is the larger of the two and comes first, so
    // it is where a hex gets typed; failing with "not a valid address" would be
    // technically right and useless.
    const typedHere = parseHex(input.value);
    if (typedHere) {
      panel.querySelector("[data-hex-in]").value = typedHere;
      showAppliedColor(out, typedHere, "typed");
      return;
    }
    const url = input.value.trim();
    if (!url) {
      out.className = "site-theme-out error";
      out.textContent = "Enter a website address.";
      return;
    }
    button.disabled = true;
    out.className = "site-theme-out";
    out.textContent = "Reading that site…";
    try {
      const { swatches } = await api("/api/theme", { method: "POST", body: JSON.stringify({ url }) });
      renderSwatches(out, swatches);
      // Applied after the chips exist so the first one paints as selected.
      apply(swatches[0].hex);
    } catch (err) {
      out.className = "site-theme-out error";
      out.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  /**
   * The manual way in, for the two cases a fetch cannot cover: a site behind a
   * bot manager that refuses to be read, and a site whose colours live in an
   * external stylesheet the extractor deliberately does not follow.
   */
  function useTypedColor(panel) {
    const input = panel.querySelector("[data-hex-in]");
    const out = panel.querySelector("[data-site-out]");
    const hex = parseHex(input.value);
    if (!hex) {
      out.className = "site-theme-out error";
      // Names the field, because the usual mistake is typing the colour into the
      // address box above and pressing Use.
      out.textContent = input.value.trim()
        ? "That is not a colour. Try #fc5846."
        : "Type a colour in the box next to Use, like #fc5846.";
      input.focus();
      return;
    }
    showAppliedColor(out, hex, "typed");
  }

  for (const panel of document.querySelectorAll("[data-site-theme]")) {
    panel.querySelector("[data-site-go]").addEventListener("click", () => matchSiteTheme(panel));
    panel.querySelector("[data-site-url]").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        matchSiteTheme(panel);
      }
    });
    panel.querySelector("[data-hex-go]").addEventListener("click", () => useTypedColor(panel));
    panel.querySelector("[data-hex-in]").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        useTypedColor(panel);
      }
    });
  }

  return { syncSelection };
}
