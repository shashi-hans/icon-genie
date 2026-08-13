// The only module that knows how data is persisted. Everything else talks to
// the interface below, so connecting a real database later is a change here and
// nowhere else.
//
// Two drivers, chosen by STORE_DRIVER:
//
//   memory    (default) in-memory. On serverless this means per-instance and
//             short-lived — two requests can land on different instances, and
//             everything is lost when an instance is recycled. Enough to build
//             and demo the flows against; it is NOT storage.
//   supabase  Postgres over PostgREST. See store-supabase.js and
//             supabase/migrations/0001_init.sql.
//
// The default stays "memory" so a checkout with no configuration runs, and
// isEphemeral() drives the banner both pages show when that is what is serving.
//
// TO ADD ANOTHER DRIVER: implement the same fourteen methods against your client
// and return it from a factory here. Keep it in ap-south-1 — submissions and
// guest history are personal data under the DPDP Act, so residency and the
// retention window are decisions that belong with the schema, not with the
// caller.

/**
 * @typedef {object} Submission
 * @property {string} id
 * @property {string} name          kebab-case icon name
 * @property {string[]} paths       centerline `d` strings
 * @property {string} prompt        what the user asked for
 * @property {string} summary       the model's one-line description
 * @property {string} source        which generation source produced it
 * @property {string} contributor   public display name, <=20 chars, "Anonymous" if unnamed
 * @property {string} dedupeKey     name + summary identity; one submission per icon
 * @property {string} guestId       opaque id of the submitter
 * @property {"pending"|"approved"|"rejected"} status
 * @property {string} createdAt     ISO 8601
 * @property {string|null} reviewedAt
 * @property {string|null} reviewedBy
 * @property {string|null} note      reviewer's note
 */

/**
 * @typedef {object} HistoryEntry
 * @property {string} id
 * @property {string} guestId
 * @property {"generated"|"contributed"} kind
 * @property {string} name
 * @property {string[]} paths
 * @property {string} createdAt
 * @property {string|null} submissionId
 */

/**
 * The storage contract. A database driver must implement exactly this.
 *
 * @typedef {object} Store
 * @property {string} driver             which implementation this is; "memory" means nothing persists
 * @property {(rec: Omit<Submission, "id"|"status"|"createdAt"|"reviewedAt"|"reviewedBy"|"note">) => Promise<Submission>} createSubmission
 * @property {(opts?: {status?: string, limit?: number}) => Promise<Submission[]>} listSubmissions
 * @property {(id: string) => Promise<Submission|null>} getSubmission
 * @property {(key: string) => Promise<Submission|null>} findSubmissionByDedupeKey
 * @property {(id: string, patch: {status: string, reviewedBy: string, note?: string}) => Promise<Submission|null>} updateSubmission
 * @property {(id: string, contributor: string) => Promise<Submission|null>} setSubmissionContributor
 * @property {(id: string) => Promise<Submission|null>} deleteSubmission
 * @property {(rec: Omit<HistoryEntry, "id"|"createdAt">) => Promise<HistoryEntry>} addHistory
 * @property {(guestId: string, limit?: number) => Promise<HistoryEntry[]>} listHistory
 * @property {() => Promise<object[]>} listIcons          every icon, all weights
 * @property {() => Promise<object[]>} listIconSummaries  every icon, regular weight only
 * @property {(icon: object) => Promise<object>} upsertIcon
 * @property {(name: string) => Promise<boolean>} removeIcon
 * @property {(guestId: string, count: boolean) => Promise<{visitors: number, views: number}>} recordVisit
 */

import { randomUUID } from "node:crypto";
import { readSeed, toSummary } from "./icons.js";
import { createSupabaseStore } from "./store-supabase.js";
import "./env.js";

const HISTORY_CAP = 50; // per guest; oldest entries fall off

