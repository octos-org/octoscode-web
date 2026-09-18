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
    expect(html).toMatch(/<button[^>]*aria-label="Session settings"/);
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
});
