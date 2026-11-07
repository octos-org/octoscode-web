import { describe, expect, it } from "vitest";
import {
  reduceVimEdit,
  VIM_NORMAL_OPERATIONS,
  type VimEditSnapshot,
} from "./vim-edit.ts";

// The composer's Vim mode is the pinned TUI's closed 21-operation subset
// (docs/tui-command-coverage.md, "Vim"), applied to the user's unsent draft in
// DOM UTF-16 offsets. Before changing `reduceVimEdit`, keep what the browser
// suite cannot reach key by key: each operation edits as the TUI does, no
// Normal-mode key types into the draft, an IME's Escape never leaves Insert,
// and no edit splits a surrogate pair (that corrupts emoji and CJK text).
// Escape/Enter ownership, IME and clipboard keys, and per-Session drafts run in
// e2e/local-preferences.spec.ts.

function snapshot(marked: string): VimEditSnapshot {
  const cursor = marked.indexOf("|");
  if (cursor < 0) throw new Error("Test caret is missing");
  return {
    text: marked.replace("|", ""),
    selectionStart: cursor,
    selectionEnd: cursor,
    selectionDirection: "none",
    mode: "normal",
    pending: null,
    enabled: true,
  };
}
function press(marked: string, keys: string[]) {
  let state = snapshot(marked);
  for (const key of keys) {
    const result = reduceVimEdit(state, { key });
    expect(result.consumed).toBe(true);
    state = { ...state, ...result };
  }
  return state;
}
function marked(state: {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}) {
  expect(state.selectionStart).toBe(state.selectionEnd);
  return (
    state.text.slice(0, state.selectionStart) +
    "|" +
    state.text.slice(state.selectionEnd)
  );
}

describe("pinned TUI's 21 composer Vim operations", () => {
  const cases: [string, string, string, string?][] = [
    ["h", "a|b", "|ab"],
    ["l", "|ab", "a|b"],
    ["j", "a|b\nxy", "ab\nx|y"],
    ["k", "ab\nx|y", "a|b\nxy"],
    ["0", "ab\nx|yz", "ab\n|xyz"],
    ["$", "ab\nx|yz", "ab\nxyz|"],
    ["w", "a|bc de", "abc |de"],
    ["b", "abc d|e", "abc |de"],
    ["e", "a|bc def", "ab|c def"],
    ["G", "|abc\nde", "abc\nde|"],
    ["gg", "ab\nc|d", "|ab\ncd"],
    ["x", "a|bc", "a|c"],
    ["dd", "ab\nc|d\nef", "ab\n|ef"],
    ["dw", "a|bc de", "a|de"],
    ["cc", "ab\nc|d\nef", "ab\n|\nef", "insert"],
    ["i", "a|b", "a|b", "insert"],
    ["a", "a|b", "ab|", "insert"],
    ["A", "a|b\nc", "ab|\nc", "insert"],
    ["I", "a|b", "|ab", "insert"],
    ["o", "a|b\ncd", "ab\n|\ncd", "insert"],
    ["O", "ab\nc|d", "ab\n|\ncd", "insert"],
  ];
  it.each(cases)(
    "%s edits logical text/caret exactly",
    (keys, input, output, mode) => {
      const state = press(input, Array.from(keys));
      expect(marked(state)).toBe(output);
      expect(state.mode).toBe(mode ?? "normal");
      expect(state.pending).toBeNull();
    },
  );

  it("unknown Normal keys/unsupported Vim commands are swallowed without edits", () => {
    for (const key of ["q", "u", "v", "2", "/", "中"]) {
      const result = reduceVimEdit(snapshot("a|b"), { key });
      expect(result.consumed).toBe(true);
      expect(marked(result)).toBe("a|b");
      expect(result.mode).toBe("normal");
    }
    expect(marked(press("a|b", ["d", "x"]))).toBe("a|b");
  });

  it("composition Escape cannot leave Insert", () => {
    expect(
      reduceVimEdit(
        { ...snapshot("|"), mode: "insert" },
        { key: "Escape", isComposing: true },
      ),
    ).toMatchObject({ consumed: false, mode: "insert" });
  });

  it("empty ! enters Insert but leaves browser command rejection to existing resolver", () => {
    expect(reduceVimEdit(snapshot("|"), { key: "!" })).toMatchObject({
      mode: "insert",
      consumed: false,
      text: "",
    });
    expect(reduceVimEdit(snapshot("a|b"), { key: "!" })).toMatchObject({
      mode: "normal",
      consumed: true,
      text: "ab",
    });
  });
});

function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      return true;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}
function isScalarBoundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  );
}

describe("editing Unicode scalar values in DOM UTF-16 coordinates", () => {
  it.each([
    ["x", "A|😀B", "A|B"],
    ["j", "😀中|文\na😀x", "😀中文\na😀|x"],
    ["w", "|你好世界\u0085next", "你好世界\u0085|next"],
    ["b", "a 😀中|", "a |😀中"],
  ])("%s preserves scalar/whitespace semantics: %s", (keys, input, output) => {
    expect(marked(press(input, Array.from(keys)))).toBe(output);
  });

  it("clamps a browser caret inside a surrogate pair without splitting it", () => {
    const result = reduceVimEdit(
      { ...snapshot("A|😀B"), selectionStart: 2, selectionEnd: 2 },
      { key: "x" },
    );
    expect(marked(result)).toBe("A|B");
  });

  it.each([...VIM_NORMAL_OPERATIONS])(
    "%s never splits a surrogate pair at any caret edge",
    (operation) => {
      for (const input of ["A😀|B", "A|😀B", "😀|中", "a😀b|c"]) {
        const state = press(input, Array.from(operation));
        expect(hasLoneSurrogate(state.text)).toBe(false);
        expect(isScalarBoundary(state.text, state.selectionStart)).toBe(true);
        expect(isScalarBoundary(state.text, state.selectionEnd)).toBe(true);
      }
    },
  );
});
