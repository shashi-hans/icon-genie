// The only file under api/, and the only reason it exists: Vercel discovers
// serverless functions in this directory, so a catch-all here lets every route
// live in server/ instead. All logic is in server/router.js.
import { resolveRoute, apiPath } from "../server/router.js";

export default async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const route = await resolveRoute(req.method, apiPath(url.pathname));

  if (!route) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ error: `No API route for ${req.method} ${url.pathname}` }));
  }

  // Handlers read path parameters from req.query, the way Vercel supplies them
  // for a conventional [id].js route.
  req.query = { ...(req.query ?? {}), ...Object.fromEntries(url.searchParams), ...route.params };
  return route.handler(req, res);
}
