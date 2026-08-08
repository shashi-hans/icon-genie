# @shashi-hans/icons

A tree-shakeable React icon library. Each icon is one component with a `weight` prop — `thin`, `light`, `regular`, `bold`, `fill`, or `duotone`. TypeScript-first, `currentColor` by default, ESM + CJS, `react` as the only peer.

## Install

```bash
npm install @shashi-hans/icons   # requires react >= 18
```

## Usage

```tsx
import { Heart, User } from "@shashi-hans/icons";

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
- **Editor autocomplete** on `import { } from "@shashi-hans/icons"`
- **At runtime:** `generateMetadata().iconNames`

## Generating an icon that does not exist yet

The gallery has a **✨ Generate** button ([`sh-icon-genie`](https://github.com/shashi-hans/icon-genie)). Describe an icon, get 1–4 centerline paths back, preview all six weights, then download it or open a pull request adding it to this library. Three sources:

| Source | What it uses | Cost |
| --- | --- | --- |
| **Free (no setup)** | a hosted model behind icon-genie's proxy | free, no account, roughest geometry |
| **Your API key** | your own OpenAI-compatible key, called from the tab | your provider's billing |
| **Your AI chat** | copy the prompt, paste the reply back | your existing subscription |

A web page cannot read the session of an AI service you are signed in to elsewhere — the same-origin policy prevents it, and anything that worked around it would be credential theft. "Your AI chat" is the supported way to use a subscription this page never sees. With "Your API key", the key is held in the field, sent only to the provider you name, and cleared when the dialog closes; it is never stored and never reaches this site's server.

Model output is validated in the browser before it renders — path syntax, path count, coordinate framing, and an SVG sanitizer that rejects scripts, event handlers, and external references. Two of the three sources never touch the proxy, so the page runs the same gate the proxy would have.

**Download source** saves `<name>.centerline.svg`, the exact file this repo stores. **Contribute to library** opens a review PR with it; every submission is reviewed before merge, and AI geometry is rougher than the drawn icons, so review the drawing, not just the diff.

## Adding / updating icons

Components are generated from `raw-svgs/`. There are two source formats.

**Drawn icons** — one folder per icon with all six weights, each on a `0 0 256 256` viewBox:

```
raw-svgs/my-icon/my-icon-{thin,light,regular,bold,fill,duotone}.svg
```

**Generated icons** — one folder holding a single centerline file with 1–4 `<path d="…">` elements, geometry only, no paint attributes:

```
raw-svgs/my-icon/my-icon.centerline.svg
```

All six weights are derived from those paths at render time by [`StrokeIcon`](src/StrokeIcon.tsx): four stroke widths, a fill, and a duotone. Put each disconnected line in its own path (a clock is a ring path plus a hands path). The coordinates must sit on the 256 grid with no wrapping `transform` — a residual scale would make one icon's `bold` thicker than another's, so the build rejects it.

Then `npm run build:all` (= `build:icons` → `build`). `my-icon` becomes the `MyIcon` component, exported automatically. Preview locally with `npx serve docs`.

| Script | Does |
| --- | --- |
| `build:icons` | optimize SVGs → generate components → generate index → bundle the gallery's generator |
| `build` | bundle `src/` → `dist/` (ESM + CJS + types) |
| `build:all` | `build:icons` then `build` |
| `typecheck` | `tsc --noEmit` |

`docs/icon-genie.js` is the generator bundled for the browser by `scripts/build-gallery.js`. Like `docs/icons.json` it is generated, not committed — run `npm run build:icons` before serving `docs/`.

## Design notes

One component embeds all six weights and `switch`es at render (so a render allocates one element, not six); the `<svg>` wrapper lives once in `IconBase`; duotone reuses the regular path when identical. `sideEffects: false` + pure annotations keep it tree-shakeable — importing one icon ships one icon.

Generated icons take a different route: they store one drawing and derive the six weights from it, so a component holds a path array instead of six path sets. That keeps the weights coherent (they come from the same geometry) and the component small.

## Publishing

Automated by [`.github/workflows/publish.yml`](.github/workflows/publish.yml) on a version tag:

```bash
npm version patch && git push --follow-tags
```

Or manually: `npm run build:all && npm publish --access public`.

## License

MIT © Shashi Hans. Icon artwork is derived from [Phosphor Icons](https://github.com/phosphor-icons/core) (MIT © 2020 Phosphor Icons); see [`LICENSE`](LICENSE).
