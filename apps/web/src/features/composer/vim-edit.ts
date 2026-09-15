/** Pinned TUI's pragmatic composer Vim subset, adapted from UTF-8 byte offsets
 * to DOM UTF-16 offsets. Pure editing only: never submits or interrupts work.
 * Like the TUI, motions operate on Unicode scalar values, not grapheme clusters. */
export interface VimModeState {
  mode: "insert" | "normal";
  pending: "g" | "d" | "c" | null;
}
export interface VimEditSnapshot extends VimModeState {
  enabled: boolean;
  text: string;
  selectionStart: number;
  selectionEnd: number;
  selectionDirection?: "forward" | "backward" | "none";
}
export interface VimKey {
  key: string;
  isComposing?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}
export interface VimEditResult extends VimModeState {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: "forward" | "backward" | "none";
  consumed: boolean;
}

/** Enabling OR disabling Vim returns typing to Insert, as the TUI does. */
export function resetVimMode(): VimModeState {
  return { mode: "insert", pending: null };
}
/** Call on blur/record change; an unfinished `d` must never affect another draft. */
export function clearVimPending(state: VimModeState): VimModeState {
  return { mode: state.mode, pending: null };
}

/**
 * The pinned TUI's exact, closed Normal-mode operation set (21 operations):
 * ten motions (`h l j k 0 $ w b e G`), four two-key operators (`gg dd dw cc`),
 * one edit (`x`), and the six Insert entries (`i a A I o O`). `cc` clears the
 * line, drops the caret on it, then enters Insert — exactly as the TUI does.
 * Anything outside this set is a Normal-mode no-op that never inserts text.
 */
export const VIM_NORMAL_OPERATIONS: readonly string[] = [
  "h",
  "l",
  "j",
  "k",
  "0",
  "$",
  "w",
  "b",
  "e",
  "G",
  "x",
  "gg",
  "dd",
  "dw",
  "cc",
  "i",
  "a",
  "A",
  "I",
  "o",
  "O",
];

export function reduceVimEdit(
  snapshot: VimEditSnapshot,
  key: VimKey,
): VimEditResult {
  const text = snapshot.text;
  const first = scalarBoundary(text, snapshot.selectionStart);
  const last = scalarBoundary(text, snapshot.selectionEnd);
  const result: VimEditResult = {
    text,
    selectionStart: Math.min(first, last),
    selectionEnd: Math.max(first, last),
    selectionDirection: snapshot.selectionDirection ?? "none",
    mode: snapshot.mode,
    pending: snapshot.pending,
    consumed: false,
  };
  // Browser-native clipboard, assistive shortcuts, AltGr, and IME own their
  // keys. Clearing an operator prevents a later plain key from completing it.
  if (
    !snapshot.enabled ||
    key.isComposing ||
    key.ctrlKey ||
    key.metaKey ||
    key.altKey ||
    ["Process", "Dead", "Unidentified"].includes(key.key)
  ) {
    result.pending = null;
    return result;
  }
  if (result.mode === "insert") {
    if (key.key === "Escape") {
      result.mode = "normal";
      result.pending = null;
      result.consumed = true;
    }
    return result;
  }
  if (key.key === "Enter") {
    result.pending = null;
    return result; // Existing FIFO/steering dispatch alone owns Enter.
  }
  if (key.key === "Escape") {
    result.consumed = result.pending !== null;
    result.pending = null;
    return result; // A second bare Esc may reach the existing interrupt path.
  }
  if (Array.from(key.key).length !== 1) {
    // Arrows/Home/End/Tab/Delete etc. remain native; do not keep an operator
    // across a cursor/selection/focus move that this reducer cannot observe.
    result.pending = null;
    return result;
  }

  result.consumed = true;
  // Browser selection is not Vim Visual mode. An explicit Vim operation acts
  // at its active caret edge, never silently deletes the selected range.
  const cursor =
    result.selectionDirection === "backward"
      ? result.selectionStart
      : result.selectionEnd;
  const move = (position: number) => {
    result.selectionStart = result.selectionEnd = scalarBoundary(
      result.text,
      position,
    );
    result.selectionDirection = "none";
  };
  const replace = (start: number, end: number, insert = "") => {
    result.text = text.slice(0, start) + insert + text.slice(end);
    move(start + insert.length);
  };
  const start = lineStart(text, cursor);
  const end = lineEnd(text, cursor);
  const pending = result.pending;
  result.pending = null;
  if (pending !== null) {
    switch (`${pending}${key.key}`) {
      case "gg":
        move(0);
        break;
      case "dw":
        replace(cursor, wordForward(text, cursor));
        break;
      case "dd":
        if (end < text.length) replace(start, end + 1);
        else if (start > 0) replace(start - 1, end);
        else replace(0, end);
        break;
      case "cc":
        replace(start, end);
        result.mode = "insert";
        break;
      // The native subset consumes unknown two-key sequences without editing.
    }
    return result;
  }
  if (key.key === "!" && !text) {
    // The existing command resolver still rejects browser shell execution.
    result.mode = "insert";
    result.consumed = false;
    return result;
  }
  switch (key.key) {
    case "h":
      move(previousScalar(text, cursor));
      break;
    case "l":
      move(nextScalar(text, cursor));
      break;
    case "j":
    case "k": {
      const column = Array.from(text.slice(start, cursor)).length;
      if (key.key === "k" && start > 0) {
        const aboveStart = lineStart(text, start - 1);
        move(columnOffset(text, aboveStart, start - 1, column));
      } else if (key.key === "j" && end < text.length) {
        const belowStart = end + 1;
        move(columnOffset(text, belowStart, lineEnd(text, belowStart), column));
      }
      break;
    }
    case "0":
    case "I":
      move(start);
      if (key.key === "I") result.mode = "insert";
      break;
    case "$":
    case "A":
      move(end);
      if (key.key === "A") result.mode = "insert";
      break;
    case "w":
      move(wordForward(text, cursor));
      break;
    case "b":
      move(wordBackward(text, cursor));
      break;
    case "e":
      move(wordEnd(text, cursor));
      break;
    case "G":
      move(text.length);
      break;
    case "x":
      replace(cursor, nextScalar(text, cursor));
      break;
    case "g":
    case "d":
    case "c":
      result.pending = key.key;
      break;
    case "i":
      move(cursor);
      result.mode = "insert";
      break;
    case "a":
      move(nextScalar(text, cursor));
      result.mode = "insert";
      break;
    case "o":
      replace(end, end, "\n");
      result.mode = "insert";
      break;
    case "O":
      replace(start, start, "\n");
      move(start);
      result.mode = "insert";
      break;
    // Unknown Normal-mode characters are swallowed, never sent to a model.
  }
  return result;
}

