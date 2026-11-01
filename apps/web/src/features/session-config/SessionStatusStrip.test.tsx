import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionStatusStrip } from "./SessionStatusStrip.tsx";

describe("SessionStatusStrip (§4.1)", () => {
  it("renders the one-line model · permission · state summary", () => {
    const html = renderToStaticMarkup(
      <SessionStatusStrip
        model="glm-5.3"
        permissionMode="Workspace write"
        state={{ kind: "ready" }}
        onOpenPane={() => {}}
      />,
    );
    expect(html).toContain("glm-5.3 · Workspace write · Ready");
    expect(html).toContain('data-testid="session-status-strip"');
  });

  it("is one native button named Session settings with a visible chevron", () => {
    const html = renderToStaticMarkup(
      <SessionStatusStrip
        model="glm-5.3"
        permissionMode="Workspace write"
        state={{ kind: "ready" }}
        onOpenPane={() => {}}
      />,
    );
    expect(html).toMatch(
      /<button[^>]*aria-label="Session settings: glm-5\.3 · Workspace write · Ready"/,
    );
    expect(html).toContain("session-status-strip-chevron");
    expect(html).toContain("Model, permissions, sandbox");
  });

  it.each([
    ["waiting-approval", "Waiting for your approval"],
    ["waiting-answer", "Waiting for your answer"],
    ["responding", "Responding"],
    ["external-held", "Another app is using this session"],
    ["busy-elsewhere", "Another client is working in this session"],
    ["reconnecting", "Reconnecting"],
  ] as const)("maps %s to its task word", (kind, words) => {
    const html = renderToStaticMarkup(
      <SessionStatusStrip
        model="glm-5.3"
        permissionMode="Workspace write"
        state={{ kind }}
        onOpenPane={() => {}}
      />,
    );
    expect(html).toContain(words);
  });

  it("renders the peers-running count in words", () => {
    const html = renderToStaticMarkup(
      <SessionStatusStrip
        model="glm-5.3"
        permissionMode="Workspace write"
        state={{ kind: "peers-running", count: 3 }}
        onOpenPane={() => {}}
      />,
    );
    expect(html).toContain("Peers running (3)");
  });

  describe("compact (the composer's form, 美-9)", () => {
    const render = (
      state: Parameters<typeof SessionStatusStrip>[0]["state"],
      activity: Parameters<typeof SessionStatusStrip>[0]["activity"] = null,
    ) =>
      renderToStaticMarkup(
        <SessionStatusStrip
          compact
          model="glm-5.3"
          permissionMode="Workspace write"
          state={state}
          activity={activity}
          onOpenPane={() => {}}
        />,
      );
    const visibleWords = (html: string) =>
      /session-status-strip-state[^"]*">([^<]*)</.exec(html)?.[1] ?? null;

    it("is an icon when ready: no word, no chevron, the state in its name and tooltip", () => {
      const html = render({ kind: "ready" });
      expect(visibleWords(html)).toBeNull();
      expect(html).not.toContain("session-status-strip-chevron");
      expect(html).not.toContain("thinking-spinner");
      expect(html).toMatch(
        /aria-label="Session settings: glm-5\.3 · Workspace write · Ready"/,
      );
      expect(html).toContain('title="Session settings: Ready"');
    });

    it("leaves live progress to the conversation", () => {
      const html = render(
        { kind: "responding" },
        { label: "Thinking…", startedAtMs: 0, lastAtMs: 0 },
      );
      expect(visibleWords(html)).toBeNull();
      expect(html).not.toContain("thinking-spinner");
      expect(html).toContain(
        "Session settings: glm-5.3 · Workspace write · Thinking…",
      );
    });

    it.each([
      [{ kind: "waiting-approval" }, "Waiting for your approval"],
      [{ kind: "waiting-answer" }, "Waiting for your answer"],
      [{ kind: "reconnecting" }, "Reconnecting"],
      [{ kind: "external-held" }, "Another app is using this session"],
      [{ kind: "peers-running", count: 2 }, "Peers running (2)"],
    ] as const)("shows words when %o needs the user", (state, words) => {
      expect(visibleWords(render(state))).toBe(words);
    });
  });
});
