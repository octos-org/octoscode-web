/**
 * Judge r2 #8 (round 3): when a blocking request surface (approval card)
 * disappears, focus must move OFF the removed subtree — but ONLY if focus was
 * actually inside it. Pure decision helper so the behavior is testable
 * without a DOM; the surface calls it on unmount.
 */
export interface FocusRestoreInput {
  /** document.activeElement at the moment the surface unmounts. */
  readonly activeElement: HTMLElement | null;
  /** The removed subtree (disconnected at unmount). */
  readonly removed: HTMLElement;
  /** Where focus should land (e.g. the composer input). */
  readonly fallback: HTMLElement;
  /** Optional override; defaults to fallback.focus(). */
  readonly focus?: (target: HTMLElement) => void;
}

/** Returns true when focus was moved. */
export function restoreFocusAfterRemoval(
  input: FocusRestoreInput,
): boolean {
  const { activeElement, removed, fallback } = input;
  if (!activeElement) return false;
  // Still mounted: the "removal" hasn't happened; leave focus alone.
  if (removed.isConnected) return false;
  // Focus inside the removed subtree: a tab-key press would otherwise land on
  // <body> and keyboard users lose their place. Otherwise leave it — focus
  // was never ours to move.
  let wasInside = activeElement === removed;
  if (!wasInside) {
    try {
      wasInside = removed.contains(activeElement);
    } catch {
      wasInside = false;
    }
  }
  if (!wasInside) return false;
  (input.focus ?? ((target: HTMLElement) => target.focus?.()))(fallback);
  return true;
}
