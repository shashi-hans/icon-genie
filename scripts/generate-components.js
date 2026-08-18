#!/usr/bin/env node
// Step 2 of the pipeline: turn each ./raw-svgs/<icon>/ folder into a single
// React component at ./src/icons/<ComponentName>.tsx.
//
// Design note: the chosen API is one component per icon with a `weight` prop
// (<Airplane weight="bold" />), so a component embeds all six weights and
// switches at render. SVGR maps one SVG to one component, which does not fit
// this shape, so we assemble the component directly here. Phosphor's inner
// markup is plain <path> elements with JSX-valid attributes (`d`, `opacity`),
// so it is spliced in verbatim after SVGO has optimised it.
import fs from "node:fs";
import path from "node:path";
import {
  RAW_SVGS_DIR,
  ICONS_OUT_DIR,
  MANIFEST_PATH,
  WEIGHTS,
  SOURCE_WEIGHTS,
  toPascalCase,
  extractSvgInner,
  centerlinePaths,
} from "./utils.js";

// AI-generated icon: 1–4 centerline paths rendered by the shared StrokeIcon,
// which derives all six weights at render time. Far smaller than embedding six
// path-sets, and the weights stay coherent because they come from one drawing.
function buildStrokeComponent(componentName, paths) {
  return `import type * as React from "react";
import { StrokeIcon } from "../StrokeIcon";
import type { IconProps } from "../types";

const D = ${JSON.stringify(paths)};

export function ${componentName}(props: IconProps): React.ReactElement {
  return <StrokeIcon d={D} {...props} />;
}

${componentName}.displayName = "${componentName}";
`;
}

// Builds one icon component. Key choices, all for speed/size:
//   - The <svg> wrapper lives in the shared IconBase, not here.
//   - A switch instantiates ONLY the rendered weight's element (not all six),
//     so rendering allocates one element instead of six.
//   - When the duotone weight's solid path is byte-identical to the regular
//     path (true for ~70% of icons), regular is hoisted into a local and
//     reused by both, removing the duplicated path data. The hoist is only
//     emitted when it pays off, so other icons stay fully lazy.
// Every label the switch must answer, grouped under the weight it renders as.
// The removed weights ride along with their replacement, so keeping them costs
// no extra markup: "light" sits with thin, "bold" and "sharp" with regular.
const WEIGHT_LABELS = {
  thin: ["thin", "light"],
  regular: ["regular", "bold", "sharp"],
  fill: ["fill"],
  duotone: ["duotone"],
};

for (const weight of WEIGHTS) {
  if (!WEIGHT_LABELS[weight]) {
    throw new Error(`WEIGHT_LABELS has no entry for "${weight}"; add one when adding a weight.`);
  }
}

function buildComponent(componentName, innerByWeight) {
  const reg = innerByWeight.regular;
  const duo = innerByWeight.duotone;
  // Exact suffix match => duotone == <tint path(s)> + <regular path>.
  const duoReusesRegular = duo.length > reg.length && duo.endsWith(reg);
  const tint = duoReusesRegular ? duo.slice(0, duo.length - reg.length) : null;

  // Weights whose markup is byte-identical share one case block, so a drawing
  // used by several weights is stored once. Most icons have a thin that equals
  // regular, or no separate fill, and across the catalogue that repetition came
  // to 2.6 MB of duplicated path data.
  /** @type {Map<string, string[]>} markup -> the labels that render it */
  const groups = new Map();
  for (const weight of WEIGHTS) {
    // Emitted from the hoisted `regular` below instead, when it can be.
    if (weight === "duotone" && duoReusesRegular) continue;
    const markup = innerByWeight[weight];
    if (!groups.has(markup)) groups.set(markup, []);
    groups.get(markup).push(...WEIGHT_LABELS[weight]);
  }

  const heads = (labels) => labels.map((w) => `    case "${w}":`).join("\n");

  // Whichever group holds "regular" becomes the default arm, so an unrecognised
  // weight renders regular rather than leaving `paths` unassigned.
  let regularMarkup = reg;
  let regularLabels = [];
  const cases = [];
  for (const [markup, labels] of groups) {
    if (labels.includes("regular")) {
      regularMarkup = markup;
      regularLabels = labels.filter((w) => w !== "regular");
    } else {
      cases.push(`${heads(labels)}\n      paths = (\n        <>${markup}</>\n      );\n      break;`);
    }
  }
  if (duoReusesRegular) {
    cases.push(`    case "duotone":\n      paths = (\n        <>${tint}{regular}</>\n      );\n      break;`);
  }

  const regHoist = duoReusesRegular
    ? `  const regular = (\n    <>${reg}</>\n  );\n`
    : "";
  const defaultBody = duoReusesRegular
    ? `      paths = regular;`
    : `      paths = (\n        <>${regularMarkup}</>\n      );`;
  const switchBody =
    (cases.length ? cases.join("\n") + "\n" : "") +
    (regularLabels.length ? heads(regularLabels) + "\n" : "");

  return `import type * as React from "react";
import { IconBase } from "../IconBase";
import type { IconProps } from "../types";

export function ${componentName}({
  weight = "regular",
  ...props
}: IconProps): React.ReactElement {
${regHoist}  let paths: React.ReactElement;
  switch (weight) {
${switchBody}    case "regular":
    default:
${defaultBody}
      break;
  }
  return <IconBase {...props}>{paths}</IconBase>;
}

${componentName}.displayName = "${componentName}";
`;
}

