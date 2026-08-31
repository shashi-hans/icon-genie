// The Supabase store driver: the same interface as the in-memory one in
// store.js, backed by Postgres. Selected with STORE_DRIVER=supabase.
//
// It speaks PostgREST over plain fetch rather than using @supabase/supabase-js or
// a Postgres client, for two reasons. This repo publishes `icon-genie`
// and has no runtime dependencies at all, so a package added here would be
// installed by everyone who installs the icon library. And a serverless function
// holding a direct Postgres connection exhausts the connection limit under any
// load worth having — REST has no connection to hold.
//
// Schema, indexes, RLS, and the retention note live in
// supabase/migrations/0001_init.sql. Apply that before switching the driver on.
//
// The key used here is the service_role key, which bypasses RLS by design. It
// must never reach a page: every table is reached only through this project's own
// API, which does its own authorization — the queue behind an admin session,
// history scoped to the caller's own guest id.
import { HttpError } from "./http.js";
import { iconFromSubmission, readSeed, seedMtime, toSummary } from "./icons.js";
import "./env.js";

const TIMEOUT_MS = 8000;

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

/**
 * A filter value, percent-encoded.
 *
 * Not double-quoted: PostgREST takes an encoded `%22` as a literal quote
 * character rather than as syntax, so quoting makes every lookup match a value
 * that has quotes in it — nothing. Encoding is what keeps a comma, an ampersand,
 * or a hash in the data (dedupe_key carries free text) from being read as query
 * syntax; for `eq` a decoded comma is a plain character, not a separator.
 */
function eq(value) {
  return `eq.${encodeURIComponent(String(value))}`;
}

/**
 * The row total PostgREST puts after the slash in content-range: "0-24/137",
 * or "*\/0" for an empty result. Missing or unparseable reads as 0, so a queue
 * summary degrades to a wrong number rather than to an error page.
 */
function contentRangeTotal(headers) {
  const total = Number(headers.get("content-range")?.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

/** Postgres returns "+00:00"; the rest of the API speaks the "Z" form. */
function iso(value) {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

function fromSubmissionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    paths: row.paths ?? [],
    prompt: row.prompt ?? "",
    summary: row.summary ?? "",
    source: row.source ?? "unknown",
    contributor: row.contributor || "Anonymous",
    dedupeKey: row.dedupe_key ?? "",
    guestId: row.guest_id ?? "",
    status: row.status,
    createdAt: iso(row.created_at),
    reviewedAt: iso(row.reviewed_at),
    reviewedBy: row.reviewed_by ?? null,
    note: row.note ?? null,
  };
}

function fromHistoryRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    guestId: row.guest_id,
    kind: row.kind,
    name: row.name,
    paths: row.paths ?? [],
    createdAt: iso(row.created_at),
    submissionId: row.submission_id ?? null,
  };
}

/** An error carrying the SQLSTATE, so a caller can tell a race from a fault. */
class PostgrestError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "PostgrestError";
    this.status = status;
    this.code = code;
  }
}

/**
 * https only, the one exception being loopback so a local stand-in can be used in
 * a test. The key sent on every request bypasses RLS, so plaintext would put a
 * database password on the wire.
 */
function checkedBase(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`SUPABASE_URL is not a URL: "${raw}"`);
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error("SUPABASE_URL must be https.");
  }
  return raw.replace(/\/+$/, "");
}