function scalarBoundary(text: string, value: number): number {
  const offset = Number.isFinite(value)
    ? Math.max(0, Math.min(text.length, Math.trunc(value)))
    : text.length;
  return offset > 0 &&
    offset < text.length &&
    isHighSurrogate(text.charCodeAt(offset - 1)) &&
    isLowSurrogate(text.charCodeAt(offset))
    ? offset - 1
    : offset;
}
function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}
function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff;
}
function previousScalar(text: string, cursor: number): number {
  return scalarBoundary(text, Math.max(0, cursor - 1));
}
function nextScalar(text: string, cursor: number): number {
  if (cursor >= text.length) return text.length;
  return cursor + ((text.codePointAt(cursor) ?? 0) > 0xffff ? 2 : 1);
}
function lineStart(text: string, cursor: number): number {
  return text.slice(0, cursor).lastIndexOf("\n") + 1;
}
function lineEnd(text: string, cursor: number): number {
  const found = text.indexOf("\n", cursor);
  return found < 0 ? text.length : found;
}
function columnOffset(
  text: string,
  start: number,
  end: number,
  column: number,
): number {
  return (
    start + Array.from(text.slice(start, end)).slice(0, column).join("").length
  );
}
// Rust char::is_whitespace is Unicode White_Space, unlike JavaScript \s
// (which also includes FEFF and omits U+0085).
function whitespace(text: string, cursor: number): boolean {
  return /\p{White_Space}/u.test(text.slice(cursor, nextScalar(text, cursor)));
}
function wordForward(text: string, cursor: number): number {
  let at = cursor;
  while (at < text.length && !whitespace(text, at)) at = nextScalar(text, at);
  while (at < text.length && whitespace(text, at)) at = nextScalar(text, at);
  return at;
}
function wordBackward(text: string, cursor: number): number {
  let at = cursor;
  while (at > 0 && whitespace(text, previousScalar(text, at)))
    at = previousScalar(text, at);
  while (at > 0 && !whitespace(text, previousScalar(text, at)))
    at = previousScalar(text, at);
  return at;
}
function wordEnd(text: string, cursor: number): number {
  let at = nextScalar(text, cursor);
  while (at < text.length && whitespace(text, at)) at = nextScalar(text, at);
  if (at >= text.length) return text.length;
  while (
    nextScalar(text, at) < text.length &&
    !whitespace(text, nextScalar(text, at))
  )
    at = nextScalar(text, at);
  return at;
}
