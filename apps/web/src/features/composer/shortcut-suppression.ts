/**
 * §8 (design 4000, brief 4010): Alt+A / Alt+P / Alt+D "none of them fire
 * while focus is inside a text input or dialog".
 *
 * Pure predicate + one DOM classifier, owned by the composer surface. The
 * three window listeners live in App.tsx (ux-strip-01's file this round);
 * they consult `shortcutTargetSuppressed(event.target)` FIRST and treat a
 * suppressed event as a no-op (no preventDefault, no focus steal) so a text
 * chord an IME or a dialog owns is never shadowed.
 */

/** The two §8 suppression facts. */
export interface ShortcutSuppressionFacts {
  /** Focus is inside a text-entry control (input/textarea/contenteditable). */
  readonly targetIsTextInput: boolean;
  /** Focus is inside an open dialog ([role="dialog"]). */
  readonly inDialog: boolean;
}

/** True when a parity shortcut must NOT fire (either fact alone suffices). */
export function shortcutSuppressed(facts: ShortcutSuppressionFacts): boolean {
  return facts.targetIsTextInput || facts.inDialog;
}

/** Structural selectors the DOM classifier reads (§8; exported for tests). */
export const TEXT_INPUT_SUPPRESSION_SELECTOR =
  "input, textarea, select, [contenteditable='true'], [contenteditable='']";
export const DIALOG_SUPPRESSION_SELECTOR = '[role="dialog"]';

/**
 * Classify ONE event target (the focused element) against the §8 rule. Pure
 * structural DOM reads; a non-Element target (window/document/body) is never
 * suppressed. The dialog test uses `closest` so nested dialog content is
 * covered, exactly like the pane's own focus containment.
 */
export function shortcutTargetSuppressed(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(TEXT_INPUT_SUPPRESSION_SELECTOR) !== null) return true;
  return target.closest(DIALOG_SUPPRESSION_SELECTOR) !== null;
}