/** In-memory driver. See the file header for why this is not persistence. */
function createMemoryStore() {
  /** @type {Map<string, Submission>} */
  const submissions = new Map();
  // Secondary index for the one-submission-per-icon rule. A database driver
  // should back this with a UNIQUE constraint on the column rather than a
  // read-then-write check, which two concurrent requests could both pass.
  /** @type {Map<string, string>} */
  const byDedupeKey = new Map();
  /** @type {Map<string, HistoryEntry[]>} */
  const history = new Map();

  // The icon catalogue, keyed by name. Seeded lazily from the built
  // docs/icons.json so the gallery works before any contribution exists; a
  // database driver would read its own table instead and ignore the seed.
  /** @type {Map<string, object>|null} */
  let icons = null;
  function catalogue() {
    if (!icons) {
      icons = new Map(readSeed().map((icon) => [icon.name, icon]));
    }
    return icons;
  }
  const byName = (a, b) => a.name.localeCompare(b.name);

  // Visit counters. Uniqueness is judged by the guest cookie that already exists
  // for history — no IP is read or stored, which keeps this out of DPDP's way and
  // costs nothing in accuracy that matters for a gallery counter. A KV driver
  // would use INCR plus a set (or HyperLogLog) for the same two numbers.
  const visits = { views: 0, seen: new Set() };

  const newest = (a, b) => b.createdAt.localeCompare(a.createdAt);

  return {
    driver: "memory",

    async createSubmission(rec) {
      const row = {
        id: randomUUID(),
        status: "pending",
        createdAt: new Date().toISOString(),
        reviewedAt: null,
        reviewedBy: null,
        note: null,
        ...rec,
      };
      submissions.set(row.id, row);
      if (row.dedupeKey) byDedupeKey.set(row.dedupeKey, row.id);
      return row;
    },

    async findSubmissionByDedupeKey(key) {
      const id = byDedupeKey.get(key);
      return id ? submissions.get(id) ?? null : null;
    },

    async listSubmissions({ status, limit = 200 } = {}) {
      return [...submissions.values()]
        .filter((row) => !status || row.status === status)
        .sort(newest)
        .slice(0, limit);
    },

    async getSubmission(id) {
      return submissions.get(id) ?? null;
    },

    async updateSubmission(id, patch) {
      const row = submissions.get(id);
      if (!row) return null;
      const next = {
        ...row,
        status: patch.status,
        reviewedBy: patch.reviewedBy,
        note: patch.note ?? null,
        reviewedAt: new Date().toISOString(),
      };
      submissions.set(id, next);
      return next;
    },

    /** Admin correction of the public credit. Nothing else about the row changes. */
    async setSubmissionContributor(id, contributor) {
      const row = submissions.get(id);
      if (!row) return null;
      const next = { ...row, contributor };
      submissions.set(id, next);
      return next;
    },

    async deleteSubmission(id) {
      const row = submissions.get(id);
      if (!row) return null;
      submissions.delete(id);
      // Free the dedupe key too, so a deleted icon can be contributed again
      // rather than being blocked forever by a row that no longer exists.
      if (row.dedupeKey && byDedupeKey.get(row.dedupeKey) === id) {
        byDedupeKey.delete(row.dedupeKey);
      }
      return row;
    },

    async addHistory(rec) {
      const row = { id: randomUUID(), createdAt: new Date().toISOString(), ...rec };
      const list = history.get(rec.guestId) ?? [];
      list.push(row);
      // Bound per-guest growth: this is a convenience log, not an archive.
      history.set(rec.guestId, list.slice(-HISTORY_CAP));
      return row;
    },

    async listHistory(guestId, limit = HISTORY_CAP) {
      return [...(history.get(guestId) ?? [])].sort(newest).slice(0, limit);
    },

    async listIcons() {
      return [...catalogue().values()].sort(byName);
    },

    async listIconSummaries() {
      return [...catalogue().values()].sort(byName).map(toSummary);
    },

    /**
     * Add or replace an icon. A built icon of the same name wins: it is the one
     * the npm package exports, so a contribution must never shadow it.
     */
    async upsertIcon(icon) {
      const existing = catalogue().get(icon.name);
      if (existing && !existing.contributed && icon.contributed) return existing;
      catalogue().set(icon.name, icon);
      return icon;
    },

    async removeIcon(name) {
      return catalogue().delete(name);
    },

    /**
     * Count a page view and, for a guest id not seen before, a visitor.
     * `count` false reads the totals without recording, so the admin page can
     * show them without inflating them.
     */
    async recordVisit(guestId, count = true) {
      if (count) {
        visits.views += 1;
        if (guestId) visits.seen.add(guestId);
      }
      return { visitors: visits.seen.size, views: visits.views };
    },
  };
}

/** @type {Store|null} */
let store = null;

/**
 * The process-wide store, built on first use from STORE_DRIVER.
 *
 * An unknown value throws rather than falling back to memory: a typo in a
 * deployment's configuration must not quietly turn persistence off.
 */
export function getStore() {
  if (store) return store;
  const driver = (process.env.STORE_DRIVER || "memory").trim();
  if (driver === "memory") {
    store = createMemoryStore();
  } else if (driver === "supabase") {
    store = createSupabaseStore();
  } else {
    throw new Error(`Unknown STORE_DRIVER "${driver}". Use "memory" or "supabase".`);
  }
  return store;
}

/** True when the active driver does not actually persist anything. */
export function isEphemeral() {
  return getStore().driver === "memory";
}
