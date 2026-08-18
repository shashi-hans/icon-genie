// GET /api/auth/me -> { role, title, guestId, loginConfigured, visits }
//
// What the page calls on load to decide whether to show "Admin" or "Guest".
// Visiting this route is also what mints a guest id, so history has something to
// attach to from the first page view.
//
// It carries the visit counters too, rather than a separate /api/visits: this is
// already called exactly once per page load and already has the guest id, so a
// second request would buy nothing. Counting only happens with ?visit=1, which
// the gallery sends and the admin page does not — otherwise reviewing icons would
// inflate the number.
import { handler, json, methodIs } from "../lib/http.js";
import { ensureGuestId, isAdmin } from "../lib/session.js";
import { getStore } from "../lib/store.js";

export default handler(async (req, res) => {
  if (!methodIs(req, res, "GET")) return;

  const admin = isAdmin(req);
  const guestId = ensureGuestId(req, res);
  const visits = await getStore().recordVisit(guestId, req.query?.visit === "1");

  return json(res, 200, {
    role: admin ? "admin" : "guest",
    title: admin ? "Admin" : "Guest",
    // The page never needs the admin's identity, only the guest key it files
    // history under, so that is all it gets.
    guestId,
    // Lets the UI say "login isn't set up" instead of "wrong password".
    loginConfigured: Boolean(process.env.ADMIN_PASSWORD),
    visits,
  });
});
