# @shashihans/icons

A tree-shakeable React icon library. Every icon is a single component with a `weight` prop — `regular`, `bold`, `fill`, `duotone`, `light`, or `thin`.

- 🌳 **Tree-shakeable** — import one icon, ship one icon.
- 🎚️ **Six weights** per icon via a single `weight` prop.
- 🧩 **TypeScript-first** — full types, `currentColor` by default.
- 📦 **ESM + CJS** with proper `exports`, no runtime dependencies (only `react` as a peer).

## Installation

```bash
npm install @shashihans/icons
# react >= 18 is a peer dependency
```

## Basic usage

```tsx
import { Airplane, Heart, User } from "@shashihans/icons";

function Example() {
  return (
    <div>
      <Airplane />
      <Heart weight="fill" color="crimson" size={32} />
      <User weight="duotone" aria-label="Profile" />
    </div>
  );
}
```

## Browsing icons

Three ways to find the icon you want:

1. **Gallery** — a searchable, click-to-copy preview of every icon and weight is published at
   `https://<your-username>.github.io/shashihans-icons/` (deployed by [`.github/workflows/pages.yml`](.github/workflows/pages.yml)). Replace `<your-username>` with your GitHub user.
2. **Editor autocomplete** — start typing `import { } from "@shashihans/icons"` and your editor lists every icon name, with full prop types on hover.
3. **Programmatically** — `generateMetadata().iconNames` returns the complete list at runtime.

## Props

Every icon accepts these props. Any other valid `<svg>` attribute (e.g. `data-*`, `focusable`) is also forwarded.

| Prop         | Type                                                              | Default          | Description                                                                 |
| ------------ | ---------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| `size`       | `number \| string`                                               | `24`             | Width and height. A number is pixels.                                       |
| `color`      | `string`                                                         | `"currentColor"` | Any CSS color. Drives `fill`, so it cascades to every path.                 |
| `weight`     | `"thin" \| "light" \| "regular" \| "bold" \| "fill" \| "duotone"` | `"regular"`      | Which weight to render.                                                     |
| `className`  | `string`                                                         | —                | Class applied to the root `<svg>`.                                          |
| `style`      | `React.CSSProperties`                                            | —                | Inline styles on the root `<svg>`.                                          |
| `onClick`    | `React.MouseEventHandler<SVGSVGElement>`                         | —                | Click handler on the root `<svg>`.                                          |
| `aria-label` | `string`                                                         | —                | If set, the icon is exposed as `role="img"` with this label; otherwise it is `aria-hidden`. |

### Accessibility

Icons are decorative by default (`aria-hidden="true"`). Pass `aria-label` to make an icon meaningful to assistive technology:

```tsx
<Trash aria-label="Delete item" onClick={remove} />
```

## Import examples

**Named imports (recommended)** — fully tree-shakeable:

```tsx
import { Airplane, MagnifyingGlass } from "@shashihans/icons";
```

**Dynamic / lazy import** — e.g. when the icon name is known only at runtime:

```tsx
import { lazy, Suspense } from "react";

// NOTE: prefer named imports where possible — the dynamic form pulls the
// whole package into the lazily-loaded chunk.
const icons = import("@shashihans/icons");

async function getIcon(name: string) {
  const mod = await icons;
  return mod[name as keyof typeof mod];
}
```

**Library metadata:**

```tsx
import { generateMetadata, ICON_WEIGHTS } from "@shashihans/icons";

const { totalIcons, weights, iconNames } = generateMetadata();
console.log(totalIcons, weights); // e.g. 1512, ["thin","light","regular","bold","fill","duotone"]
```

## Tree-shaking

Each icon compiles to a pure top-level function, the package sets `"sideEffects": false`, and all internal `jsx()` calls are `/* @__PURE__ */`-annotated. A production bundler (Vite/rollup, webpack, esbuild via a framework) drops every icon you don't import. Verified with rollup: importing a single icon yields a few KB, not the whole set.

## Adding or updating icons

The published components are generated from SVGs in `raw-svgs/`. To add a custom icon, create one folder per icon with all six weights:

```
raw-svgs/
  my-icon/
    my-icon-regular.svg
    my-icon-bold.svg
    my-icon-fill.svg
    my-icon-duotone.svg
    my-icon-light.svg
    my-icon-thin.svg
```

Each SVG must use a `0 0 256 256` viewBox for consistent sizing. Then regenerate:

```bash
npm run build:icons   # optimize → generate components → generate index
npm run build         # bundle to dist/
```

`my-icon` becomes the `MyIcon` component, exported automatically.

## Local development

```bash
# 1. Make sure raw-svgs/ holds your source SVGs (one folder per icon, six
#    weights — see "Adding or updating icons" for the layout).

# 2. Run the full pipeline + bundle
npm run build:all     # = build:icons && build

# 3. Preview the icons (serve docs over http so fetch works)
npx serve docs        # then open the printed URL
```

| Script                  | Does                                                                |
| ----------------------- | ------------------------------------------------------------------- |
| `npm run build:icons`   | `optimize-svgs` → `generate-components` → `generate-index`.         |
| `npm run build`         | Bundle `src/` to `dist/` (ESM + CJS + types) with tsup.             |
| `npm run build:all`     | `build:icons` then `build`.                                         |
| `npm run typecheck`     | `tsc --noEmit` over the generated source.                           |

## How it's built (notes)

- **No SVGR.** The chosen API is one component per icon with a `weight` prop, so a component embeds all six weights and switches at render. SVGR maps one SVG to one component, which doesn't fit this shape, so the generator assembles components directly. **SVGO** still optimizes every SVG first.
- **Single-file bundle, preserved tree-shaking.** `dist/index.js` / `dist/index.cjs` are single files (Node-resolvable, simple `exports`), kept tree-shakeable via `sideEffects: false` + pure annotations rather than per-file output.
- **Shared `IconBase`.** The `<svg>` wrapper and prop handling live once in `src/IconBase.tsx` instead of being repeated across every icon. Each generated icon only selects its weight's paths and hands them to `IconBase`. `IconBase` is internal — it is not exported from the package.
- **Lazy weight selection.** A generated icon picks its weight with a `switch`, so a render allocates a single element rather than building all six weights eagerly.
- **Duotone deduplication.** For the ~80% of icons whose duotone solid path is byte-identical to the regular path, the generator hoists `regular` into a local and reuses it from both, dropping the duplicated path data. Icons where it doesn't match stay fully lazy.
- **No source maps.** They are excluded from the npm tarball anyway and would only map to generated code, so tsup is configured with `sourcemap: false`.

## Publishing

Publishing is automated by [`.github/workflows/publish.yml`](.github/workflows/publish.yml) on a version tag:

```bash
# bump the version, then:
npm version patch          # or minor / major — updates package.json + tags
git push --follow-tags
```

The workflow checks out, installs, runs `build:all`, verifies the tag matches `package.json`, and runs `npm publish` using the `NPM_TOKEN` repository secret (with npm provenance).

To publish manually:

```bash
npm login
npm run build:all
npm publish --access public
```

## License

MIT © Shashi Hans. Icon artwork is derived from a third-party MIT-licensed icon set; see [`LICENSE`](LICENSE) for the full attribution.
