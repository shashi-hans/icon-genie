// GET  /api/history  the caller's own history
// POST /api/history  record an entry (used when a guest generates an icon)
//
// Scoped entirely by the guest cookie: a caller can only ever read and write the
// history filed under their own id, and the id is never accepted from the
// request body. That is the whole authorization model here — there is no
// endpoint that takes a guestId parameter, so there is nothing to tamper with.
import { handler, json, methodIs, readJson, HttpError } from "../lib/http.js";
import { ensureGuestId } from "../lib/session.js";
import { getStore } from "../lib/store.js";
import { kebabName, validatePaths } from "../lib/validate.js";

export default handler(async (req, res) => {
  if (!methodIs(req, res, "GET", "POST")) return;

  const store = getStore();
  const guestId = ensureGuestId(req, res);

  if (req.method === "POST") {
    const body = await readJson(req);
    const paths = validatePaths(body);
    const name = kebabName(body.name);
    if (!name) throw new HttpError(400, "An icon name is required.");
    const entry = await store.addHistory({
      guestId,
      kind: "generated",
      name,
      paths,
      submissionId: null,
    });
    return json(res, 201, { entry });
  }

  const entries = await store.listHistory(guestId);
  // Attach the current review status so a contributed entry shows its outcome.
  // Looked up in one query for the whole list rather than one per entry, which
  // was up to 50 round trips for a page nobody waits 50 round trips for.
  const statuses = await store.getSubmissionStatuses(entries.map((e) => e.submissionId));
  const withStatus = entries.map((entry) => ({
    ...entry,
    status: entry.submissionId ? (statuses.get(entry.submissionId) ?? null) : null,
  }));
  return json(res, 200, { entries: withStatus });
});
