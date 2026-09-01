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

/** The weights Phosphor actually ships for an icon, in SOURCE_WEIGHTS order. */
function sourceWeights(iconBase) {
  return WEIGHTS.filter((weight) =>
    fs.existsSync(path.join(assetsDir, weight, phosphorFileName(iconBase, weight)))
  );
}

/**
 * True when raw-svgs/<name>/ already holds artwork this import did not write.
 *
 * raw-svgs/ carries eight vendors, and they all use the same
 * "<name>-<weight>.svg" filenames, so a filename cannot say who drew what.
 * Completeness can: Phosphor ships every weight it has for an icon at once, so a
 * directory this import owns holds exactly the files it would write and nothing
 * else. An Ionicons pair or a Material Symbols trio does not, and writing over
 * one would swap a shipped drawing for a different vendor's without saying so.
 *
 * Re-running the import stays idempotent, because a directory it wrote last time
 * matches exactly.
 */
function holdsOtherArtwork(name, weights) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(RAW_SVGS_DIR, name));
  } catch {
    return false; // no such directory, so nothing to write over
  }
  const svgs = entries.filter((file) => file.endsWith(".svg"));
  if (svgs.length === 0) return false;
  const ours = new Set(weights.map((weight) => `${name}-${weight}.svg`));
  return svgs.length !== ours.size || svgs.some((file) => !ours.has(file));
}

// Phosphor grows, and a name it adds may already belong to a contributed icon or
// to one of the other vendors in raw-svgs/. Sharing the directory would not merge
// them: generate-components.js reads a centerline file in preference to the
// weight files beside it, so a Phosphor drawing landing next to one would be
// imported and then silently ignored — and landing on another vendor's weight
// files it would replace them.
//
// The icon already there keeps the name. It is already an export of a published
// package, so moving it would change what `import { Cup }` draws for everyone
// who has it. The Phosphor arrival is imported as "<name>-phosphor" instead —
// a new export, breaking nothing.
const MAX_SUFFIX = 50; // a guard on the loop, never expected to be reached

function resolveTargetName(iconBase, weights) {
  const taken = (name) => hasCenterline(name) || holdsOtherArtwork(name, weights);
  if (!taken(iconBase)) return iconBase;
  for (let i = 1; i <= MAX_SUFFIX; i++) {
    const candidate = i === 1 ? `${iconBase}-phosphor` : `${iconBase}-phosphor-${i}`;
    if (!taken(candidate)) return candidate;
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
  const weights = sourceWeights(iconBase);

  // Reads from the Phosphor name, writes to the name this library will use —
  // the same thing except where another icon already holds it.
  const name = resolveTargetName(iconBase, weights);
  if (name !== iconBase) renamed.push(`${iconBase} -> ${name}`);

  const iconDir = path.join(RAW_SVGS_DIR, name);
  fs.mkdirSync(iconDir, { recursive: true });

  for (const weight of WEIGHTS) {
    if (!weights.includes(weight)) {
      console.warn(`  missing: ${iconBase} (${weight})`);
      missing++;
      continue;
    }
    fs.copyFileSync(
      path.join(assetsDir, weight, phosphorFileName(iconBase, weight)),
      path.join(iconDir, `${name}-${weight}.svg`)
    );
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
    `\n${renamed.length} renamed around an icon of the same name already in raw-svgs/:\n` +
      renamed.map((line) => `  ${line}`).join("\n") +
      `\nEach is a new export. The icons already there keep their names and their artwork, ` +
      `so nothing already published changes.`
  );
}
