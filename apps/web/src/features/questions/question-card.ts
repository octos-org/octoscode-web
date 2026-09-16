import type { UserQuestion } from "@octos-org/octoscode-client/protocol";
import { answersComplete, type DraftAnswer } from "./answers.ts";

/**
 * Card-shaped rules for the question takeover, kept pure so the panel stays
 * presentation only. Nothing here touches the wire: `answers.ts` still owns
 * the draft → protocol mapping.
 */

/**
 * Why the primary action cannot run yet, as English source text for
 * `useUiText`. `null` means the action is live — a disabled control always has
 * a reason next to it, never a dead button the operator has to guess about.
 */
export function submitBlockedReason(
  busy: boolean,
  answers: readonly DraftAnswer[],
): string | null {
  if (busy) return "Sending your answer…";
  if (answersComplete(answers)) return null;
  const remaining = answers.filter(
    (answer) => answer.selectedLabels.length === 0 && !answer.freeText.trim(),
  ).length;
  return remaining === answers.length && answers.length === 1
    ? "Choose an option to continue"
    : "Answer every question to continue";
}

/** How a question's choices behave, for the row hint under the legend. */
export function choiceHint(question: UserQuestion): string {
  if (question.multiSelect) {
    return question.allowFreeText
      ? "Choose any that apply, or write your own"
      : "Choose any that apply";
  }
  return question.allowFreeText
    ? "Choose one, or write your own"
    : "Choose one";
}

/**
 * Arrow-key target within one option group. Native radio groups already do
 * this; a multi-select group is checkboxes, which the browser leaves inert, so
 * the panel moves focus itself. Wraps at both ends like a radio group does.
 */
export function nextOptionIndex(
  current: number,
  delta: number,
  count: number,
): number {
  if (count <= 0) return 0;
  return (current + delta + count) % count;
}

/** The arrow keys that move within a group, mapped to their direction. */
export function arrowDelta(key: string): number | null {
  if (key === "ArrowDown" || key === "ArrowRight") return 1;
  if (key === "ArrowUp" || key === "ArrowLeft") return -1;
  return null;
}
