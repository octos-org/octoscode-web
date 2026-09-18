import type { ComponentProps, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerInput } from "./ComposerInput.tsx";

// This is an event/commit-boundary harness, not a DOM renderer. The preference
// browser suite independently checks real React textarea selection and focus.
const hooks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  cursor: 0,
  effects: [] as (() => void)[],
  vimMode: true,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    return (hooks.refs[index] ??= { current: initial });
  },
  useState: () => [0, () => {}],
  useLayoutEffect: (effect: () => void) => hooks.effects.push(effect),
}));
vi.mock("../preferences/preferences.tsx", () => ({
  usePreferences: () => ({ vimMode: hooks.vimMode }),
}));
vi.mock("../preferences/ui-text.tsx", () => ({
  useUiText: () => (text: string, params?: Record<string, string | number>) =>
    params
      ? text.replace(/\{([^{}]+)\}/g, (token: string, name: string) =>
          Object.prototype.hasOwnProperty.call(params, name)
            ? String(params[name])
            : token,
        )
      : text,
}));

type Props = Parameters<typeof ComposerInput>[0];
type TextareaProps = ComponentProps<"textarea"> & {
  "data-vim-mode": "off" | "insert" | "normal";
};
type KeyEvent = Parameters<NonNullable<TextareaProps["onKeyDown"]>>[0];

function mount(text = "alpha\nbeta") {
  const target = {
    value: text,
    selectionStart: 0,
    selectionEnd: 0,
    selectionDirection: "none" as "none" | "forward" | "backward",
    setSelectionRange: vi.fn(
      (start: number, end: number, direction = "none") => {
        target.selectionStart = Math.min(start, target.value.length);
        target.selectionEnd = Math.min(end, target.value.length);
        target.selectionDirection =
          direction as typeof target.selectionDirection;
      },
    ),
  };
  vi.stubGlobal("document", { activeElement: target });
  let proposed = text;
  let props: Props = {
    recordKey: "A",
    value: text,
    disabled: false,
    placeholder: "Composer",
    paletteId: "commands",
    commandCount: 0,
    selectedCommandId: undefined,
    onChange: vi.fn((next) => {
      proposed = next;
    }),
    onCommandMove: vi.fn(),
    onCommandDismiss: vi.fn(),
    onSubmit: vi.fn(),
    onInterrupt: vi.fn(),
  };
  let rendered: TextareaProps;
  function render(patch: Partial<Props> = {}) {
    props = { ...props, ...patch };
    hooks.cursor = 0;
    // A superseded render does not get a commit/layout phase.
    hooks.effects = [];
    const fragment = ComposerInput(props) as ReactElement<{
      children: ReactElement<TextareaProps>[];
    }>;
    rendered = fragment.props.children[0]!.props;
    hooks.refs[0]!.current = target;
  }
  function layout() {
    for (const effect of hooks.effects.splice(0)) effect();
  }
  function commit(patch: Partial<Props> = {}) {
    render({ value: proposed, ...patch });
    if (target.value !== props.value) {
      target.value = props.value;
      // Deliberately simulate a controlled write resetting native selection.
      target.setSelectionRange(target.value.length, target.value.length);
    }
    layout();
  }
  function key(key: string, modifiers: Partial<KeyEvent> = {}, flush = true) {
    const event = {
      key,
      keyCode: 0,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      defaultPrevented: false,
      nativeEvent: { isComposing: false },
      currentTarget: target,
      preventDefault: vi.fn(),
      ...modifiers,
    } as unknown as KeyEvent;
    rendered.onKeyDown!(event);
    if (flush) commit();
    return event;
  }
  render();
  layout();
  return {
    target,
    key,
    render,
    layout,
    commit,
    props: () => props,
    rendered: () => rendered,
    normal: () => key("Escape"),
    blur: () => rendered.onBlur!({} as never),
  };
}

beforeEach(() => {
  hooks.refs = [];
  hooks.effects = [];
  hooks.cursor = 0;
  hooks.vimMode = true;
});
afterEach(() => vi.unstubAllGlobals());

