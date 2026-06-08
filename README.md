# @shashihans/icons

A tree-shakeable React icon library. Each icon is one component with a `weight` prop — `thin`, `light`, `regular`, `bold`, `fill`, or `duotone`. TypeScript-first, `currentColor` by default, ESM + CJS, `react` as the only peer.

## Install

```bash
npm install @shashihans/icons   # requires react >= 18
```

## Usage

```tsx
import { Heart, User } from "@shashihans/icons";

<Heart weight="fill" color="crimson" size={32} />
<User weight="duotone" aria-label="Profile" />   // labelled = role="img"; otherwise aria-hidden
```

### Props

All icons forward any valid `<svg>` attribute, plus:

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `size` | `number \| string` | `24` | width & height (number = px) |
| `color` | `string` | `"currentColor"` | drives `fill` |
| `weight` | `thin \| light \| regular \| bold \| fill \| duotone` | `"regular"` | which weight to render |
| `aria-label` | `string` | — | sets `role="img"`; omit to keep decorative |

## Finding an icon

- **Gallery** (searchable, click-to-copy): https://shashi-hans.github.io/shashihans-icons/
- **Editor autocomplete** on `import { } from "@shashihans/icons"`
- **At runtime:** `generateMetadata().iconNames`

## Adding / updating icons

Components are generated from `raw-svgs/`. Add one folder per icon with all six weights, each on a `0 0 256 256` viewBox:

```
raw-svgs/my-icon/my-icon-{thin,light,regular,bold,fill,duotone}.svg
```

Then `npm run build:all` (= `build:icons` → `build`). `my-icon` becomes the `MyIcon` component, exported automatically. Preview locally with `npx serve docs`.

| Script | Does |
| --- | --- |
| `build:icons` | optimize SVGs → generate components → generate index |
| `build` | bundle `src/` → `dist/` (ESM + CJS + types) |
| `build:all` | `build:icons` then `build` |
| `typecheck` | `tsc --noEmit` |

## Design notes

One component embeds all six weights and `switch`es at render (so a render allocates one element, not six); the `<svg>` wrapper lives once in `IconBase`; duotone reuses the regular path when identical. `sideEffects: false` + pure annotations keep it tree-shakeable — importing one icon ships one icon.

## Publishing

Automated by [`.github/workflows/publish.yml`](.github/workflows/publish.yml) on a version tag:

```bash
npm version patch && git push --follow-tags
```

Or manually: `npm run build:all && npm publish --access public`.

## License

MIT © Shashi Hans. Icon artwork is derived from [Phosphor Icons](https://github.com/phosphor-icons/core) (MIT © 2020 Phosphor Icons); see [`LICENSE`](LICENSE).
