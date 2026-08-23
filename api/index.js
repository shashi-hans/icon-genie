// The only file under api/, and the only reason it exists: Vercel discovers
// serverless functions in this directory, so one function here lets every route
// live in server/ instead. All logic is in server/router.js.
//
// Every /api/** request arrives here through the rewrite in vercel.json, which
// carries the original path in `__apiPath`. The rewrite is what makes nested
// routes work: a filesystem catch-all (api/[...path].js) matched only a single
// segment on this project, so /api/auth/me and /api/svg/heart.svg resolved to
// nothing and never reached this function at all. A static filename plus an
// explicit rewrite depends on no dynamic-route behaviour.
//
// The pathname is still read as a fallback, for scripts/dev-server.js and for a
// single-segment hit that filesystem routing resolves on its own.
import { resolveRoute, apiPath } from "../server/router.js";

// Set by the rewrite, not by callers. Removed from the query before handlers see
// it, so a route reading req.query gets only its own parameters. A caller who
// sets it by hand reaches a route they could already have requested directly, so
// there is nothing to gain by it.
const PATH_PARAM = "__apiPath";

export default async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const rewritten = url.searchParams.get(PATH_PARAM);
  url.searchParams.delete(PATH_PARAM);

  const path = rewritten === null ? apiPath(url.pathname) : `/${rewritten.replace(/^\/+/, "")}`;
  const route = await resolveRoute(req.method, path);

  if (!route) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ error: `No API route for ${req.method} /api${path}` }));
  }

  // Handlers read path parameters from req.query, the way Vercel supplies them
  // for a conventional [id].js route. Vercel populates req.query itself, so the
  // rewrite's own parameter is dropped from the merged result too.
  const query = { ...(req.query ?? {}), ...Object.fromEntries(url.searchParams), ...route.params };
  delete query[PATH_PARAM];
  req.query = query;
  return route.handler(req, res);
}
