#!/usr/bin/env node
// Imports Phosphor SVGs into ./raw-svgs/ in the per-icon folder layout this
// library expects:
//
//   raw-svgs/airplane/airplane-regular.svg
//   raw-svgs/airplane/airplane-bold.svg
//   ...
//
// Phosphor stores assets grouped by weight (assets/regular, assets/bold, …)
// with "regular" carrying no filename suffix. This script reshapes that into
// one folder per icon and normalises "regular" to an explicit suffix.
//
// Usage:
//   node scripts/import-phosphor.js /path/to/phosphor-core/assets
//   PHOSPHOR_ASSETS=/path/to/assets node scripts/import-phosphor.js
import fs from "node:fs";
import path from "node:path";
import { RAW_SVGS_DIR, WEIGHTS } from "./utils.js";

const assetsDir = process.argv[2] || process.env.PHOSPHOR_ASSETS;

if (!assetsDir) {
  console.error(
    "Error: provide the Phosphor assets directory.\n" +
      "  node scripts/import-phosphor.js /path/to/phosphor-core/assets"
  );
  process.exit(1);
}

if (!fs.existsSync(assetsDir)) {
  console.error(`Error: assets directory not found: ${assetsDir}`);
  process.exit(1);
}

// In Phosphor, regular files have no suffix; the rest are "-<weight>".
function phosphorFileName(iconBase, weight) {
  return weight === "regular"
    ? `${iconBase}.svg`
    : `${iconBase}-${weight}.svg`;
}

// Derive the canonical icon list from the regular weight folder.
const regularDir = path.join(assetsDir, "regular");
if (!fs.existsSync(regularDir)) {
  console.error(`Error: expected ${regularDir} to exist.`);
  process.exit(1);
}

const iconBases = fs
  .readdirSync(regularDir)
  .filter((f) => f.endsWith(".svg"))
  .map((f) => f.replace(/\.svg$/, ""));

fs.mkdirSync(RAW_SVGS_DIR, { recursive: true });

let copied = 0;
let missing = 0;

for (const iconBase of iconBases) {
  const iconDir = path.join(RAW_SVGS_DIR, iconBase);
  fs.mkdirSync(iconDir, { recursive: true });

  for (const weight of WEIGHTS) {
    const src = path.join(assetsDir, weight, phosphorFileName(iconBase, weight));
    const dest = path.join(iconDir, `${iconBase}-${weight}.svg`);
    if (!fs.existsSync(src)) {
      console.warn(`  missing: ${iconBase} (${weight})`);
      missing++;
      continue;
    }
    fs.copyFileSync(src, dest);
    copied++;
  }
}

console.log(
  `Imported ${iconBases.length} icons (${copied} files copied` +
    (missing ? `, ${missing} missing` : "") +
    `) into ${path.relative(process.cwd(), RAW_SVGS_DIR)}/`
);
