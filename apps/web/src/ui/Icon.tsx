/**
 * Shared stroke icons — single source for the product's icon set (tasteskill
 * rule: one grid family, uniform 1.5 stroke). Icons are decorative by
 * default (`aria-hidden`): pair with an aria-label or visually-hidden text
 * when the icon is the only content of a control.
 */
interface IconProps {
  size?: number | undefined;
  className?: string | undefined;
}

function svgProps(
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

export function RefreshIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, "0 0 16 16", className)}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 1.5v3h-3" />
    </svg>
  );
}

export function GearIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, "0 0 16 16", className)}>
      <path d="M6.7 1.3h2.6l.36 1.5c.4.16.79.38 1.14.65l1.48-.45 1.3 2.25-1.12 1.04c.03.24.04.47.04.71s-.01.47-.04.71l1.12 1.04-1.3 2.25-1.48-.45c-.35.27-.73.49-1.14.65l-.36 1.5H6.7l-.36-1.5a5.3 5.3 0 0 1-1.14-.65L3.72 11l-1.3-2.25 1.12-1.04A5.8 5.8 0 0 1 3.5 7c0-.24.01-.47.04-.71L2.42 5.25 3.72 3l1.48.45c.35-.27.73-.49 1.14-.65l.36-1.5Z" />
      <circle cx="8" cy="7" r="1.75" />
    </svg>
  );
}

export function ModelsIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, "0 0 16 16", className)}>
      <ellipse cx="8" cy="3.5" rx="5.5" ry="2" />
      <path d="M2.5 3.5v4c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2v-4M2.5 7.5v4c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2v-4" />
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

export function ChevronDownIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size, "0 0 14 14", className)}>
      <path d="M3.5 5.25 7 8.75l3.5-3.5" />
    </svg>
  );
}

export function CheckIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, "0 0 16 16", className)}>
      <path d="m3.4 8.2 2.8 2.8 6.4-6.4" />
    </svg>
  );
}

export function ShieldIcon({
  size = 16,
  className,
  dangerous = false,
}: IconProps & { dangerous?: boolean }) {
  return (
    <svg {...svgProps(size, "0 0 16 16", className)}>
      <path d="M8 1.1 14 3.35v3.32c0 4.55-3.42 6.57-6 7.56-2.58-.99-6-3.01-6-7.56V3.35L8 1.1Z" />
      {dangerous ? (
        <path
          d="M8.7 4.5v4H7.3v-4h1.4Zm0 5v1.5H7.3V9.5h1.4Z"
          fill="currentColor"
          stroke="none"
        />
      ) : (
        <path d="m5 7.8 1.9 1.9L11.2 5" />
      )}
    </svg>
  );
}

export function FolderIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size, "0 0 18 18", className)}>
      <path d="M2.25 4.5c0-.69.56-1.25 1.25-1.25h3.13l1.25 1.5h6.62c.69 0 1.25.56 1.25 1.25v7.25c0 .69-.56 1.25-1.25 1.25h-11c-.69 0-1.25-.56-1.25-1.25V4.5Z" />
    </svg>
  );
}

export function PlusIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, "0 0 16 16", className)}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...svgProps(size, "0 0 15 15", className)}>
      <path d="m8.75 3.25-4.25 4.25 4.25 4.25M4.75 7.5h6" />
    </svg>
  );
}

export function ArrowUpIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, "0 0 16 16", className)}>
      <path d="M8 13V3m-4 4 4-4 4 4" />
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
