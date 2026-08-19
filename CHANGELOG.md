# Changelog

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
