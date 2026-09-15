import { svgProps, type IconProps } from "./svg-props.ts";

export function ThemeIcon({
  mode,
  size = 16,
  className,
}: IconProps & { mode: "system" | "light" | "dark" }) {
  return (
    <svg {...svgProps(size, "0 0 16 16", className)}>
      {mode === "dark" ? (
        <path d="M13.5 9.1A5.6 5.6 0 0 1 6.9 2.5a5.6 5.6 0 1 0 6.6 6.6Z" />
      ) : mode === "light" ? (
        <>
          <circle cx="8" cy="8" r="2.75" />
          <path d="M8 1v1.25M8 13.75V15M1 8h1.25M13.75 8H15M3.05 3.05l.89.89m8.12 8.12.89.89M3.05 12.95l.89-.89m8.12-8.12.89-.89" />
        </>
      ) : (
        <>
          <rect x="1.5" y="2" width="13" height="9" rx="1.5" />
          <path d="M8 11v3m-3 0h6" />
        </>
      )}
    </svg>
  );
}
