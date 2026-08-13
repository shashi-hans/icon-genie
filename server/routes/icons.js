// GET /api/icons      every icon, regular weight only  — the fast first payload
// GET /api/icons/all  every icon, all six weights      — fetched after paint
//
// Split because the full catalogue is several megabytes of path markup, and the
// grid only draws one weight. The gallery renders from the summary, then swaps in
// the full set once it arrives, so the first screen does not wait on bytes it
// cannot show.
//
// Public: these are the icons the site exists to hand out. The response carries
// no submission detail beyond the credit a contributor asked to have shown.
import { handler, json, methodIs } from "../lib/http.js";
import { getStore, isEphemeral } from "../lib/store.js";
import { WEIGHTS } from "../lib/icons.js";

export const list = handler(async (req, res) => {
  if (!methodIs(req, res, "GET")) return;
  const icons = await getStore().listIconSummaries();
  return json(res, 200, {
    icons,
    weights: WEIGHTS,
    total: icons.length,
    // "regular" tells the client this payload is not the full set yet.
    detail: "regular",
    ephemeralStore: isEphemeral(),
  });
});

export const all = handler(async (req, res) => {
  if (!methodIs(req, res, "GET")) return;
  const icons = await getStore().listIcons();
  return json(res, 200, {
    icons,
    weights: WEIGHTS,
    total: icons.length,
    detail: "all",
  });
});
