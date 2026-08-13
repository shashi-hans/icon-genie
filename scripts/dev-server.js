#!/usr/bin/env node
// Local dev server: serves docs/ as static files AND routes /api/* to the
// handlers in api/, so the whole site works with plain Node.
//
// `vercel dev` is the higher-fidelity option (same runtime and routing as
// production) but needs the Vercel CLI installed and an authenticated project.
// This exists so the app runs without either — and so nobody reaches for a
// static file server, which answers 501 to every POST and makes login look
// broken when it is simply absent.
//
//   npm run dev            this server
//   npm run dev:vercel     vercel dev, when the CLI is set up
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { DOCS_DIR } from "./utils.js";
import { resolveRoute, apiPath } from "../server/router.js";
// Populate process.env from .env before the startup banner reports what is
// configured. The handlers pull this in themselves, but not until the first
// request loads one, which would make the banner say "disabled" for a login
// that works.
import "../server/lib/env.js";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function serveStatic(res, pathname) {
  // Strip the leading slash so join() cannot be walked out of docs/, and reject
  // any traversal outright.
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
  if (rel.includes("..")) {
    res.statusCode = 400;
    return res.end("bad path");
  }
  let file = join(DOCS_DIR, rel);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    res.statusCode = 404;
    return res.end("Not found");
  }
  try {
    const body = await readFile(file);
    res.setHeader("content-type", MIME[extname(file)] || "application/octet-stream");
    // Always fresh: this is a dev server, and a cached icons.json or bundle
    // hides the change you just made.
    res.setHeader("cache-control", "no-store");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname.startsWith("/api")) {
    // Same routing table the deployed catch-all uses, so local and production
    // cannot disagree about which handler serves a path.
    const route = await resolveRoute(req.method, apiPath(url.pathname));
    if (!route) {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ error: `No API route for ${req.method} ${url.pathname}` }));
    }
    req.query = { ...Object.fromEntries(url.searchParams), ...route.params };
    try {
      return await route.handler(req, res);
    } catch (err) {
      console.error(`api ${url.pathname}:`, err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "Internal error." }));
      }
      return;
    }
  }

  return serveStatic(res, url.pathname);
}).listen(PORT, HOST, () => {
  const configured = Boolean(process.env.ADMIN_PASSWORD);
  console.log(`gallery   http://${HOST}:${PORT}/`);
  console.log(`admin     http://${HOST}:${PORT}/admin.html`);
  console.log(
    configured
      ? "admin login: enabled (ADMIN_PASSWORD found)"
      : "admin login: DISABLED — set ADMIN_PASSWORD in .env (not .env.example)"
  );
  // Read from the environment rather than by building the store: a bad driver
  // name should fail on the first request that needs data, not stop the static
  // gallery from being served at all.
  const driver = process.env.STORE_DRIVER || "memory";
  console.log(
    driver === "memory"
      ? "store: memory — submissions, history, and visit counts are lost on restart"
      : `store: ${driver}`
  );
  if (!existsSync(join(DOCS_DIR, "icons.json"))) {
    console.log("warning: docs/icons.json missing — run `npm run build:icons` first");
  }
});

// A port clash otherwise exits with a raw stack trace, which reads as "the
// server printed something and stopped" — and the browser then answers
// ERR_CONNECTION_REFUSED with no hint that a second copy is the cause.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `port ${PORT} is already in use — another dev server is running.\n` +
        `Open http://${HOST}:${PORT}/ (it is being served), or start this one on ` +
        `another port: PORT=3001 npm run dev`
    );
    process.exit(1);
  }
  throw err;
});
