/**
 * Shared stroke icons (16px grid, uniform 1.5 stroke — tasteskill icon
 * rule). Icons are decorative by default: pair with an aria-label or
 * visually-hidden text when the icon is the only content of a control.
 */
interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number | undefined, className: string | undefined) {
  return {
    width: size ?? 16,
    height: size ?? 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };
}

export function RefreshIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 1.5v3h-3" />
    </svg>
  );
}
