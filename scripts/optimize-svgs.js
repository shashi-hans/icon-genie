#!/usr/bin/env node
// Step 1 of the pipeline: run SVGO over every SVG in ./raw-svgs/, in place.
// Uses the project's svgo.config.js so optimisation stays consistent with any
// manual `svgo` runs.
//
// Skips files it has already optimised. SVGO is idempotent on its own output, so
// a file whose current contents hash to something this script previously emitted
// cannot be improved by running it again — and nearly every file is in that state
// on every build, because raw-svgs/ is committed already optimised. Re-running it
// over all 21,786 files cost ~17s per build and changed nothing, twice per release
// (`build:all`, then `prepublishOnly` runs the same build again).
//
// The cache is keyed on content, not on paths or mtimes, so moving or renaming an
// icon does not invalidate it and a `git checkout` of old artwork is recognised.
// It records the config it was built with and throws itself away when that
// changes, which is what makes editing svgo.config.js take effect. Set
// SVGO_NO_CACHE=1 to force a full pass.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { optimize } from "svgo";
import { ROOT, RAW_SVGS_DIR } from "./utils.js";
import svgoConfig from "../svgo.config.js";

const CACHE_PATH = path.join(ROOT, ".svgo-cache.json");
const CACHE_VERSION = 1;

const sha1 = (text) => createHash("sha1").update(text).digest("hex");
// Covers the plugin list and every option in it, so any edit to svgo.config.js
// invalidates the cache rather than silently leaving old output in place.
const configHash = sha1(JSON.stringify(svgoConfig));

/** Hashes of outputs this script has already produced, or an empty set. */
function loadCache() {
  if (process.env.SVGO_NO_CACHE === "1") return new Set();
  try {
    const cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    if (cache.version !== CACHE_VERSION || cache.config !== configHash) return new Set();
    return new Set(Array.isArray(cache.hashes) ? cache.hashes : []);
  } catch {
    return new Set(); // absent or unreadable: optimise everything
  }
}

/**
 * Written with only the hashes seen this run, so artwork that has been deleted or
 * changed does not leave an entry behind for the life of the checkout.
 */
function saveCache(hashes) {
  const body = { version: CACHE_VERSION, config: configHash, hashes: [...hashes] };
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(body));
  } catch (err) {
    // A build that cannot write its cache is slower, not wrong.
    console.warn(`  could not write ${path.basename(CACHE_PATH)}: ${err.message}`);
  }
}

function walkSvgs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSvgs(full));
    } else if (entry.isFile() && entry.name.endsWith(".svg")) {
      out.push(full);
    }
  }
  return out;
}

if (!fs.existsSync(RAW_SVGS_DIR)) {
  console.error(
    `Error: ${RAW_SVGS_DIR} not found. Run "npm run import:phosphor <assets>" first.`
  );
  process.exit(1);
}

const files = walkSvgs(RAW_SVGS_DIR);
if (files.length === 0) {
  console.error(`Error: no SVGs found under ${RAW_SVGS_DIR}.`);
  process.exit(1);
}

const known = loadCache();
const seen = new Set();

let bytesBefore = 0;
let bytesAfter = 0;
let optimized = 0;
let skipped = 0;
let failures = 0;

for (const file of files) {
  const input = fs.readFileSync(file, "utf8");
  const inputHash = sha1(input);
  bytesBefore += Buffer.byteLength(input);

  if (known.has(inputHash)) {
    skipped++;
    seen.add(inputHash);
    bytesAfter += Buffer.byteLength(input);
    continue;
  }

  try {
    const result = optimize(input, { path: file, ...svgoConfig });
    fs.writeFileSync(file, result.data);
    optimized++;
    seen.add(sha1(result.data));
    bytesAfter += Buffer.byteLength(result.data);
  } catch (err) {
    failures++;
    console.warn(`  failed to optimize ${file}: ${err.message}`);
    bytesAfter += Buffer.byteLength(input);
  }
}

saveCache(seen);

const saved = bytesBefore - bytesAfter;
const pct = bytesBefore ? ((saved / bytesBefore) * 100).toFixed(1) : "0.0";
console.log(
  `Optimized ${optimized} of ${files.length} SVGs` +
    (skipped ? ` (${skipped} already optimized)` : "") +
    (failures ? ` (${failures} failed)` : "") +
    ` — ${(bytesBefore / 1024).toFixed(0)}KB → ${(bytesAfter / 1024).toFixed(0)}KB (${pct}% smaller).`
);
