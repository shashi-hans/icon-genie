// GET    /api/submissions/:id  one submission (admin only)
// PATCH  /api/submissions/:id  review it, or correct the contributor (admin only)
// DELETE /api/submissions/:id  remove it, and its published source file (admin only)
//
// Approving does two things: records the decision, which makes the icon visible
// in the gallery, and publishes its centerline file so the icon joins the npm
// package on the next build. See server/lib/publish.js for how "publish" resolves
// per environment.
import { handler, json, methodIs, readJson, requireAdmin, HttpError } from "../lib/http.js";
import { getStore } from "../lib/store.js";
import { cleanContributor, cleanText, toCenterlineSvg } from "../lib/validate.js";
import { publishIcon, unpublishIcon } from "../lib/publish.js";
import { iconFromSubmission } from "../lib/icons.js";

const REVIEW_STATUSES = new Set(["approved", "rejected", "pending"]);

export default handler(async (req, res) => {
  if (!methodIs(req, res, "GET", "PATCH", "DELETE")) return;
  if (!requireAdmin(req, res)) return;

  const store = getStore();
  const { id } = req.query ?? {};
  if (!id || typeof id !== "string") throw new HttpError(400, "Missing submission id.");

  if (req.method === "GET") {
    const submission = await store.getSubmission(id);
    if (!submission) throw new HttpError(404, "No such submission.");
    return json(res, 200, {
      submission,
      // Ready to save as raw-svgs/<name>/<name>.centerline.svg.
      centerlineSvg: toCenterlineSvg(submission.paths),
      filePath: `raw-svgs/${submission.name}/${submission.name}.centerline.svg`,
    });
  }

  if (req.method === "DELETE") {
    const removed = await store.deleteSubmission(id);
    if (!removed) throw new HttpError(404, "No such submission.");
    // The record is what puts the icon in the gallery, so it is gone already;
    // this takes the published source file out too, when there is one.
    // Only pull it from the catalogue if this submission is what put it there —
    // never remove a built icon that happens to share the name.
    const current = (await store.listIcons()).find((i) => i.name === removed.name);
    if (current?.contributed && current.submissionId === removed.id) {
      await store.removeIcon(removed.name);
    }
    const unpublished = await unpublishIcon({ name: removed.name });
    return json(res, 200, { deleted: { id: removed.id, name: removed.name }, unpublished });
  }

  const body = await readJson(req);

  // Correcting the public credit, with no change of status. Separate from the
  // review path because renaming is not a decision about the icon.
  if (body?.contributor !== undefined && body?.status === undefined) {
    const submission = await store.setSubmissionContributor(id, cleanContributor(body.contributor));
    if (!submission) throw new HttpError(404, "No such submission.");
    // An approved icon is already in the catalogue with the old credit on it.
    if (submission.status === "approved") {
      await store.upsertIcon(iconFromSubmission(submission));
    }
    return json(res, 200, { submission, published: null });
  }

  if (!REVIEW_STATUSES.has(body?.status)) {
    throw new HttpError(400, `status must be one of: ${[...REVIEW_STATUSES].join(", ")}.`);
  }

  const existing = await store.getSubmission(id);
  if (!existing) throw new HttpError(404, "No such submission.");

  const submission = await store.updateSubmission(id, {
    status: body.status,
    reviewedBy: "admin",
    note: cleanText(body.note),
  });
  if (!submission) throw new HttpError(404, "No such submission.");

  // Publish only on the transition into "approved", so re-approving an already
  // approved icon does not open a second pull request.
  let published = null;
  if (body.status === "approved" && existing.status !== "approved") {
    // Into the catalogue first: this is what makes the icon appear in the gallery
    // straight away, rather than at the next build.
    await store.upsertIcon(iconFromSubmission(submission));
    published = await publishIcon({
      name: submission.name,
      paths: submission.paths,
      contributor: submission.contributor,
    });
  }

  return json(res, 200, { submission, published });
});