if (!fs.existsSync(RAW_SVGS_DIR)) {
  console.error(`Error: ${RAW_SVGS_DIR} not found. Import SVGs first.`);
  process.exit(1);
}

// Fresh output dir so removed icons don't linger.
fs.rmSync(ICONS_OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(ICONS_OUT_DIR, { recursive: true });

const iconDirs = fs
  .readdirSync(RAW_SVGS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const WEIGHT_FILE_RE = new RegExp(`-(${SOURCE_WEIGHTS.join("|")})\\.svg$`);

const manifest = [];
const seenComponents = new Map();
let skipped = 0;

for (const iconName of iconDirs) {
  const dir = path.join(RAW_SVGS_DIR, iconName);

  const componentName = toPascalCase(iconName);
  if (seenComponents.has(componentName)) {
    console.warn(
      `  name collision: "${iconName}" and "${seenComponents.get(componentName)}" both map to ${componentName}; keeping "${seenComponents.get(componentName)}".`
    );
    skipped++;
    continue;
  }

  // Stroke-based (AI-generated) icon: 1–4 centerline paths -> StrokeIcon.
  let centerline = null;
  try {
    centerline = centerlinePaths(dir, iconName);
  } catch (err) {
    console.warn(`  ${iconName}: ${err.message}`);
  }
  if (centerline) {
    // A centerline file wins outright, so any weight files beside it are dead
    // weight nobody will see. import-phosphor.js renames incoming icons around
    // this; anything else that put both here is worth naming rather than
    // dropping in silence.
    const ignored = fs.readdirSync(dir).filter((f) => WEIGHT_FILE_RE.test(f));
    if (ignored.length) {
      console.warn(
        `  ${iconName}: ignoring ${ignored.length} weight files — the centerline file takes precedence. Rename one of the two.`
      );
    }
    seenComponents.set(componentName, iconName);
    fs.writeFileSync(
      path.join(ICONS_OUT_DIR, `${componentName}.tsx`),
      buildStrokeComponent(componentName, centerline)
    );
    manifest.push({ name: iconName, component: componentName, kind: "stroke" });
    continue;
  }

  const innerByWeight = {};
  let regularInner = null;

  for (const weight of SOURCE_WEIGHTS) {
    const file = path.join(dir, `${iconName}-${weight}.svg`);
    if (!fs.existsSync(file)) continue;
    try {
      const inner = extractSvgInner(fs.readFileSync(file, "utf8"));
      innerByWeight[weight] = inner;
      if (weight === "regular") regularInner = inner;
    } catch (err) {
      console.warn(`  ${iconName} (${weight}): ${err.message}`);
    }
  }

  if (!regularInner) {
    console.warn(`  skipping "${iconName}": no usable regular weight.`);
    skipped++;
    continue;
  }

  // Any weight with no file falls back to regular so the component never
  // renders an empty <svg>. That is how drawn icons get their `sharp`: Phosphor
  // ships no sharp artwork, and a filled outline cannot have its corners
  // un-rounded after the fact. Only centerline icons derive a real one.
  for (const weight of WEIGHTS) {
    if (!innerByWeight[weight]) innerByWeight[weight] = regularInner;
  }

  seenComponents.set(componentName, iconName);

  fs.writeFileSync(
    path.join(ICONS_OUT_DIR, `${componentName}.tsx`),
    buildComponent(componentName, innerByWeight)
  );
  manifest.push({ name: iconName, component: componentName });
}

manifest.sort((a, b) => a.component.localeCompare(b.component));
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");

console.log(
  `Generated ${manifest.length} icon components` +
    (skipped ? ` (${skipped} skipped)` : "") +
    ` in ${path.relative(process.cwd(), ICONS_OUT_DIR)}/`
);
