import styles from "./OctopusLogo.module.css";

export interface OctopusLogoProps {
  className?: string | undefined;
  size?: number | undefined;
}

/**
 * The single product mark used across Octoscode Web surfaces.
 *
 * The surrounding control or nearby product name owns the accessible label;
 * the mark itself is consistently decorative.
 */
export function OctopusLogo({ className, size = 24 }: OctopusLogoProps) {
  return (
    <svg
      className={`${styles.root} ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-octopus-logo=""
    >
      <g fill="currentColor" transform="translate(32 32)">
        {Array.from({ length: 8 }, (_, i) => (
          <path
            key={i}
            d="M 0 -9 C -3.1 -9 -5 -10.4 -5 -14.8 C -5 -20.3 -2.5 -25 0.8 -25 C 3.6 -25 5.4 -22.9 4.9 -20.7 C 4.7 -20 4.2 -19.6 3.9 -19.7 C 3.6 -19.8 3.5 -20.1 3.2 -20 C 2.9 -19.9 2.9 -19.5 3 -19 C 3.4 -16.3 4.5 -13.3 4.3 -11.7 C 4.1 -9.8 2.1 -9 0 -9 Z"
            transform={`rotate(${i * 45})`}
          />
        ))}
        <path
          fillRule="evenodd"
          d="M 12.5 0 A 12.5 12.5 0 1 0 -12.5 0 A 12.5 12.5 0 1 0 12.5 0 Z M -2.4 -4.7 L -7.5 0 L -2.4 4.7 L -0.9 3.05 L -4.25 0 L -0.9 -3.05 Z M 2.4 -4.7 L 7.5 0 L 2.4 4.7 L 0.9 3.05 L 4.25 0 L 0.9 -3.05 Z"
        />
      </g>
    </svg>
  );
}
