import type * as React from "react";
import type { IconProps } from "./types";

// Shared <svg> wrapper for every icon. Extracting it means the wrapper markup
// and prop handling live exactly once in the bundle instead of being repeated
// across ~1,500 components. Each generated icon selects its weight's paths and
// passes them here as children. `weight` is consumed by the icon itself, so it
// is omitted from this component's props.
export interface IconBaseProps extends Omit<IconProps, "weight"> {
  children: React.ReactNode;
}

export function IconBase({
  size = 24,
  color = "currentColor",
  className,
  style,
  onClick,
  "aria-label": ariaLabel,
  children,
  ...rest
}: IconBaseProps): React.ReactElement {
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
      {children}
    </svg>
  );
}