export function createSupabaseStore() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    // Refusing to start beats starting with a store that answers every read with
    // an error at request time.
    throw new Error(
      "STORE_DRIVER=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. See .env.example."
    );
  }
  const rest = `${checkedBase(url)}/rest/v1`;

  // `withHeaders` returns { data, headers } instead of the rows, which is how a
  // count is read: PostgREST reports it in content-range, never in the body.
  async function sb(method, path, { body, prefer, withHeaders = false } = {}) {
    const headers = {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: "application/json",
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (prefer) headers.prefer = prefer;

    let res;
    try {
      res = await fetch(`${rest}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Includes the timeout. The database host is left out of what propagates.
      console.error(`supabase ${method} ${path} unreachable:`, err);
      throw new HttpError(503, "The database did not respond. Try again shortly.");
    }

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      // PostgREST reports {code, message, details, hint}. The code is what makes
      // a unique violation distinguishable from a real fault.
      const detail = data?.message || `HTTP ${res.status}`;
      console.error(`supabase ${method} ${path} -> ${res.status}: ${detail}`);
      throw new PostgrestError(detail, res.status, data?.code);
    }
    return withHeaders ? { data, headers: res.headers } : data;
  }

  // Built icons, read from docs/icons.json. Git is the source of truth for
  // artwork, so the catalogue is never copied into Postgres: a contributed icon
  // is derived from its approved submission row instead, which means there is no
  // second copy of a drawing that can drift out of step.
  //
  // Rebuilt when docs/icons.json changes, so `npm run build:icons` shows up
  // without a restart. The mtime check is a stat per catalogue read, which is
  // nothing beside parsing the file itself.
  /** @type {Map<string, object>|null} */
  let seed = null;
  let seedAt = -1;
  /** @type {object[]|null} the same icons, name-sorted */
  let seedSorted = null;
  function seedMap() {
    const at = seedMtime();
    if (!seed || at !== seedAt) {
      seed = new Map(readSeed().map((icon) => [icon.name, icon]));
      seedSorted = null;
      seedAt = at;
    }
    return seed;
  }

  /**
   * The built icons, name-sorted, sorted once per rebuild rather than per
   * request. docs/icons.json is written in component order, so this is a real
   * sort, and doing it on every catalogue read cost most of a page request.
   *
   * Callers must not mutate the result: it is the cached array itself, handed
   * out without copying because a page request only ever filters or slices it.
   */
  function seedList() {
    seedMap();
    if (!seedSorted) seedSorted = [...seed.values()].sort(byName);
    return seedSorted;
  }

  const byName = (a, b) => a.name.localeCompare(b.name);

  /** Approved submissions as catalogue entries, built icons excluded. */
  async function contributedIcons() {
    const rows = await sb(
      "GET",
      "/submissions?status=eq.approved&select=id,name,contributor,paths&order=created_at.asc"
    );
    const built = seedMap();
    return (rows ?? [])
      .filter((row) => !built.has(row.name))
      .map((row) =>
        iconFromSubmission({
          id: row.id,
          name: row.name,
          contributor: row.contributor,
          paths: row.paths ?? [],
        })
      );
  }

  // Warned once per process rather than per request, which at one request per
  // page load would otherwise fill the log.
  let warnedNoHiddenTable = false;

  // The hidden set is read on every catalogue build, so it is cached. Hiding or
  // restoring clears it, which makes the change immediate on the instance that
  // did it; the TTL bounds how long another instance can serve a stale set.
  const HIDDEN_TTL_MS = 15000;
  /** @type {Set<string>|null} */
  let hiddenSet = null;
  let hiddenReadAt = 0;
  const invalidateHidden = () => { hiddenSet = null; };

  /**
   * Names an admin has taken out of the gallery.
   *
   * Tolerates the table not being there. It arrives in migration 0003, and the
   * whole catalogue is built through here — without this guard a database that
   * has not been migrated yet serves 500 for every icon request, taking the
   * gallery down over a feature it is not using. Nothing is hidden until the
   * migration is applied, and the log says so.
   */
  async function hiddenNames() {
    if (hiddenSet && Date.now() - hiddenReadAt < HIDDEN_TTL_MS) return hiddenSet;
    try {
      const rows = await sb("GET", "/hidden_icons?select=name");
      hiddenSet = new Set((rows ?? []).map((row) => row.name));
      hiddenReadAt = Date.now();
      return hiddenSet;
    } catch (err) {
      // PGRST205: PostgREST cannot find the table in its schema cache.
      if (err instanceof PostgrestError && err.code === "PGRST205") {
        if (!warnedNoHiddenTable) {
          warnedNoHiddenTable = true;
          console.warn(
            "supabase: no hidden_icons table — apply supabase/migrations/0003_hidden_icons.sql. " +
              "Serving every icon; admin hide/restore will fail until then."
          );
        }
        hiddenSet = new Set();
        hiddenReadAt = Date.now();
        return hiddenSet;
      }
      throw err;
    }
  }

  /** Merge two name-sorted lists without re-sorting either. */
  function mergeByName(a, b) {
    const out = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) out.push(byName(a[i], b[j]) <= 0 ? a[i++] : b[j++]);
    while (i < a.length) out.push(a[i++]);
    while (j < b.length) out.push(b[j++]);
    return out;
  }

  /**
   * The merged catalogue: built icons, then contributions that do not shadow
   * one, minus anything an admin has hidden. Hiding is applied last so it can
   * reach a built icon, which nothing else in here can remove.
   */
  async function catalogue() {
    const [hidden, contributed] = await Promise.all([hiddenNames(), contributedIcons()]);
    const built = seedList();
    // The usual case: nothing hidden and every contribution already built. Then
    // the answer is the cached array, with no copy, filter or sort at all.
    if (!hidden.size && !contributed.length) return built;
    const merged = contributed.length
      ? mergeByName(built, [...contributed].sort(byName))
      : built;
    return hidden.size ? merged.filter((icon) => !hidden.has(icon.name)) : merged;
  }

  return {
    driver: "supabase",

    async createSubmission(rec) {
      const payload = {
        name: rec.name,
        paths: rec.paths,
        prompt: rec.prompt ?? "",
        summary: rec.summary ?? "",
        source: rec.source ?? "unknown",
        contributor: rec.contributor || "Anonymous",
        dedupe_key: rec.dedupeKey,
        guest_id: rec.guestId,
      };
      try {
        const rows = await sb("POST", "/submissions", { body: payload, prefer: "return=representation" });
        return fromSubmissionRow(rows?.[0]);
      } catch (err) {
        // The caller checks for a duplicate first, but two requests can both pass
        // that check; the unique index on dedupe_key is what actually settles it.
        // Reported the same way the caller's own check reports it.
        if (err instanceof PostgrestError && err.code === UNIQUE_VIOLATION) {
          throw new HttpError(
            409,
            `"${rec.name}" was submitted a moment ago. Change the name or summary to submit a variant.`
          );
        }
        throw err;
      }
    },

    async findSubmissionByDedupeKey(key_) {
      const rows = await sb("GET", `/submissions?dedupe_key=${eq(key_)}&limit=1`);
      return fromSubmissionRow(rows?.[0]) ?? null;
    },

    async listSubmissions({ status, limit = 200 } = {}) {
      const filter = status ? `&status=${eq(status)}` : "";
      const rows = await sb("GET", `/submissions?select=*${filter}&order=created_at.desc&limit=${Number(limit)}`);
      return (rows ?? []).map(fromSubmissionRow);
    },

    /**
     * Exact totals per status, one HEAD-shaped request each rather than a walk
     * over the rows: a listing is paged, and a count taken from a page is not a
     * total. `limit=0` asks for no rows at all; the number arrives in the header.
     */
    async countSubmissions() {
      const statuses = ["pending", "approved", "rejected"];
      const results = await Promise.all(
        statuses.map((status) =>
          sb("GET", `/submissions?select=id&status=${eq(status)}&limit=0`, {
            prefer: "count=exact",
            withHeaders: true,
          })
        )
      );
      const counts = {};
      statuses.forEach((status, i) => {
        counts[status] = contentRangeTotal(results[i].headers);
      });
      return counts;
    },

    async getSubmission(id) {
      const rows = await sb("GET", `/submissions?id=${eq(id)}&limit=1`);
      return fromSubmissionRow(rows?.[0]) ?? null;
    },

    async updateSubmission(id, patch) {
      const rows = await sb("PATCH", `/submissions?id=${eq(id)}`, {
        body: {
          status: patch.status,
          reviewed_by: patch.reviewedBy,
          note: patch.note ?? null,
          reviewed_at: new Date().toISOString(),
        },
        prefer: "return=representation",
      });
      return fromSubmissionRow(rows?.[0]) ?? null;
    },

    /** Admin correction of the public credit. Nothing else about the row changes. */
    async setSubmissionContributor(id, contributor) {
      const rows = await sb("PATCH", `/submissions?id=${eq(id)}`, {
        body: { contributor },
        prefer: "return=representation",
      });
      return fromSubmissionRow(rows?.[0]) ?? null;
    },

    async deleteSubmission(id) {
      const rows = await sb("DELETE", `/submissions?id=${eq(id)}`, { prefer: "return=representation" });
      return fromSubmissionRow(rows?.[0]) ?? null;
    },

    async addHistory(rec) {
      const rows = await sb("POST", "/history", {
        body: {
          guest_id: rec.guestId,
          kind: rec.kind,
          name: rec.name,
          paths: rec.paths,
          submission_id: rec.submissionId ?? null,
        },
        prefer: "return=representation",
      });
      return fromHistoryRow(rows?.[0]);
    },

    async listHistory(guestId, limit = 50) {
      const rows = await sb(
        "GET",
        `/history?guest_id=${eq(guestId)}&order=created_at.desc&limit=${Number(limit)}`
      );
      return (rows ?? []).map(fromHistoryRow);
    },

    async listIcons() {
      return catalogue();
    },

    /**
     * Whether the catalogue has this name at all, hidden or not.
     *
     * Deliberately not `listIcons().some(...)`: that costs two round trips and a
     * sort of the whole catalogue to answer one yes/no. A built icon is answered
     * from the cached seed with no query; anything else takes one indexed lookup.
     * Hidden names still count, so hiding an already-hidden icon stays a no-op
     * rather than a 404.
     */
    async hasIcon(name) {
      if (seedMap().has(name)) return true;
      const rows = await sb(
        "GET",
        `/submissions?status=eq.approved&name=${eq(name)}&select=id&limit=1`
      );
      return (rows ?? []).length > 0;
    },

    async listIconSummaries() {
      return (await catalogue()).map(toSummary);
    },

    /**
     * Take a name out of the gallery, whatever kind of icon it is. Idempotent:
     * hiding an already-hidden name is not an error, which matters when the
     * caller is working through a long list.
     */
    async hideIcon(name, by) {
      await sb("POST", "/hidden_icons?on_conflict=name", {
        body: { name, hidden_by: by ?? null },
        prefer: "resolution=merge-duplicates",
      });
      invalidateHidden();
      return true;
    },

    /** Put a hidden name back. True when it was hidden and now is not. */
    async unhideIcon(name) {
      const rows = await sb("DELETE", `/hidden_icons?name=${eq(name)}`, {
        prefer: "return=representation",
      });
      invalidateHidden();
      return (rows ?? []).length > 0;
    },

    /** Hidden names, newest first, for review and for pruning raw-svgs/ later. */
    async listHiddenIcons() {
      const rows = await sb("GET", "/hidden_icons?select=name,hidden_at,hidden_by&order=hidden_at.desc");
      return (rows ?? []).map((row) => ({
        name: row.name,
        hiddenAt: iso(row.hidden_at),
        hiddenBy: row.hidden_by ?? null,
      }));
    },

    /**
     * Nothing to write: the catalogue is derived, so an approved submission row
     * already puts the icon in listIcons(). What this still does is answer the
     * question the memory driver answers by refusing the write — a built icon of
     * the same name wins, because that is the one the npm package exports.
     */
    async upsertIcon(icon) {
      const built = seedMap().get(icon.name);
      if (built && !built.contributed && icon.contributed) return built;
      return icon;
    },

    /**
     * Also derived: an icon leaves the catalogue when its submission stops being
     * approved, which the caller has already done by deleting or reviewing the
     * row. Reports whether the name is in fact gone from the catalogue.
     */
    async removeIcon(name) {
      if (seedMap().has(name)) return false; // a built icon, not ours to remove
      const rows = await sb("GET", `/submissions?status=eq.approved&name=${eq(name)}&select=id&limit=1`);
      return (rows ?? []).length === 0;
    },

    /**
     * Count a page view and, for a guest id not seen before, a visitor. Both
     * happen inside one function call because concurrent page loads through
     * read-modify-write here would lose counts.
     */
    async recordVisit(guestId, count = true, country = "") {
      const body = { p_guest_id: guestId ?? "", p_count: Boolean(count) };
      let result;
      try {
        // The function normalises anything unusable to 'ZZ', so a missing or
        // malformed header never fails the page load.
        result = await sb("POST", "/rpc/record_visit", {
          body: { ...body, p_country: String(country ?? "") },
        });
      } catch (err) {
        // Migration 0004 adds the country argument. Until it is applied the
        // three-argument function does not exist, and PostgREST answers 404
        // (PGRST202, "no function matches"). Every page calls this on load, so
        // falling back to the older signature keeps the site working on a
        // database that is a migration behind, rather than turning a pending
        // migration into a site-wide 500.
        if (err?.status !== 404) throw err;
        console.warn("record_visit has no country argument; apply migration 0004");
        result = await sb("POST", "/rpc/record_visit", { body });
      }
      return {
        visitors: Number(result?.visitors ?? 0),
        views: Number(result?.views ?? 0),
      };
    },

    /**
     * The per-country tally, busiest first, with unknown last however large it
     * is: it is the absence of a country rather than a place, so leading the
     * table with it buries the real ones. Aggregates only — there is no row
     * anywhere linking a country to a guest id.
     */
    async listVisitorCountries() {
      let rows;
      try {
        rows = await sb("GET", "/visit_countries?order=visitors.desc,views.desc");
      } catch (err) {
        // Same reason as above: the table arrives with migration 0004. An empty
        // tally reads as "nothing recorded yet", which is what the admin page
        // shows anyway before any visit has been counted.
        if (err?.status !== 404) throw err;
        return [];
      }
      // Sorted here rather than in the query: PostgREST's `order` takes columns,
      // not expressions, so "unknown last" cannot be asked for in the URL.
      return (rows ?? [])
        .map((r) => ({
          country: r.country,
          views: Number(r.views ?? 0),
          visitors: Number(r.visitors ?? 0),
          lastSeen: iso(r.last_seen),
        }))
        .sort((a, b) => {
          if ((a.country === "ZZ") !== (b.country === "ZZ")) return a.country === "ZZ" ? 1 : -1;
          return b.visitors - a.visitors || b.views - a.views;
        });
    },
  };
}
