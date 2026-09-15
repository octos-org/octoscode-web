/**
 * The Show-thinking browser preference (UX5 goal 1). Kept as its own key so
 * the strict display-preferences store (4-field whitelist) stays untouched;
 * default ON — thinking renders folded, never silently hidden.
 */
export const SHOW_THINKING_KEY = "octoscode.web.show-thinking.v1";
export const DEFAULT_SHOW_THINKING = true;

/** Strict boolean parse; anything malformed fails closed to ON. */
export function parseShowThinking(raw: string | null): boolean {
  return raw !== "false" && raw !== "true"
    ? DEFAULT_SHOW_THINKING
    : raw === "true";
}

export function writeShowThinking(
  storage: Pick<Storage, "setItem"> | null,
  value: boolean,
): boolean {
  try {
    if (!storage) throw new Error("no storage");
    storage.setItem(SHOW_THINKING_KEY, value ? "true" : "false");
    return true;
  } catch {
    return false;
  }
}