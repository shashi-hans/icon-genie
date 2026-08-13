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
| `/api/icons` | GET | anyone | every icon, **regular weight only** — the fast first payload |
| `/api/icons/all` | GET | anyone | every icon, all six weights |

**Visitors are guests by default.** No account is needed to browse, generate, or contribute — the header shows `Guest`, and a signed `sh_guest` cookie keys their history. That cookie is an identifier, not a credential: it grants nothing but read access to the history filed under it, so forging one gains an attacker nothing.

**Admin** means one shared password (`ADMIN_PASSWORD`), compared in constant time, which issues a signed `sh_admin` session cookie. Both cookies are `HttpOnly` and HMAC-signed with `SESSION_SECRET`, so page scripts cannot read them and a tampered value is rejected. Authorization is enforced in every handler, not by hiding UI: the admin page renders its login gate purely as presentation, and `GET /api/submissions` returns 403 to a guest regardless of what the page shows.

Two limits worth knowing before this carries real traffic:

- **One shared admin credential** gives no record of who acted, and revoking access means rotating it for everyone. Fine for a private queue, wrong past a couple of admins — the upgrade is an identity provider, and GitHub OAuth fits because an admin here is already someone who merges the icon PRs.
- **Login throttling is per-instance.** [server/lib/http.js](server/lib/http.js) counts attempts in memory, so on serverless an attacker spread across instances gets more than the stated 10 per 15 minutes. It raises the cost of guessing; it does not replace a strong password. Move it into the store for a limit that holds.

### Visitor count

The header shows unique visitors, with page views in its tooltip. Uniqueness is judged by the **guest cookie that already exists for history** — no IP is read or stored, which keeps the counter clear of DPDP obligations and costs nothing in accuracy that matters here.

It rides on `/api/auth/me`, which every page already calls once on load and which already has the guest id, so there is no second request. Only `?visit=1` records, and only the gallery sends it — reviewing icons in the admin page would otherwise inflate the number.

With the memory store the counters reset whenever the instance recycles. A KV driver would use `INCR` for views and a set for visitors.

### Reviewing submissions

[docs/admin.html](docs/admin.html) lists each submission with all six weights rendered, the icon name and derived component name, what the user asked for, the model's summary, path count, source, timestamp, submitter id, and the target file path. **Approve** / **Reject** records the decision, and the guest sees the outcome in their own History.

**Contributors are credited.** A name field sits directly above the Contribute button, capped at 20 characters, and the icon's detail panel shows a `Contributor :` line. Submitting with it empty asks once, inline, whether to contribute without a name — a blank field is far more often "not filled in yet" than "credit me as Anonymous", and the credit is public and permanent once approved. Choosing *Contribute as Anonymous* proceeds; *Add my name* returns focus to the field. The name is remembered in `localStorage` so a repeat contributor types it once.

It is the only self-described identity the API accepts — no email, no handle, nothing that could contact or resolve a person — and [server/lib/validate.js](server/lib/validate.js) strips control, zero-width, and bidi-override characters so a name cannot render as something other than what is stored. Because it is shown publicly, the field says so before you type in it.

**Admin-only powers, available in both places, each confirmed in place.** They sit on the review page and in the gallery's own detail dialog for any community icon — once an icon is live, the gallery is where a wrong credit or a bad drawing gets noticed. *Change contributor* rewrites the public credit (sanitized and capped like any other name, status untouched); *Delete* removes the submission, takes it out of the gallery, and deletes its published source file — the mirror of approving. Both show an inline confirmation first rather than acting on one click, since one is destructive and the other rewrites something shown publicly. Deleting frees the dedupe key, so the icon can be contributed again. Neither notifies the contributor.

**One submission per icon.** Identity is the icon name plus its summary, normalized for case and spacing, so a repeated send returns 409 rather than putting the same drawing in front of an admin twice. The name alone would be too coarse (two different drawings can both be "shield"); the paths would be too fine, since regenerating shifts a coordinate and would read as new. Changing either field submits a variant. A database driver should enforce this with a UNIQUE constraint on `dedupeKey` — the current read-then-write check is safe only because the memory store is single-threaded per instance.

**Icons come from the API, in two stages.** `/api/icons` returns all 1527 icons with only their regular weight — 733 KB instead of 4.2 MB — so the grid paints without waiting for bytes it cannot show. `/api/icons/all` follows in the background and replaces it; until then the weight selector and the detail dialog stay on regular, with the tabs disabled rather than showing regular under five other labels.

The catalogue is seeded from the built `docs/icons.json`, so git stays the source of truth for artwork and the API is the serving copy.

**Approving adds the icon to that catalogue immediately**, so it appears in the gallery on the next load rather than at the next build, marked with a green `NEW` badge. Renaming a contributor updates the catalogue too, and deleting removes it — but only when the deleted submission is what put it there, so a built icon sharing a name is never touched. Responses carry the credit a contributor asked to have shown and nothing else about them.

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

[server/lib/store.js](server/lib/store.js) is the only module that knows how data is persisted. `STORE_DRIVER` picks one of two:

| Driver | Persists | Notes |
| --- | --- | --- |
| `memory` (default) | no | per-instance, lost on recycle; both pages warn about it in a banner |
| `supabase` | yes | Postgres over PostgREST — [store-supabase.js](server/lib/store-supabase.js) |

A third driver is fourteen methods against your own client, returned from the factory in `store.js`; nothing else changes.

Submissions and guest history are personal data under the DPDP Act 2023, so the database belongs in ap-south-1, and a retention window is still to be decided — the cleanup query is written out at the end of the migration.

#### Setting up Supabase

1. Create the project in **South Asia (Mumbai) / ap-south-1**. Residency is the constraint, not latency.
2. Run [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) in the SQL editor (or `supabase db push`). It creates `submissions`, `history`, `visit_guests`, `site_counters`, the `record_visit` function, and the 50-per-guest history trim, then turns RLS on and revokes the anon role's access.
3. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `STORE_DRIVER=supabase` — locally in `.env.local`, on Vercel as Environment Variables.

The driver uses the **service_role** key, which bypasses RLS. That is deliberate: the browser never talks to PostgREST, so authorization stays in this API, where it already lives — the queue behind an admin session and history scoped to the caller's own guest cookie. The key is a database password in effect; it must never reach a page or a log. RLS with no policies plus the revoked grants means a leaked anon key (a public value by design) reads nothing.

No package is added for any of this — PostgREST is called with `fetch`. A Postgres client would also have to be a runtime dependency of a published icon library, and would hold connections a serverless function cannot afford.

**The icon catalogue is not in Postgres.** Built icons come from `docs/icons.json`, generated from `raw-svgs/`, so git stays the source of truth for artwork; a contributed icon is derived from its approved submission row on read. There is no second copy of a drawing to drift, and `upsertIcon`/`removeIcon` have nothing to write — they only apply the rule that a built icon of the same name wins. One behaviour differs from the memory driver as a result: moving an approved icon back to `pending` removes it from the gallery, where the memory driver leaves it showing.

Free-tier notes worth knowing: no backups, and the project pauses after 7 days of inactivity — a paused database makes every API call fail, and the gallery grid keeps working only because it is served from `docs/icons.json`.

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
