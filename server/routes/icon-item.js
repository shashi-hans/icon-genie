// DELETE /api/icons/:name   hide an icon from the gallery (admin)
// POST   /api/icons/:name   { "restore": true } put a hidden one back (admin)
//
// This removes ANY icon, including one the package builds from raw-svgs/, which
// nothing else in the API can do: the catalogue is derived on read, so a built
// icon has no row to delete.
//
// It hides rather than deletes. The artwork stays on disk and in git, and
// `restore` is one call away, which is what makes it safe to work through a long
// list of near-duplicates at speed. Shrinking the npm package is the separate,
// deliberate step: read the hidden list, remove those raw-svgs/ directories,
// rebuild. Doing that per button press would mean a commit to the default branch
// inside a request.
import { handler, json, methodIs, readJson, requireAdmin, HttpError } from "../lib/http.js";
import { getStore } from "../lib/store.js";
import { kebabName } from "../lib/validate.js";

export default handler(async (req, res) => {
  if (!methodIs(req, res, "DELETE", "POST")) return;
  if (!requireAdmin(req, res)) return;

  const name = kebabName(req.query?.name);
  if (!name) throw new HttpError(400, "An icon name is required.");

  const store = getStore();

  if (req.method === "POST") {
    const body = await readJson(req);
    if (body?.restore !== true) {
      throw new HttpError(400, 'Send {"restore": true} to put a hidden icon back.');
    }
    const restored = await store.unhideIcon(name);
    if (!restored) throw new HttpError(404, `"${name}" is not hidden.`);
    return json(res, 200, { name, hidden: false });
  }

  // Checked against the catalogue so a typo returns 404 instead of silently
  // filing a hidden name that matches nothing.
  const exists = (await store.listIcons()).some((icon) => icon.name === name);
  if (!exists) throw new HttpError(404, `No icon named "${name}".`);

  // One shared admin credential, so there is no person to record here.
  await store.hideIcon(name, "admin");
  return json(res, 200, {
    name,
    hidden: true,
    detail:
      "Out of the gallery and the API. The artwork is still in raw-svgs/ and in git; " +
      "POST the same path with {\"restore\": true} to undo.",
  });
});

// GET /api/icons/hidden  the hidden list (admin), for review and for pruning
// raw-svgs/ in one deliberate pass later.
export const hidden = handler(async (req, res) => {
  if (!methodIs(req, res, "GET")) return;
  if (!requireAdmin(req, res)) return;
  const icons = await getStore().listHiddenIcons();
  return json(res, 200, { icons, total: icons.length });
});
