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
import { RAW_SVGS_DIR, SOURCE_WEIGHTS as WEIGHTS } from "./utils.js";

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

/** True when raw-svgs/<name>/ holds a contributed centerline icon. */
function hasCenterline(name) {
  return fs.existsSync(path.join(RAW_SVGS_DIR, name, `${name}.centerline.svg`));
}

// Phosphor grows, and a name it adds may already belong to a contributed icon.
// Sharing the directory would not merge them: generate-components.js reads a
// centerline file in preference to the weight files beside it, so the Phosphor
// drawing would be imported and then silently ignored.
//
// The contributed icon keeps the name. It is already an export of a published
// package, so moving it would change what `import { Cup }` draws for everyone
// who has it. The Phosphor arrival is imported as "<name>-phosphor" instead —
// a new export, breaking nothing.
const MAX_SUFFIX = 50; // a guard on the loop, never expected to be reached

function resolveTargetName(iconBase) {
  if (!hasCenterline(iconBase)) return iconBase;
  for (let i = 1; i <= MAX_SUFFIX; i++) {
    const candidate = i === 1 ? `${iconBase}-phosphor` : `${iconBase}-phosphor-${i}`;
    if (!hasCenterline(candidate)) return candidate;
  }
  throw new Error(`Could not find a free name for "${iconBase}" after ${MAX_SUFFIX} tries.`);
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
const renamed = [];

for (const iconBase of iconBases) {
  // Reads from the Phosphor name, writes to the name this library will use —
  // the same thing except where a contributed icon already holds it.
  const name = resolveTargetName(iconBase);
  if (name !== iconBase) renamed.push(`${iconBase} -> ${name}`);

  const iconDir = path.join(RAW_SVGS_DIR, name);
  fs.mkdirSync(iconDir, { recursive: true });

  for (const weight of WEIGHTS) {
    const src = path.join(assetsDir, weight, phosphorFileName(iconBase, weight));
    const dest = path.join(iconDir, `${name}-${weight}.svg`);
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

if (renamed.length) {
  console.log(
    `\n${renamed.length} renamed around a contributed icon of the same name:\n` +
      renamed.map((line) => `  ${line}`).join("\n") +
      `\nEach is a new export. The contributed icons keep their names, so nothing already published changes.`
  );
}
