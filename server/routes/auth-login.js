// POST /api/auth/login  { password } -> { role: "admin" }
//
// The only route that issues an admin session. It reports one generic failure
// for a wrong password and for a throttled caller, so responses cannot be used
// to probe which passwords are close or whether an admin exists at all.
import { handler, json, methodIs, readJson, clientIp, loginThrottled, clearLoginThrottle } from "../lib/http.js";
import { checkAdminPassword, startAdminSession } from "../lib/session.js";

export default handler(async (req, res) => {
  if (!methodIs(req, res, "POST")) return;

  const ip = clientIp(req);
  if (loginThrottled(ip)) {
    return json(res, 429, { error: "Too many attempts. Try again later." });
  }

  const { password } = await readJson(req);
  const result = checkAdminPassword(password);

  if (result.reason === "unconfigured") {
    // Distinguishing this is safe and saves a long debugging session: it is a
    // deployment fault, not a hint about any credential.
    return json(res, 503, { error: "Admin login is not configured on this server." });
  }
  if (!result.ok) {
    return json(res, 401, { error: "Incorrect password." });
  }

  clearLoginThrottle(ip);
  startAdminSession(res);
  return json(res, 200, { role: "admin" });
});
