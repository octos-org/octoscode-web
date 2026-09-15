export interface IconProps {
  size?: number | undefined;
  className?: string | undefined;
}

export function svgProps(
  size: number,
  viewBox: string,
  className: string | undefined,
) {
  return {
    width: size,
    height: size,
    viewBox,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };
}
