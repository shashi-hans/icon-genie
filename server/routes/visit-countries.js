// GET /api/visits/countries -> { countries: [{ country, views, visitors, lastSeen }] }
//
// The per-country visit tally for the admin page, busiest first.
//
// Admin only. Not because the numbers are sensitive on their own — they are
// aggregates, and a country tally identifies nobody — but because traffic
// composition is not something a site needs to publish, and the review queue
// beside it is already behind the same session.
//
// There is nothing to paginate: one row per country the site has ever been
// visited from, which is at most a couple of hundred.
import { handler, json, methodIs, requireAdmin } from "../lib/http.js";
import { getStore } from "../lib/store.js";

export default handler(async (req, res) => {
  if (!methodIs(req, res, "GET")) return;
  if (!requireAdmin(req, res)) return;

  const countries = await getStore().listVisitorCountries();
  return json(res, 200, { countries });
});