describe("ComposerInput event and controlled-commit ownership", () => {
  it.each([
    ["x", "a😀b", 1, "ab", 1],
    ["dd", "first\nsecond\nthird", 8, "first\nthird", 6],
    ["o", "ab\ncd", 1, "ab\n\ncd", 3],
  ] as const)(
    "restores the %s caret after a controlled text write",
    (keys, text, at, result, caret) => {
      const h = mount(text);
      h.normal();
      h.target.setSelectionRange(at, at);
      for (const key of keys) h.key(key);
      expect(h.target.value).toBe(result);
      expect(h.target.selectionStart).toBe(caret);
      expect(h.target.selectionEnd).toBe(caret);
      expect(h.props().onSubmit).not.toHaveBeenCalled();
    },
  );

  it("does not apply A's delayed caret to B, even when B has identical text", () => {
    const h = mount("same");
    h.normal();
    h.target.setSelectionRange(0, 0);
    h.key("l", {}, false);
    h.target.setSelectionRange(4, 4);
    h.render({ recordKey: "B", value: "same" });
    h.layout();
    expect(h.target.selectionStart).toBe(4);
  });

  it("does not restore a caret after blur or an unrelated controlled replacement", () => {
    const h = mount("same");
    h.normal();
    h.key("l", {}, false);
    h.blur();
    h.target.setSelectionRange(4, 4);
    h.commit();
    expect(h.target.selectionStart).toBe(4);
    h.key("h", {}, false);
    h.commit({ value: "replacement" });
    expect(h.target.selectionStart).toBe("replacement".length);
  });

  it.each(["blur", "record", "IME", "229", "Meta"])(
    "clears pending operators across %s",
    (boundary) => {
      const h = mount();
      h.normal();
      h.key("d");
      if (boundary === "blur") h.blur();
      if (boundary === "record") h.commit({ recordKey: "B" });
      if (boundary === "IME")
        h.key("Process", {
          nativeEvent: { isComposing: true } as KeyboardEvent,
        });
      if (boundary === "229") h.key("Unidentified", { keyCode: 229 });
      if (boundary === "Meta") h.key("c", { metaKey: true });
      h.key("d");
      expect(h.target.value).toBe("alpha\nbeta");
      h.key("d");
      expect(h.target.value).toBe("beta");
    },
  );

  it.each(["insert", "normal"])(
    "never dispatches IME commit Enter in %s mode",
    (mode) => {
      const h = mount();
      if (mode === "normal") h.normal();
      for (const modifiers of [
        { nativeEvent: { isComposing: true } as KeyboardEvent },
        { keyCode: 229 },
      ]) {
        const event = h.key("Enter", modifiers);
        expect(event.preventDefault).not.toHaveBeenCalled();
      }
      expect(h.props().onSubmit).not.toHaveBeenCalled();
      expect(h.props().onInterrupt).not.toHaveBeenCalled();
    },
  );

  it("keeps Insert Escape and pending Escape local, then forwards bare Normal Escape", () => {
    const h = mount();
    h.normal();
    expect(h.rendered()["data-vim-mode"]).toBe("normal");
    h.key("d");
    h.key("Escape");
    expect(h.props().onInterrupt).not.toHaveBeenCalled();
    h.key("Escape");
    expect(h.props().onInterrupt).toHaveBeenCalledTimes(1);
    h.key("Enter");
    expect(h.props().onSubmit).toHaveBeenCalledTimes(1);
  });

  it.each(["ctrlKey", "metaKey", "altKey"] as const)(
    "never interrupts or consumes %s Escape",
    (modifier) => {
      const h = mount();
      h.normal();
      const event = h.key("Escape", { [modifier]: true });
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(h.props().onInterrupt).not.toHaveBeenCalled();
    },
  );

  it("gives command-palette navigation and dismissal priority over Vim", () => {
    const h = mount();
    h.commit({ commandCount: 2, selectedCommandId: "commands-theme" });
    h.key("Escape");
    expect(h.props().onCommandDismiss).toHaveBeenCalledTimes(1);
    expect(h.rendered()["data-vim-mode"]).toBe("insert");
    h.key("ArrowDown");
    h.key("ArrowUp");
    expect(h.props().onCommandMove).toHaveBeenNthCalledWith(1, 1);
    expect(h.props().onCommandMove).toHaveBeenNthCalledWith(2, -1);
    expect(h.props().onInterrupt).not.toHaveBeenCalled();
    expect(h.rendered()["aria-controls"]).toBe("commands");
    expect(h.rendered()["aria-activedescendant"]).toBe("commands-theme");
  });

  it.each(["ctrlKey", "metaKey", "altKey"] as const)(
    "preserves %s Escape/arrows while the command palette is open",
    (modifier) => {
      const h = mount();
      h.normal();
      h.commit({ commandCount: 2, selectedCommandId: "commands-theme" });
      for (const key of ["Escape", "ArrowUp", "ArrowDown"]) {
        const event = h.key(key, { [modifier]: true });
        expect(event.preventDefault).not.toHaveBeenCalled();
      }
      expect(h.props().onCommandDismiss).not.toHaveBeenCalled();
      expect(h.props().onCommandMove).not.toHaveBeenCalled();
      expect(h.props().onInterrupt).not.toHaveBeenCalled();
      expect(h.props().onChange).not.toHaveBeenCalledWith("");
    },
  );

  it("resets to Insert after toggling off and back on", () => {
    const h = mount();
    h.normal();
    h.key("d");
    hooks.vimMode = false;
    h.commit();
    expect(h.rendered()["data-vim-mode"]).toBe("off");
    hooks.vimMode = true;
    h.commit();
    expect(h.rendered()["data-vim-mode"]).toBe("insert");
    h.normal();
    h.key("d");
    expect(h.target.value).toBe("alpha\nbeta");
  });

  it("ignores already-owned and unfocused events", () => {
    const h = mount();
    h.key("Enter", { defaultPrevented: true });
    vi.stubGlobal("document", { activeElement: null });
    h.key("Enter");
    h.key("Escape");
    expect(h.props().onSubmit).not.toHaveBeenCalled();
    expect(h.props().onInterrupt).not.toHaveBeenCalled();
    expect(h.rendered()["data-vim-mode"]).toBe("insert");
  });
});

