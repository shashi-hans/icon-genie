# @shashi-hans/icons

A tree-shakeable React icon library. Each icon is one component with a `weight` prop — `thin`, `regular`, `fill`, or `duotone`. TypeScript-first, `currentColor` by default, ESM + CJS, `react` as the only peer.

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
| `weight` | `thin \| regular \| fill \| duotone` | `"regular"` | which weight to render |
| `aria-label` | `string` | — | sets `role="img"`; omit to keep decorative |

**Removed weights still work.** `light`, `bold` and `sharp` are no longer weights the library offers and are absent from `ICON_WEIGHTS`, but they still type-check and still render — `light` as `thin`, `bold` and `sharp` as `regular` — so existing calls do not break. The six `-{thin,light,regular,bold,fill,duotone}.svg` files on disk are untouched: `scripts/utils.js` separates what exists as artwork (`SOURCE_WEIGHTS`) from what the library offers (`WEIGHTS`).

## Finding an icon

- **Gallery** (searchable, click-to-copy): the Vercel deployment, or `npm run dev` for a local one
- **Editor autocomplete** on `import { } from "@shashi-hans/icons"`
- **At runtime:** `generateMetadata().iconNames`

## Generating an icon that does not exist yet

The gallery has a **✨ Generate** button ([`sh-icon-genie`](https://github.com/shashi-hans/icon-genie)). Describe an icon, get 1–4 centerline paths back, preview all four weights, then download it or open a pull request adding it to this library. Three sources:

| Source | What it uses | Steps | Cost |
| --- | --- | --- | --- |
| **Free (no setup)** | a free hosted model, reached through this site's `/api/ai` relay | describe → Generate | free, no account, roughest geometry |
| **Your API key** | your own OpenAI-compatible key, called from the tab | describe → Generate | your provider's billing |
| **Your AI chat (manual)** | copy the prompt, paste the reply back | describe → copy → paste → Generate | your existing subscription |

The first two are one step. The third is not automatable, and that is not an oversight: a web page cannot read the session of an AI service you are signed in to elsewhere. The same-origin policy prevents it by design, and anything that worked around it would be credential theft. It exists as the fallback for having no key when the free model is unavailable.

With **Your API key**, the key is sent only to the provider you name and never reaches this site's server. By default it lives in the input and is dropped when the dialog closes. Ticking **Remember on this device** puts it in `localStorage` instead, which any script on the page could read — convenient on your own machine, wrong on a shared one. Off by default; unticking deletes the stored copy immediately.

With **Free (no setup)**, the description you type goes to this site's server and on to the model host. Nothing else about you is sent, and no key is involved. The relay exists because the model host answers no CORS preflight, so the page cannot read a reply it fetches itself; keeping the call server-side also means a host that starts requiring a key needs no change in the page.

Model output is validated in the browser before it renders — path syntax, path count, coordinate framing, and an SVG sanitizer that rejects scripts, event handlers, and external references. All three sources run that gate: a relayed reply is the same untrusted model output as a direct one.

**Download source** saves `<name>.centerline.svg`, the exact file this repo stores. **Contribute to library** submits the icon to a review queue an admin works through (below).

## The site

The gallery is no longer only static. `docs/` is served as files; everything server-side lives in `server/`.

```
server/
  router.js        the routing table, shared by both entry points
  lib/             store, sessions, validation, publishing, icon catalogue
  routes/          one module per endpoint
api/[...path].js   the only file under api/ — Vercel finds functions there, so
                   this catch-all hands off to server/router.js
```

`scripts/dev-server.js` uses the same `server/router.js`, so local and deployed routing cannot drift apart.

**Vercel is the only deploy target.** A GitHub Pages workflow used to publish `docs/` on every push, from when the gallery read `docs/icons.json` in the browser. It now reads `/api/icons`, and generation, contribution, review, and the visitor count are all server-side, so a static host serves a page whose grid never fills. Keeping it would have meant maintaining a second, permanently degraded build. If a free public mirror is wanted back, the way to do it is a fallback in `index.html` to a committed `icons.json` — browse-only, with the buttons hidden — not a second deploy of the same page.

| Route | Method | Who | Does |
| --- | --- | --- | --- |
| `/api/ai/chat/completions` | POST | anyone | relays a free generation to the model host; 6 calls per IP per minute |
| `/api/auth/me` | GET | anyone | reports `admin` or `guest`; mints the guest cookie; returns visit counts, and records one with `?visit=1` |
| `/api/auth/login` | POST | anyone | checks `ADMIN_PASSWORD`, starts an admin session |
| `/api/auth/logout` | POST | anyone | ends it |
| `/api/history` | GET, POST | anyone | reads/appends **only the caller's own** history |
| `/api/submissions` | POST | anyone | submit an icon for review |
| `/api/submissions` | GET | admin | the review queue |
| `/api/submissions/:id` | GET, PATCH | admin | one submission; approve / reject / rename contributor |
| `/api/submissions/:id` | DELETE | admin | remove it and its published source file |
| `/api/icons` | GET | anyone | one page of icons at every weight; `q`, `offset`, `limit` |
| `/api/icons/all` | GET | anyone | the same, kept for callers already on that path |

**Visitors are guests by default.** No account is needed to browse, generate, or contribute — the header shows `Guest`, and a signed `sh_guest` cookie keys their history. That cookie is an identifier, not a credential: it grants nothing but read access to the history filed under it, so forging one gains an attacker nothing.

**Admin** means one shared password (`ADMIN_PASSWORD`), compared in constant time, which issues a signed `sh_admin` session cookie. Both cookies are `HttpOnly` and HMAC-signed with `SESSION_SECRET`, so page scripts cannot read them and a tampered value is rejected. Authorization is enforced in every handler, not by hiding UI: the admin page renders its login gate purely as presentation, and `GET /api/submissions` returns 403 to a guest regardless of what the page shows.

Two limits worth knowing before this carries real traffic:

- **One shared admin credential** gives no record of who acted, and revoking access means rotating it for everyone. Fine for a private queue, wrong past a couple of admins — the upgrade is an identity provider, and GitHub OAuth fits because an admin here is already someone who merges the icon PRs.
- **Login throttling is per-instance.** [server/lib/http.js](server/lib/http.js) counts attempts in memory, so on serverless an attacker spread across instances gets more than the stated 10 per 15 minutes. It raises the cost of guessing; it does not replace a strong password. Move it into the store for a limit that holds.

**Response headers** are set in [vercel.json](vercel.json): `nosniff`, `strict-origin-when-cross-origin`, `x-frame-options: DENY`, and a CSP that pins `default-src` to `'self'` with `object-src`/`base-uri`/`frame-ancestors` at `'none'`. `connect-src` allows any `https:` origin because bring-your-own-key generation posts from the page to whichever provider the user names. The CSP carries `script-src 'unsafe-inline'`, which is most of what a CSP is for: both pages keep their script in an inline `<script type="module">`, and the directive cannot be tightened until that moves to a file. What it does buy is the plugin, base-tag, and framing directives, and a `connect-src` that stops an injected script from posting anywhere but over https. Moving the two inline scripts out and dropping `'unsafe-inline'` is the change that makes it real.

### Visitor count

The header shows unique visitors, with page views in its tooltip. Uniqueness is judged by the **guest cookie that already exists for history** — no IP is read or stored, which keeps the counter clear of DPDP obligations and costs nothing in accuracy that matters here.

It rides on `/api/auth/me`, which every page already calls once on load and which already has the guest id, so there is no second request. Only `?visit=1` records, and only the gallery sends it — reviewing icons in the admin page would otherwise inflate the number.

Both numbers are counter rows in `site_counters`. `visit_guests` still decides whether a guest is new, but it is no longer counted: `select count(*)` over a table that gains a row per visitor is a sequential scan on every page load, and it also meant the number would drop as soon as old guest ids were pruned. Incrementing a counter only when the insert actually inserts fixes both. A guest who returns after their row is pruned counts twice, which is the price of not keeping their id forever.

With the memory store the counters reset whenever the instance recycles. A KV driver would use `INCR` for views and a set for visitors.

### Reviewing submissions

[docs/admin.html](docs/admin.html) lists each submission with all four weights rendered, the icon name and derived component name, what the user asked for, the model's summary, path count, source, timestamp, submitter id, and the target file path. **Approve** / **Reject** records the decision, and the guest sees the outcome in their own History.

**Contributors are credited.** A name field sits directly above the Contribute button, capped at 20 characters, and the icon's detail panel shows a `Contributor :` line. Submitting with it empty asks once, inline, whether to contribute without a name — a blank field is far more often "not filled in yet" than "credit me as Anonymous", and the credit is public and permanent once approved. Choosing *Contribute as Anonymous* proceeds; *Add my name* returns focus to the field. The name is remembered in `localStorage` so a repeat contributor types it once.

It is the only self-described identity the API accepts — no email, no handle, nothing that could contact or resolve a person — and [server/lib/validate.js](server/lib/validate.js) strips control, zero-width, and bidi-override characters so a name cannot render as something other than what is stored. Because it is shown publicly, the field says so before you type in it.

**Admin-only powers, available in both places, each confirmed in place.** They sit on the review page and in the gallery's own detail dialog for any community icon — once an icon is live, the gallery is where a wrong credit or a bad drawing gets noticed. *Change contributor* rewrites the public credit (sanitized and capped like any other name, status untouched); *Delete* removes the submission, takes it out of the gallery, and deletes its published source file — the mirror of approving. Both show an inline confirmation first rather than acting on one click, since one is destructive and the other rewrites something shown publicly. Deleting frees the dedupe key, so the icon can be contributed again. Neither notifies the contributor.

**One submission per icon.** Identity is the icon name plus its summary, normalized for case and spacing, so a repeated send returns 409 rather than putting the same drawing in front of an admin twice. The name alone would be too coarse (two different drawings can both be "shield"); the paths would be too fine, since regenerating shifts a coordinate and would read as new. Changing either field submits a variant. A database driver should enforce this with a UNIQUE constraint on `dedupeKey` — the current read-then-write check is safe only because the memory store is single-threaded per instance.

**Icons come from the API one page at a time, and the search runs there too.** `/api/icons` takes `q`, `offset` and `limit` and answers with that slice at every weight, so the weight selector and the detail dialog work the moment the grid paints. `limit` is capped at 400, which is about 1.2 MB.

This replaced a two-stage load that fetched the whole catalogue and filtered in the browser. At 8,378 icons that meant a 25 MB response — past the body limit a serverless function will return — and 8,378 cells with a listener each on first paint. Neither number was a problem at 1,547 icons, and both became one without any single change causing it.

**The page size is measured, not fixed.** `pageSize()` in [docs/index.html](docs/index.html) works out how many cells fit from the grid's column width, the viewport height and the current preview size, then adds a screen of slack; the result is clamped to 48–400. Measured across four viewports it asks for 48 cells at 800×513 and 285 at 2560×1313. The cell size is a user control, so a fixed page size would be wrong at one end or the other: at preview size 16 a large screen holds several hundred cells, at 96 a few dozen.

Typing fires a request per keystroke burst, so the search is debounced 220 ms and every response carries a ticket — only the newest one paints, because they can arrive out of order.

The catalogue is seeded from the built `docs/icons.json`, so git stays the source of truth for artwork and the API is the serving copy. That file is generated by the build, not committed, so `vercel.json` lists it under `functions.includeFiles` — a path read with `readFileSync` is not one the bundler can trace, and without the entry the deployed function serves an empty catalogue.

**A contribution cannot take a built icon's name.** `build:icons` reads `raw-svgs/<name>/<name>.centerline.svg` in preference to the six weight files beside it, so approving a `heart` would replace the shipped `heart` at the next build. [server/routes/submissions.js](server/routes/submissions.js) refuses the name at submission time, where the contributor can still change it, and [publish.js](server/lib/publish.js) refuses to write into or delete from a directory holding built artwork.

**Approving adds the icon to that catalogue immediately**, so it appears in the gallery on the next load rather than at the next build, marked with a green `NEW` badge. Renaming a contributor updates the catalogue too, and deleting removes it — but only when the deleted submission is what put it there, so a built icon sharing a name is never touched. Deleting takes the published source file with it only where an approval published one; a pending or rejected submission has no file, and its name is not reason enough to delete one. Responses carry the credit a contributor asked to have shown and nothing else about them.

An approved icon is in the gallery but **not yet in the npm package**, so its detail panel hides *Copy JSX* and *Copy import* and shows the SVG instead. Offering `import { BankVault } from "@shashi-hans/icons"` would hand out a line that does not resolve. A built-in of the same name always wins, so a contributed icon can never shadow a published one.

**Approving also publishes it to the package.** The icon's centerline file is written to `raw-svgs/<name>/<name>.centerline.svg` — the path `build:icons` reads — so `PolicyDoc` becomes a real export on the next build. What "written" means depends on where the API runs ([server/lib/publish.js](server/lib/publish.js)):

| Environment | What happens |
| --- | --- |
| local (`npm run dev`) | the file is written straight into `raw-svgs/`; run `npm run build:icons` |
| deployed, `GITHUB_TOKEN` set | committed directly to `GH_BASE` over the GitHub API |
| deployed, no token | nothing is written; the icon is still live in the gallery and the admin page hands you the file |

**Approval is the only gate — there is no pull request to merge.** The admin has already reviewed the icon, and a second merge step would strand approved icons in a queue nobody watches. The tradeoff is explicit: nobody reviews the diff, only the drawing. What contains it is how little the commit can touch — one generated file, at a path derived from a kebab-cased name, holding path data the server already validated. The token needs `contents:write` only, scoped to this repo.

A deployed function cannot just write the file: the filesystem is read-only apart from `/tmp` and is rebuilt on every deploy, so a write there would vanish. Reaching git is the only durable path.

Neither strategy runs `build:icons` — it optimizes 9k SVGs and rewrites `src/`, far too much for a request. Committing the source file is the durable step; the build happens on the next deploy or release, and `prepublishOnly` runs it before publishing.

Publishing never throws. An admin's approval stands even if the commit fails, and the admin page reports the outcome rather than implying success. Approval only publishes on the transition *into* approved, so re-approving does not commit twice.

Once the icon is built, the built version takes over from the merged one: the name-collision rule means one cell, no `NEW` badge, and the normal JSX and import snippets return.

### The free-model relay

[server/routes/ai-chat.js](server/routes/ai-chat.js) forwards free generations to a chat-completions host, defaulting to the icon-genie proxy worker. `FREE_MODEL_BASE`, `FREE_MODEL`, and `FREE_MODEL_KEY` override the host, the model, and a key if the host needs one; all three are optional, and none of them can be set from a request, so nobody can aim the relay at an internal address.

The relay rebuilds the outgoing request from `messages` alone, pinning the model, temperature, and a 2000-token ceiling. It is still an unauthenticated endpoint that spends a model quota on arbitrary text, which is the unavoidable shape of "free, no key" — the same exposure the upstream worker already has open to the internet, now also reachable through this origin. Against that there is a 6-per-minute per-IP limit, which is in memory and therefore per-instance: a speed bump, not a control. Requiring a session, or moving the counter into `store.js`, is the upgrade if it is ever abused.

### Storage

[server/lib/store.js](server/lib/store.js) is the only module that knows how data is persisted, and there is **one driver: Supabase**, Postgres over PostgREST in [store-supabase.js](server/lib/store-supabase.js). `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required. Without them the static gallery still serves and every request that needs data fails. `STORE_DRIVER` is vestigial: leave it unset, or set it to `supabase`. Any other value is refused, so an old deployment fails loudly instead of quietly reading a database it did not ask for.

An in-memory driver used to stand in when those variables were absent, so a fresh checkout ran with no configuration. It was removed: on serverless it was per-instance and lost on recycle, which made the flows it let you demo not the flows that would run, and both pages carried a banner apologising for it. Needing a database beats pretending to have one. The cost is worth stating plainly: **a clone of this repo can no longer exercise contribution, review, or history without Supabase credentials.**

A second driver is eighteen methods against your own client, returned from the factory in `store.js`; nothing else changes. Two of them have contracts worth reading before you implement them: `countSubmissions` returns exact totals per status and must not be derived from a page of `listSubmissions`, and `removeIcon` returns whether the name is no longer served, not whether this call is what removed it.

Submissions, guest history, and the visitor table are personal data under the DPDP Act 2023 — all three key on the guest id — so the database belongs in ap-south-1. **The retention window is still undecided**, and until it is, guest ids are kept indefinitely. [0002](supabase/migrations/0002_visit_counter_and_retention.sql) adds `prune_personal_data(days)`, which clears all three tables and keeps pending submissions (an unreviewed one is still doing its job). Pick a window, then schedule it:

```sql
select cron.schedule('prune-personal-data', '0 3 * * *', $$select prune_personal_data(180)$$);
```

#### Setting up Supabase

1. Create the project in **South Asia (Mumbai) / ap-south-1**. Residency is the constraint, not latency.
2. Run the migrations in order in the SQL editor (or `supabase db push`). [0001](supabase/migrations/0001_init.sql) creates `submissions`, `history`, `visit_guests`, `site_counters`, the `record_visit` function, and the 50-per-guest history trim, then turns RLS on and revokes the anon role's access. [0002](supabase/migrations/0002_visit_counter_and_retention.sql) moves the visitor number to a counter row and adds `prune_personal_data(days)`; it backfills from whatever `visit_guests` already holds, so an existing deployment keeps its number.
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — locally in `.env.local`, on Vercel as Environment Variables. No `STORE_DRIVER` needed.

The driver uses the **service_role** key, which bypasses RLS. That is deliberate: the browser never talks to PostgREST, so authorization stays in this API, where it already lives — the queue behind an admin session and history scoped to the caller's own guest cookie. The key is a database password in effect; it must never reach a page or a log. RLS with no policies plus the revoked grants means a leaked anon key (a public value by design) reads nothing.

No package is added for any of this — PostgREST is called with `fetch`. A Postgres client would also have to be a runtime dependency of a published icon library, and would hold connections a serverless function cannot afford.

**The icon catalogue is not in Postgres.** Built icons come from `docs/icons.json`, generated from `raw-svgs/`, so git stays the source of truth for artwork; a contributed icon is derived from its approved submission row on read. There is no second copy of a drawing to drift, and `upsertIcon`/`removeIcon` have nothing to write — they only apply the rule that a built icon of the same name wins. Because the catalogue is derived rather than stored, moving an approved icon back to `pending` takes it out of the gallery immediately.

Free-tier notes worth knowing: no backups, and the project pauses after 7 days of inactivity. A paused database fails every API call including `/api/icons`, so the grid goes down with it — `docs/icons.json` is read by the function, not served to the page, and is no fallback.

### Running it locally

```bash
cp .env.example .env.local     # set SESSION_SECRET and ADMIN_PASSWORD
npm install
npm run build:icons            # generates docs/icons.json + docs/icon-genie.js
npm run dev                    # plain Node: serves docs/ and routes /api/* together
                               # npm run dev:vercel uses vercel dev, when the CLI is set up
```

`npx serve docs` still works for the gallery alone, but the API is absent, so login and History hide themselves and contributing fails.

Required environment variables are documented in [.env.example](.env.example). `SESSION_SECRET` is mandatory in production — the server refuses to sign sessions without it rather than fall back to a known key.

## Adding / updating icons

Components are generated from `raw-svgs/`. There are two source formats.

**Drawn icons** — one folder per icon with its weight files, each on a `0 0 256 256` viewBox:

```
raw-svgs/my-icon/my-icon-{thin,light,regular,bold,fill,duotone}.svg   # the six files on disk
```

**Generated icons** — one folder holding a single centerline file with 1–4 `<path d="…">` elements, geometry only, no paint attributes:

```
raw-svgs/my-icon/my-icon.centerline.svg
```

All four weights are derived from those paths at render time by [`StrokeIcon`](src/StrokeIcon.tsx): two stroke widths, a fill, and a duotone. Put each disconnected line in its own path (a clock is a ring path plus a hands path). The coordinates must sit on the 256 grid with no wrapping `transform` — a residual scale would make one icon's `bold` thicker than another's, so the build rejects it.

Then `npm run build:all` (= `build:icons` → `build`). `my-icon` becomes the `MyIcon` component, exported automatically. Preview with `npm run dev` — a static file server is not enough, because the gallery reads its icons from `/api/icons`.

| Script | Does |
| --- | --- |
| `build:icons` | optimize SVGs → generate components → generate index → bundle the gallery's generator |
| `build` | bundle `src/` → `dist/` (ESM + CJS + types) |
| `build:all` | `build:icons` then `build` |
| `typecheck` | `tsc --noEmit` |

`docs/icon-genie.js` is the generator bundled for the browser by `scripts/build-gallery.js`. Like `docs/icons.json` it is generated, not committed — run `npm run build:icons` before serving `docs/`.

## Design notes

One component embeds all four weights and `switch`es at render (so a render allocates one element, not six); the `<svg>` wrapper lives once in `IconBase`; duotone reuses the regular path when identical. `sideEffects: false` + pure annotations keep it tree-shakeable — importing one icon ships one icon.

Generated icons take a different route: they store one drawing and derive the four weights from it, so a component holds a path array instead of six path sets. That keeps the weights coherent (they come from the same geometry) and the component small.

## Publishing

Automated by [`.github/workflows/publish.yml`](.github/workflows/publish.yml) on a version tag:

```bash
npm version patch && git push --follow-tags
```

Or manually: `npm run build:all && npm publish --access public`.

The workflow re-imports Phosphor from a fresh clone on every release, which is where a name can collide: Phosphor keeps growing, and it may ship a name a contributed icon already holds. **The contributed icon keeps the name** — it is already an export of a published package, so moving it would change what `import { Cup }` draws for everyone who has that line. The Phosphor arrival is imported as `cup-phosphor` instead, a new export that breaks nothing, and `import-phosphor.js` prints every rename it made. Sharing one directory is not an option: `generate-components.js` reads a centerline file in preference to the weight files beside it, so the Phosphor drawing would be imported and then silently ignored — which it now warns about, wherever such a pair comes from.

## License

MIT © Shashi Hans. Icon artwork is derived from [Phosphor Icons](https://github.com/phosphor-icons/core) (MIT © 2020 Phosphor Icons); see [`LICENSE`](LICENSE).
