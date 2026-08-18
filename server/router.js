// The single routing table for the API, shared by both entry points: the Vercel
// catch-all function in api/ and the local dev server. Adding a route means one
// line here and nothing else.
//
// Handlers are imported lazily so a cold start only loads the module for the
// route being called, rather than the whole API surface.
const ROUTES = {
  "POST /ai/chat/completions": () => import("./routes/ai-chat.js"),
  "GET /auth/me": () => import("./routes/auth-me.js"),
  "POST /auth/login": () => import("./routes/auth-login.js"),
  "POST /auth/logout": () => import("./routes/auth-logout.js"),
  "GET /history": () => import("./routes/history.js"),
  "POST /history": () => import("./routes/history.js"),
  "GET /icons": () => import("./routes/icons.js").then((m) => ({ default: m.list })),
  "GET /icons/all": () => import("./routes/icons.js").then((m) => ({ default: m.all })),
  "GET /submissions": () => import("./routes/submissions.js"),
  "POST /submissions": () => import("./routes/submissions.js"),
  // Exact routes are matched before the patterns below, so this is not shadowed
  // by /icons/:name.
  "GET /icons/hidden": () => import("./routes/icon-item.js").then((m) => ({ default: m.hidden })),
};

// Routes with a path parameter, matched after the exact table above.
const PATTERNS = [
  {
    re: /^\/submissions\/([^/]+)$/,
    methods: ["GET", "PATCH", "DELETE"],
    params: ["id"],
    load: () => import("./routes/submission-item.js"),
  },
  {
    re: /^\/icons\/([^/]+)$/,
    methods: ["DELETE", "POST"],
    params: ["name"],
    load: () => import("./routes/icon-item.js"),
  },
];

/**
 * Resolve a request to a handler, or null when nothing matches.
 * `path` is the API path with the /api prefix already removed.
 */
export async function resolveRoute(method, path) {
  // Trailing slashes are a routing detail, not a different resource.
  const clean = path.replace(/\/+$/, "") || "/";

  const exact = ROUTES[`${method} ${clean}`];
  if (exact) return { handler: (await exact()).default, params: {} };

  for (const pattern of PATTERNS) {
    const match = pattern.re.exec(clean);
    if (!match) continue;
    if (!pattern.methods.includes(method)) continue;
    const params = {};
    pattern.params.forEach((name, i) => (params[name] = decodeURIComponent(match[i + 1])));
    return { handler: (await pattern.load()).default, params };
  }
  return null;
}

/** Strip the /api prefix from a request path. */
export function apiPath(pathname) {
  return pathname.replace(/^\/api/, "") || "/";
}
