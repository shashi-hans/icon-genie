import type * as React from "react";

// The six Phosphor weights, ordered light-to-heavy with fill/duotone last.
export type IconWeight =
  | "thin"
  | "light"
  | "regular"
  | "bold"
  | "fill"
  | "duotone";

// The full list of weights, exported for runtime use (e.g. building pickers).
export const ICON_WEIGHTS: readonly IconWeight[] = [
  "thin",
  "light",
  "regular",
  "bold",
  "fill",
  "duotone",
] as const;

// Props accepted by every icon component. Extends the native <svg> props so
// callers can pass any standard SVG attribute (data-*, focusable, etc.) while
// the fields below are the documented, first-class API.
export interface IconProps
  extends Omit<React.SVGProps<SVGSVGElement>, "color" | "ref"> {
  // Width and height of the icon. A number is treated as pixels.
  size?: number | string;
  // Any CSS color value. Drives the SVG `fill`, so it cascades to every path.
  color?: string;
  // Which Phosphor weight to render. Defaults to "regular".
  weight?: IconWeight;
  className?: string;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<SVGSVGElement>;
  // When provided, the icon is exposed to assistive tech as an image with
  // this label; when omitted, the icon is marked aria-hidden.
  "aria-label"?: string;
}

// Shape returned by the generated generateMetadata() export.
export interface IconLibraryMetadata {
  totalIcons: number;
  weights: readonly IconWeight[];
  iconNames: string[];
}
