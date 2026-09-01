// <icon-genie> — the plain-HTML way to use these icons, with no build step.
//
//   <script type="module" src="https://<host>/icon-genie.js"></script>
//   <icon-genie name="heart"></icon-genie>
//   <icon-genie name="heart" weight="fill" size="32" color="crimson"></icon-genie>
//
// The markup is fetched from /api/svg on the host this script was loaded from,
// so a page needs neither React nor the npm package. Override the origin with
//
//   <script type="module">
//     import { setBase } from "https://<host>/icon-genie.js";
//     setBase("https://icons.example.com");
//   </script>
//
// It renders inline rather than through <img> so `currentColor` works: an <img>
// is a separate document and cannot inherit the page's text colour.
let BASE = new URL(".", import.meta.url).href.replace(/\/$/, "");

/** Point the element at a different host. */
export function setBase(url) {
  BASE = String(url).replace(/\/+$/, "");
}

// One request per name+weight for the whole page, shared across every element
// that wants it. Icons repeat a lot in a UI, and this is the difference between
// one fetch and one per instance.
const cache = new Map();

function load(name, weight) {
  const key = `${name}|${weight}`;
  let pending = cache.get(key);
  if (!pending) {
    const q = weight && weight !== "regular" ? `?weight=${encodeURIComponent(weight)}` : "";
    pending = fetch(`${BASE}/api/svg/${encodeURIComponent(name)}.svg${q}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      // A failure is cached as empty so a mistyped name does not retry forever.
      .catch(() => "");
    cache.set(key, pending);
  }
  return pending;
}

class IconGenie extends HTMLElement {
  static observedAttributes = ["name", "weight", "size", "color", "label"];

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    // :host sizing so the element behaves like a glyph in text flow.
    this.shadowRoot.innerHTML =
      `<style>
        :host { display: inline-flex; width: 1em; height: 1em; vertical-align: -0.125em; }
        svg { width: 100%; height: 100%; display: block; }
      </style><span></span>`;
    this._slotEl = this.shadowRoot.querySelector("span");
  }

  connectedCallback() { this.#render(); }
  attributeChangedCallback() { this.#render(); }

  async #render() {
    const name = this.getAttribute("name");
    if (!name) { this._slotEl.replaceChildren(); return; }

    const size = this.getAttribute("size");
    if (size) this.style.fontSize = /^\d+$/.test(size) ? `${size}px` : size;
    const color = this.getAttribute("color");
    this.style.color = color || "";

    const weight = this.getAttribute("weight") || "regular";
    const markup = await load(name, weight);
    // The attribute may have changed while the fetch was in flight.
    if (this.getAttribute("name") !== name) return;

    if (!markup) { this._slotEl.replaceChildren(); return; }
    // Parsed rather than assigned as innerHTML: the response is SVG from this
    // project's own API, but parsing it as image/svg+xml means a script element
    // in it could never run even if that ever stopped being true.
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    const svg = doc.documentElement;
    if (svg.nodeName.toLowerCase() !== "svg") { this._slotEl.replaceChildren(); return; }
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    if (!this.hasAttribute("label")) {
      svg.setAttribute("aria-hidden", "true");
    } else {
      svg.setAttribute("role", "img");
      const title = doc.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = this.getAttribute("label");
      svg.prepend(title);
    }
    this._slotEl.replaceChildren(document.importNode(svg, true));
  }
}

if (!customElements.get("icon-genie")) customElements.define("icon-genie", IconGenie);

export { IconGenie };
