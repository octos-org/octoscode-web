/** Icons used before the optional workspace surfaces have loaded. */
import { svgProps, type IconProps } from "./svg-props.ts";

export function RefreshIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, "0 0 16 16", className)}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 1.5v3h-3" />
    </svg>
  );
}

export function CloseIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size, "0 0 14 14", className)}>
      <path d="m3.5 3.5 7 7m0-7-7 7" />
    </svg>
  );
}

export function MenuIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, "0 0 16 16", className)}>
      <path d="M3 4h10M3 8h10M3 12h10" />
    </svg>
  );
}

export function DiffIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, "0 0 16 16", className)}>
      <path d="M9 1.5H3v13h10V5.5L9 1.5Zm0 0v4h4M5.5 8h5M5.5 11h5M8 6v4" />
    </svg>
  );
}
