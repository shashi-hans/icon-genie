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
function buildComponent(componentName, innerByWeight) {
  const reg = innerByWeight.regular;
  const duo = innerByWeight.duotone;
  // Exact suffix match => duotone == <tint path(s)> + <regular path>.
  const duoReusesRegular = duo.length > reg.length && duo.endsWith(reg);
  const tint = duoReusesRegular ? duo.slice(0, duo.length - reg.length) : null;

  const caseFor = (weight, body) =>
    `    case "${weight}":\n      paths = (\n        <>${body}</>\n      );\n      break;`;

  const cases = [
    caseFor("thin", innerByWeight.thin),
    caseFor("light", innerByWeight.light),
    caseFor("bold", innerByWeight.bold),
    caseFor("fill", innerByWeight.fill),
    duoReusesRegular
      ? `    case "duotone":\n      paths = (\n        <>${tint}{regular}</>\n      );\n      break;`
      : caseFor("duotone", duo),
  ];

  const regHoist = duoReusesRegular
    ? `  const regular = (\n    <>${reg}</>\n  );\n`
    : "";
  const defaultBody = duoReusesRegular
    ? `      paths = regular;`
    : `      paths = (\n        <>${reg}</>\n      );`;

  return `import type * as React from "react";
import { IconBase } from "../IconBase";
import type { IconProps } from "../types";

export function ${componentName}({
  weight = "regular",
  ...props
}: IconProps): React.ReactElement {
${regHoist}  let paths: React.ReactElement;
  switch (weight) {
${cases.join("\n")}
    case "regular":
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

const manifest = [];
const seenComponents = new Map();
let skipped = 0;

for (const iconName of iconDirs) {
  const dir = path.join(RAW_SVGS_DIR, iconName);

  const componentName = toPascalCase(iconName);
  if (seenComponents.has(componentName)) {
    console.warn(
      `  name collision: "${iconName}" and "${seenComponents.get(componentName)}" both map to ${componentName}; skipping the former.`
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

  for (const weight of WEIGHTS) {
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

  // Any weight that failed to load falls back to the regular markup so the
  // component never renders an empty <svg>.
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
