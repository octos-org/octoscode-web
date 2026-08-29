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
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-octopus-logo=""
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5 10.5a7 7 0 0 1 14 0v3.8c0 1.6-1.3 2.9-2.9 2.9-1 0-1.9-.5-2.4-1.3A3 3 0 0 1 11.2 18a3 3 0 0 1-2.5-1.3 2.9 2.9 0 0 1-3.7-2.8v-3.4ZM10.3 10.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm5.4 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"
        fill="currentColor"
      />
    </svg>
  );
}
