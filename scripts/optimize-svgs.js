#!/usr/bin/env node
// Step 1 of the pipeline: run SVGO over every SVG in ./raw-svgs/, in place.
// Uses the project's svgo.config.js so optimisation stays consistent with any
// manual `svgo` runs.
import fs from "node:fs";
import path from "node:path";
import { optimize } from "svgo";
import { RAW_SVGS_DIR } from "./utils.js";
import svgoConfig from "../svgo.config.js";

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

let bytesBefore = 0;
let bytesAfter = 0;
let failures = 0;

for (const file of files) {
  const input = fs.readFileSync(file, "utf8");
  bytesBefore += Buffer.byteLength(input);
  try {
    const result = optimize(input, { path: file, ...svgoConfig });
    fs.writeFileSync(file, result.data);
    bytesAfter += Buffer.byteLength(result.data);
  } catch (err) {
    failures++;
    console.warn(`  failed to optimize ${file}: ${err.message}`);
    bytesAfter += Buffer.byteLength(input);
  }
}

const saved = bytesBefore - bytesAfter;
const pct = bytesBefore ? ((saved / bytesBefore) * 100).toFixed(1) : "0.0";
console.log(
  `Optimized ${files.length} SVGs` +
    (failures ? ` (${failures} failed)` : "") +
    ` — ${(bytesBefore / 1024).toFixed(0)}KB → ${(bytesAfter / 1024).toFixed(0)}KB (${pct}% smaller).`
);
