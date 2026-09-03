# Changelog

## 0.4.0

No change to the library. Every export keeps its name, signature and artwork, and
`dist/` is byte-identical to 0.3.0 — upgrading is safe and changes nothing in your
code. The work in this release is the gallery site and the API behind it.

**A server-side request forgery in `/api/theme` is fixed.** The endpoint checks
`robots.txt` before reading a site, and that check called `fetch` directly rather
than through the guard the page fetch uses. Every protection in
`server/lib/fetch-page.js` — the bare-IP refusal, the DNS lookup, the private-range
block — was skipped for it, so pointing the endpoint at a loopback or link-local
address still reached it. The response was refused, but the request had been made,
and whether the host answered changed the error the caller saw. Anyone running
this API should take this release.

**A new Icon Theme page** reads a site's colour and carries it to the gallery, the
generator and the resizer. The picker used to be repeated on all three.

**Faster.** Two N+1 query loops are gone: the review queue made one database round
trip per row, and history one per entry. The header is written into each page at
build time rather than assembled by JavaScript, so it paints with the body.

Also fixed: the resizer rendering from a revoked blob URL when a colour was
stored, gallery page views never being counted, the identity badge still reading
"Admin" after logging out, 4-digit CSS hex colours being dropped from a palette,
and `<icon-genie>` settling on a stale weight after a quick switch.

## 0.3.0

Breaking. The package is renamed; the API is unchanged.

**`@shashi-hans/icons` is now `icon-genie`.** Run
`npm uninstall @shashi-hans/icons && npm install icon-genie`, then update the
import specifier. Every export keeps its name and signature, so nothing else in
your code changes. The old name is deprecated on npm and receives no further
releases.

**The web component is `<icon-genie>`, served from `/icon-genie.js`.**
`<sh-icon>` and `/sh-icon.js` are gone. Update the `<script src>` and the tags:
attributes (`name`, `weight`, `size`, `color`, `label`) and `setBase()` are
unchanged. This affects plain-HTML pages only, not the React or `/api/svg` paths.

The repository moved to `github.com/shashi-hans/icon-genie`.

## 0.2.0

Breaking. Two changes affect existing imports.

**Icon names no longer carry a source prefix.** `LuHeart`, `TbHeart`, `MsHeart` and
friends are gone; every icon is exported under its bare name, and a name a second
set also uses is numbered (`AB`, `AB2`). Rename imports to the bare or numbered
form — the gallery search shows the current name for a drawing.

**Four weights instead of six.** `thin`, `regular`, `fill` and `duotone` are the
weights the library offers, and `ICON_WEIGHTS` lists those four. `light`, `bold`
and `sharp` still type-check and still render (`light` as `thin`, the other two as
`regular`), so existing `weight=` calls do not break, but they are deprecated.

Also in this release:

- 8469 icons, up from 1547. Artwork now comes from Phosphor, Lucide, Feather,
  Tabler, Heroicons, Iconoir, Material Symbols and Ionicons, including 90
  `logo-*` brand logos.
- `Icon`, `registerIcons`, `isIconRegistered` and `registeredIcons`: render an
  icon by name at runtime, from a registry you fill with the icons you use.
- `LICENSES/` ships in the tarball, so the per-set licence texts the root
  `LICENSE` points at travel with the package.

## 0.1.0

First release. 1547 Phosphor icons as tree-shakeable React components with a
`weight` prop, ESM + CJS, TypeScript types.
