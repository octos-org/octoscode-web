import { describe, expect, it } from "vitest";
import {
  clearVimPending,
  reduceVimEdit,
  resetVimMode,
  VIM_NORMAL_OPERATIONS,
  type VimEditSnapshot,
  type VimKey,
} from "./vim-edit.ts";

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

  it.each([
    ["dd", "ab\nc|d", "ab|"],
    ["dd", "a|b", "|"],
    ["dd", "a|b\ncd", "|cd"],
    ["dd", "ab\n|", "ab|"],
    ["cc", "a|b", "|"],
    ["dw", "abc|", "abc|"],
    ["dw", "ab| \n cd", "ab|cd"],
    ["j", "a|bc", "a|bc"],
    ["k", "a|bc", "a|bc"],
    ["h", "ab\n|cd", "ab|\ncd"],
    ["l", "ab|\ncd", "ab\n|cd"],
    ["j", "abc|d\nx\nlong", "abcd\nx|\nlong"],
  ])("%s handles line/buffer boundaries: %s", (keys, input, output) => {
    expect(marked(press(input, Array.from(keys)))).toBe(output);
  });
});

describe("editing Unicode scalar values in DOM UTF-16 coordinates", () => {
  it.each([
    ["h", "A😀|B", "A|😀B"],
    ["l", "A|😀B", "A😀|B"],
    ["x", "A|😀B", "A|B"],
    ["j", "😀中|文\na😀x", "😀中文\na😀|x"],
    ["k", "😀中x\na😀|b", "😀中|x\na😀b"],
    ["w", "|你好世界\u0085next", "你好世界\u0085|next"],
    ["w", "|a\uFEFFb c", "a\uFEFFb |c"],
    ["b", "a\u2003😀中|", "a\u2003|😀中"],
    ["e", "a| 😀中 z", "a 😀|中 z"],
    ["e", "|abc def", "ab|c def"],
    ["e", "ab|c def", "abc de|f"],
    ["w", "|hello,world next", "hello,world |next"],
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
  it("clamps out-of-range/invalid carets", () => {
    const result = reduceVimEdit(
      { ...snapshot("|ab"), selectionStart: NaN, selectionEnd: Infinity },
      { key: "h" },
    );
    expect(marked(result)).toBe("a|b");
  });
});

describe("native keyboard and existing dispatch ownership", () => {
  it("Insert Escape only enters Normal; the following Escape passes to existing interruption", () => {
    const state = { ...snapshot("a|b"), ...resetVimMode() };
    const first = reduceVimEdit(state, { key: "Escape" });
    expect(first).toMatchObject({
      mode: "normal",
      pending: null,
      consumed: true,
      text: "ab",
    });
    const second = reduceVimEdit({ ...state, ...first }, { key: "Escape" });
    expect(second).toMatchObject({
      mode: "normal",
      pending: null,
      consumed: false,
      text: "ab",
    });
  });
  it("Normal Escape cancels a pending operator without interrupting", () => {
    const first = reduceVimEdit(
      { ...snapshot("a|b"), pending: "d" },
      { key: "Escape" },
    );
    expect(first).toMatchObject({
      mode: "normal",
      pending: null,
      consumed: true,
    });
    expect(marked(first)).toBe("a|b");
  });
  it.each(["insert", "normal"] as const)(
    "Enter in %s delegates the existing submit path",
    (mode) => {
      const result = reduceVimEdit(
        { ...snapshot("a|b"), mode, pending: "d" },
        { key: "Enter" },
      );
      expect(result.consumed).toBe(false);
      expect(result.text).toBe("ab");
      if (mode === "normal") expect(result.pending).toBeNull();
    },
  );
  it.each([
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
    "Tab",
    "Backspace",
    "Delete",
  ])("%s stays native and clears an unfinished operator", (key) => {
    const result = reduceVimEdit({ ...snapshot("a|b"), pending: "d" }, { key });
    expect(result.consumed).toBe(false);
    expect(result.pending).toBeNull();
    expect(marked(result)).toBe("a|b");
  });
  const bypass: VimKey[] = [
    { key: "c", ctrlKey: true },
    { key: "v", metaKey: true },
    { key: "a", metaKey: true },
    { key: "x", ctrlKey: true },
    { key: "d", altKey: true },
    { key: "c", ctrlKey: true, altKey: true },
    { key: "h", isComposing: true },
    { key: "Escape", isComposing: true },
    { key: "Process" },
    { key: "Dead" },
    { key: "Unidentified" },
  ];
  it.each(bypass)("does not hijack clipboard/modifier/IME event %j", (key) => {
    const state = { ...snapshot("a|b"), pending: "c" as const };
    const result = reduceVimEdit(state, key);
    expect(result).toMatchObject({
      consumed: false,
      pending: null,
      mode: "normal",
    });
    expect(marked(result)).toBe("a|b");
    expect(state.pending).toBe("c");
  });
  it("composition Escape cannot leave Insert", () => {
    expect(
      reduceVimEdit(
        { ...snapshot("|"), mode: "insert" },
        { key: "Escape", isComposing: true },
      ),
    ).toMatchObject({ consumed: false, mode: "insert" });
  });
  it("disabled Vim leaves ordinary text and Escape to the native input", () => {
    for (const key of ["h", "Escape", "Enter"]) {
      const result = reduceVimEdit(
        { ...snapshot("a|b"), enabled: false, pending: "d" },
        { key },
      );
      expect(result.consumed).toBe(false);
      expect(marked(result)).toBe("a|b");
      expect(result.pending).toBeNull();
    }
  });
  it("unknown Normal keys/unsupported Vim commands are swallowed without edits", () => {
    for (const key of ["q", "u", "v", "2", "/", "中"]) {
      const result = reduceVimEdit(snapshot("a|b"), { key });
      expect(result.consumed).toBe(true);
      expect(marked(result)).toBe("a|b");
      expect(result.mode).toBe("normal");
    }
    expect(marked(press("a|b", ["d", "x"]))).toBe("a|b");
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
    expect(
      reduceVimEdit({ ...snapshot("|"), pending: "d" }, { key: "!" }),
    ).toMatchObject({
      mode: "normal",
      consumed: true,
      text: "",
      pending: null,
    });
  });
  it("toggle resets Insert; record/focus changes clear pending without changing mode", () => {
    expect(resetVimMode()).toEqual({ mode: "insert", pending: null });
    const before = { mode: "normal" as const, pending: "d" as const };
    const after = clearVimPending(before);
    expect(after).toEqual({ mode: "normal", pending: null });
    expect(before.pending).toBe("d");
    // An A-prefix cannot delete B's line after the host applies the boundary reset.
    const b = reduceVimEdit(
      { ...snapshot("B| draft"), ...after },
      { key: "d" },
    );
    expect(b.text).toBe("B draft");
    expect(b.pending).toBe("d");
  });
  it("uses a selection's active caret for explicit edits, never deletes the selected range", () => {
    const range = { ...snapshot("|abcde"), selectionStart: 1, selectionEnd: 4 };
    expect(
      marked(
        reduceVimEdit(
          { ...range, selectionDirection: "backward" },
          { key: "x" },
        ),
      ),
    ).toBe("a|cde");
    expect(
      marked(
        reduceVimEdit(
          { ...range, selectionDirection: "forward" },
          { key: "x" },
        ),
      ),
    ).toBe("abcd|");
    expect(
      reduceVimEdit(
        { ...range, selectionDirection: "backward" },
        { key: "c", metaKey: true },
      ),
    ).toMatchObject({
      selectionStart: 1,
      selectionEnd: 4,
      selectionDirection: "backward",
      consumed: false,
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

describe("the pinned 21-operation subset is enumerated and closed", () => {
  const reference = [
    "$",
    "0",
    "A",
    "G",
    "I",
    "O",
    "a",
    "b",
    "cc",
    "dd",
    "dw",
    "e",
    "gg",
    "h",
    "i",
    "j",
    "k",
    "l",
    "o",
    "w",
    "x",
  ];
  it("enumerates exactly the reference operations with no duplicates", () => {
    expect(VIM_NORMAL_OPERATIONS).toHaveLength(21);
    expect(new Set(VIM_NORMAL_OPERATIONS).size).toBe(21);
    expect([...VIM_NORMAL_OPERATIONS].sort()).toEqual(reference);
  });
  it.each([...VIM_NORMAL_OPERATIONS])(
    "%s is live in Normal mode (consumed, never reaching a model)",
    (operation) => {
      const state = press("a|b\ncd", Array.from(operation));
      expect(state.text.length).toBeGreaterThan(0);
    },
  );
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
  const unsupported = [
    "r",
    "y",
    "p",
    "s",
    "t",
    "f",
    "n",
    "N",
    "V",
    "C",
    "J",
    "K",
    "Y",
    "R",
    "Z",
    "m",
    "M",
    "z",
    "^",
    "%",
    "{",
    "}",
    "(",
    ")",
    "~",
    "+",
    "_",
    "-",
    "|",
    ";",
    ",",
    ".",
    "*",
    "#",
    "@",
    "<",
    ">",
    "[",
    "]",
    "'",
    "`",
    "\\",
    "?",
    "=",
    "2",
    "/",
    "中",
    "u",
    "v",
    "q",
  ];
  it.each(unsupported)(
    "unsupported Normal key %j is a no-op that never inserts text",
    (key) => {
      expect(reduceVimEdit(snapshot("a|b"), { key })).toEqual({
        text: "ab",
        selectionStart: 1,
        selectionEnd: 1,
        selectionDirection: "none",
        mode: "normal",
        pending: null,
        consumed: true,
      });
    },
  );
});
