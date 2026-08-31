// Loads .env files into process.env as a side effect of being imported.
//
// Needed because the API reads its configuration from the environment, but
// nothing puts a file's contents there: `vercel dev` injects .env.local only,
// Vercel deploys use project Environment Variables, and Node 18 has no
// --env-file. Importing this makes `node api/...` behave like the other two.
//
// Deliberately dependency-free rather than using dotenv: this repo publishes
// `icon-genie`, and a runtime dependency here would be installed by
// everyone who installs the icon library.
//
// Real values live in .env / .env.local, which are gitignored. .env.example is
// the committed template and must hold placeholders only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

// server/lib -> server -> repo root
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Later files do not override earlier ones, and nothing overrides a variable
// that is already set: a real deployment's Environment Variables must always
// win over a file that happened to get bundled.
const FILES = [".env.local", ".env"];

function parse(text) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq < 1) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = withoutExport.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
    } else {
      // Only strip a trailing comment from an unquoted value, so a `#` inside a
      // quoted password survives.
      value = value.replace(/\s+#.*$/, "");
    }
    out[key] = value;
  }
  return out;
}

let loaded = false;

/**
 * Read the .env files once per process. Missing files are not an error.
 *
 * Not exported: this module is imported for its side effect, and the call below
 * is the only one. An exported version would invite a second, ordered call site.
 */
function loadEnv() {
  if (loaded) return;
  loaded = true;
  for (const name of FILES) {
    let text;
    try {
      text = readFileSync(join(ROOT, name), "utf8");
    } catch {
      continue; // absent is the normal case in production
    }
    for (const [key, value] of Object.entries(parse(text))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadEnv();
