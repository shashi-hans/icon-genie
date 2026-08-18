// POST /api/submissions  create a submission (any visitor)
// GET  /api/submissions  list the review queue (admin only)
//
// The two methods have deliberately different audiences: contributing is open,
// reading the queue is not. A guest must not be able to enumerate what other
// people submitted, so the GET is behind requireAdmin.
import { handler, json, methodIs, readJson, requireAdmin } from "../lib/http.js";
import { ensureGuestId } from "../lib/session.js";
import { getStore } from "../lib/store.js";
import { cleanContributor, cleanSource, cleanText, dedupeKey, kebabName, validatePaths } from "../lib/validate.js";
import { isBuiltIcon } from "../lib/icons.js";
import { HttpError } from "../lib/http.js";

const STATUSES = new Set(["pending", "approved", "rejected"]);

export default handler(async (req, res) => {
  if (!methodIs(req, res, "GET", "POST")) return;
  const store = getStore();

  if (req.method === "GET") {
    if (!requireAdmin(req, res)) return;
    const url = new URL(req.url, "http://localhost");
    const status = url.searchParams.get("status") ?? undefined;
    if (status && !STATUSES.has(status)) {
      throw new HttpError(400, `Unknown status "${status}".`);
    }
    const submissions = await store.listSubmissions({ status });
    // Counted by the store rather than by walking a listing: listSubmissions is
    // paged, so totals derived from it stop being totals past the first page.
    const counts = await store.countSubmissions();
    return json(res, 200, { submissions, counts });
  }

  // --- POST: anyone may contribute -----------------------------------------
  const body = await readJson(req);
  const paths = validatePaths(body);
  const name = kebabName(body.name);
  if (!name) throw new HttpError(400, "An icon name is required.");

  // The build reads raw-svgs/<name>/<name>.centerline.svg in preference to the
  // six weight files beside it, so approving a contribution under a built icon's
  // name would replace the shipped drawing. Refused here, where the contributor
  // can still rename it, rather than at approval where only an admin sees it.
  if (isBuiltIcon(name)) {
    throw new HttpError(409, `"${name}" is already an icon in the library. Choose another name.`);
  }

  const summary = cleanText(body.summary);

  // One submission per icon, identified by name + summary. Without this the same
  // icon can be sent repeatedly — by an impatient double-click or deliberately —
  // and an admin ends up reviewing the same drawing several times.
  const key = dedupeKey(name, summary);
  const clash = await store.findSubmissionByDedupeKey(key);
  if (clash) {
    const state =
      clash.status === "approved"
        ? "already in the gallery"
        : clash.status === "rejected"
          ? "already reviewed and turned down"
          : "already waiting for review";
    throw new HttpError(409, `"${name}" is ${state}. Change the name or summary to submit a variant.`);
  }

  const guestId = ensureGuestId(req, res);
  const submission = await store.createSubmission({
    name,
    paths,
    prompt: cleanText(body.prompt),
    summary,
    source: cleanSource(body.source),
    contributor: cleanContributor(body.contributor),
    dedupeKey: key,
    guestId,
  });

  // File it in the submitter's own history so a guest can see what they sent and
  // what became of it.
  await store.addHistory({
    guestId,
    kind: "contributed",
    name,
    paths,
    submissionId: submission.id,
  });

  // The submitter gets back their own row; listing anyone else's needs admin.
  return json(res, 201, { submission });
});
