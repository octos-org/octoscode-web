import type { Ref } from "react";
import { CloseIcon } from "./ShellIcons.tsx";
import styles from "./CloseButton.module.css";

export interface CloseButtonProps {
  /**
   * The accessible name. The button shows only an × glyph, so this is the
   * whole of what a screen reader announces — and what tests find it by.
   */
  readonly label: string;
  readonly onClick: () => void;
  readonly buttonRef?: Ref<HTMLButtonElement> | undefined;
}

/**
 * The one close control every settings surface uses: an × in the top-right
 * corner, named for assistive technology through `aria-label` and shown as a
 * tooltip on hover. One component rather than a style per pane, so the panes
 * cannot drift apart again.
 *
 * The glyph comes from ShellIcons, which is safe to load before the workspace
 * shell — Browser preferences opens from the connect screen.
 */
export function CloseButton({ label, onClick, buttonRef }: CloseButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={styles.close}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <CloseIcon />
    </button>
  );
}
