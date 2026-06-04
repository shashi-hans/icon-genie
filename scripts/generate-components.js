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
} from "./utils.js";

function buildComponent(componentName, innerByWeight) {
  // The weight->markup map lives INSIDE the function on purpose. Defining it at
  // module top level would emit jsx() calls during module evaluation, which
  // bundlers treat as side effects and refuse to drop — defeating tree-shaking
  // even with sideEffects:false. As a local, each icon is a pure function
  // declaration, so unused icons are fully eliminated downstream.
  const weightEntries = WEIGHTS.map(
    (w) => `    ${w}: (\n      <>${innerByWeight[w]}</>\n    ),`
  ).join("\n");

  return `import type * as React from "react";
import type { IconProps, IconWeight } from "../types";

export function ${componentName}({
  size = 24,
  color = "currentColor",
  weight = "regular",
  className,
  style,
  onClick,
  "aria-label": ariaLabel,
  ...rest
}: IconProps): React.ReactElement {
  const weights: Record<IconWeight, React.ReactElement> = {
${weightEntries}
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill={color}
      className={className}
      style={style}
      onClick={onClick}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      aria-hidden={ariaLabel ? undefined : true}
      {...rest}
    >
      {weights[weight]}
    </svg>
  );
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

  const componentName = toPascalCase(iconName);
  if (seenComponents.has(componentName)) {
    console.warn(
      `  name collision: "${iconName}" and "${seenComponents.get(componentName)}" both map to ${componentName}; skipping the former.`
    );
    skipped++;
    continue;
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
