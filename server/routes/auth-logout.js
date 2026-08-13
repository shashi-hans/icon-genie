// POST /api/auth/logout -> { role: "guest" }
//
// Clears the admin session. The guest cookie is deliberately left alone: it is
// an identifier, not a credential, and dropping it would orphan the caller's
// history for no security gain.
import { handler, json, methodIs } from "../lib/http.js";
import { endAdminSession } from "../lib/session.js";

export default handler(async (req, res) => {
  if (!methodIs(req, res, "POST")) return;
  endAdminSession(res);
  return json(res, 200, { role: "guest" });
});
