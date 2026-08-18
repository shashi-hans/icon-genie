// The only module that knows how data is persisted. Everything else talks to
// the interface below, so connecting a real database later is a change here and
// nowhere else.
//
// One driver: Postgres over PostgREST, in store-supabase.js, against the schema
// in supabase/migrations/. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// required, so a checkout with no configuration serves the static gallery and
// fails on the first request that needs data.
//
// An in-memory driver used to stand in when those were absent. It was removed:
// on serverless it was per-instance and lost on recycle, so the flows it let you
// demo were not the flows that would run, and every page carried a banner
// apologising for it. Better to need a database than to pretend to have one.
//
// TO ADD ANOTHER DRIVER: implement the same eighteen methods against your client
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
 * @property {string} driver             which implementation this is
 * @property {(rec: Omit<Submission, "id"|"status"|"createdAt"|"reviewedAt"|"reviewedBy"|"note">) => Promise<Submission>} createSubmission
 * @property {(opts?: {status?: string, limit?: number}) => Promise<Submission[]>} listSubmissions
 * @property {() => Promise<{pending: number, approved: number, rejected: number}>} countSubmissions
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
 * @property {(name: string) => Promise<boolean>} removeIcon  true when the name is no longer served
 * @property {(name: string, by?: string) => Promise<boolean>} hideIcon    admin removal; works on built icons too
 * @property {(name: string) => Promise<boolean>} unhideIcon               true when it was hidden and now is not
 * @property {() => Promise<{name: string, hiddenAt: string|null, hiddenBy: string|null}[]>} listHiddenIcons
 * @property {(guestId: string, count: boolean) => Promise<{visitors: number, views: number}>} recordVisit
 */

import { createSupabaseStore } from "./store-supabase.js";
import "./env.js";

/** @type {Store|null} */
let store = null;

/**
 * The process-wide store, built on first use.
 *
 * `STORE_DRIVER` is still read, and anything other than "supabase" throws. It
 * is not a choice any more — there is one driver — but a deployment carrying an
 * old value must fail loudly rather than be handed a database it did not ask
 * for. Unset is treated as "supabase", so a correct deployment needs only the
 * two Supabase variables.
 */
export function getStore() {
  if (store) return store;
  const driver = (process.env.STORE_DRIVER || "supabase").trim();
  if (driver !== "supabase") {
    throw new Error(
      `STORE_DRIVER is "${driver}", and the only driver is "supabase". ` +
        `Remove the variable or set it to "supabase", and provide SUPABASE_URL ` +
        `and SUPABASE_SERVICE_ROLE_KEY. See .env.example.`
    );
  }
  store = createSupabaseStore();
  return store;
}