const PEER_ROSTER = [
  { identity: "dev:local:tui#peer-review", slug: "review" },
] as const;

type SurfaceChild = ReactElement<TextareaProps & { children?: unknown }>;

function surface(patch: Partial<Props> = {}) {
  hooks.refs = [];
  hooks.cursor = 0;
  hooks.effects = [];
  vi.stubGlobal("document", { activeElement: null });
  const base: Props = {
    recordKey: "A",
    value: "",
    disabled: false,
    placeholder: "Composer",
    paletteId: "commands",
    commandCount: 0,
    selectedCommandId: undefined,
    onChange: vi.fn(),
    onCommandMove: vi.fn(),
    onCommandDismiss: vi.fn(),
    onSubmit: vi.fn(),
    onInterrupt: vi.fn(),
    ...patch,
  };
  const fragment = ComposerInput(base) as ReactElement<{
    children: (SurfaceChild | null)[];
  }>;
  const [textarea, hint] = fragment.props.children;
  return { textarea: textarea!.props, hint };
}

describe("read-only peer composer surface (audit row 7)", () => {
  it("disables the textarea and names the peer when the focused id is in the roster", () => {
    const { textarea, hint } = surface({
      peerRoster: PEER_ROSTER,
      peerSessionId: "dev:local:tui#peer-review",
    });
    expect(textarea.disabled).toBe(true);
    expect(hint?.props.role).toBe("status");
    expect(hint?.props.children).toContain("review");
  });

  it("keeps the composer editable for an ordinary focused session", () => {
    const { textarea, hint } = surface({
      peerRoster: PEER_ROSTER,
      peerSessionId: "dev:local:tui#ordinary",
    });
    expect(textarea.disabled).toBe(false);
    expect(hint).toBeNull();
  });

  it("stays editable with no roster or no focus", () => {
    expect(
      surface({ peerSessionId: "dev:local:tui#peer-review" }).textarea.disabled,
    ).toBe(false);
    expect(
      surface({ peerRoster: PEER_ROSTER, peerSessionId: null }).textarea
        .disabled,
    ).toBe(false);
  });
});

// a11y review 0800 §1 DEFECT (:92/:212): disabling a FOCUSED textarea drops
// focus to <body>. The status row (refs[1] — refs order: textarea, statusRow,
// hadFocus, peerReadOnly, mode, selection) is the controlled landing.
const PEER_PATCH = {
  peerRoster: PEER_ROSTER,
  peerSessionId: "dev:local:tui#peer-review",
} as const;

function mountWithStatusRow() {
  const focus = vi.fn();
  const h = mount();
  h.render();
  hooks.refs[1]!.current = { focus };
  return { h, focus };
}

describe("read-only peer focus edge (a11y review 0800 §1)", () => {
  it("moves focus to the status row when a FOCUSED textarea flips to peer-readonly", () => {
    const { h, focus } = mountWithStatusRow();
    h.rendered().onFocus!({} as never);
    h.commit(PEER_PATCH);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("leaves focus alone when the composer was not focused at the flip", () => {
    const { h, focus } = mountWithStatusRow();
    vi.stubGlobal("document", { activeElement: null });
    h.commit(PEER_PATCH);
    expect(focus).not.toHaveBeenCalled();
  });

  it("fires on the null→non-null edge only, not on every render while read-only", () => {
    const { h, focus } = mountWithStatusRow();
    h.rendered().onFocus!({} as never);
    h.commit(PEER_PATCH);
    h.commit(PEER_PATCH);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("lands focus on a tabIndex=-1 status row so the move is legal", () => {
    const { hint } = surface(PEER_PATCH);
    expect(hint?.props.role).toBe("status");
    expect(hint?.props.tabIndex).toBe(-1);
  });
});
