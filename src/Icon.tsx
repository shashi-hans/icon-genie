import type * as React from "react";
import type { IconProps } from "./types";

// Rendering an icon chosen at runtime: <Icon name={row.icon} />.
//
// The name is looked up in a registry you fill, rather than in a built-in table
// of all 8,468 components. A built-in table would be a static reference to every
// icon in the package, so a bundler could drop none of them and importing one
// icon would ship all of them. Registering is the one line that keeps the
// tree-shaking this library is built around:
//
//   import { Icon, registerIcons, Heart, Star } from "@shashi-hans/icons";
//   registerIcons({ Heart, Star });
//   <Icon name="heart" />        // or "Heart"
//
// For a name that is genuinely unknown until runtime — user input, a CMS field —
// nothing bundled can help, because the bundler cannot know what to keep. Use
// the <sh-icon> web component, which fetches the drawing over HTTP.

/** The shape every generated icon component has. */
export type IconComponent = (props: IconProps) => React.ReactElement;

/**
 * Registered under a form that ignores case and separators, so "arrow-left",
 * "arrowLeft" and "ArrowLeft" all find the same component.
 */
const key = (name: string) => name.replace(/[^a-zA-Z0-9]+/g, "").toLowerCase();

const registry = new Map<string, IconComponent>();

/** Make icons available to `<Icon name=... />`. Safe to call more than once. */
export function registerIcons(icons: Record<string, IconComponent>): void {
  for (const [exportName, component] of Object.entries(icons)) {
    if (typeof component !== "function") continue;
    registry.set(key(exportName), component);
    // Registering under displayName too means `registerIcons(await import(...))`
    // works even where the local binding was renamed.
    const shown = (component as { displayName?: string }).displayName;
    if (shown) registry.set(key(shown), component);
  }
}

/** Whether a name currently resolves. */
export function isIconRegistered(name: string): boolean {
  return registry.has(key(name));
}

/** Every registered name, in the normalised form used for lookup. */
export function registeredIcons(): string[] {
  return [...registry.keys()].sort();
}

export interface NamedIconProps extends IconProps {
  /** Icon name in any casing: "arrow-left", "arrowLeft" or "ArrowLeft". */
  name: string;
  /** Rendered when the name is not registered. Nothing, by default. */
  fallback?: React.ReactElement | null;
}

export function Icon({ name, fallback = null, ...props }: NamedIconProps): React.ReactElement | null {
  const Found = registry.get(key(name));
  // A missing icon renders nothing rather than throwing: a name usually arrives
  // from data, and one bad row should not take the page down.
  if (!Found) return fallback;
  return <Found {...props} />;
}
