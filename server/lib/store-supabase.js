// The Supabase store driver: the same interface as the in-memory one in
// store.js, backed by Postgres. Selected with STORE_DRIVER=supabase.
//
// It speaks PostgREST over plain fetch rather than using @supabase/supabase-js or
// a Postgres client, for two reasons. This repo publishes `@shashi-hans/icons`
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
import { iconFromSubmission, readSeed, toSummary } from "./icons.js";
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

  async function sb(method, path, { body, prefer } = {}) {
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
    return data;
  }

  // Built icons, read once per process from docs/icons.json. Git is the source of
  // truth for artwork, so the catalogue is never copied into Postgres: a
  // contributed icon is derived from its approved submission row instead, which
  // means there is no second copy of a drawing that can drift out of step.
  /** @type {Map<string, object>|null} */
  let seed = null;
  function seedMap() {
    if (!seed) seed = new Map(readSeed().map((icon) => [icon.name, icon]));
    return seed;
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

  /** The merged catalogue: built icons, then contributions that do not shadow one. */
  async function catalogue() {
    return [...seedMap().values(), ...(await contributedIcons())].sort(byName);
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

    async listIconSummaries() {
      return (await catalogue()).map(toSummary);
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
    async recordVisit(guestId, count = true) {
      const result = await sb("POST", "/rpc/record_visit", {
        body: { p_guest_id: guestId ?? "", p_count: Boolean(count) },
      });
      return {
        visitors: Number(result?.visitors ?? 0),
        views: Number(result?.views ?? 0),
      };
    },
  };
}
