import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SessionStatusStrip } from "./SessionStatusStrip.tsx";
import { stripStateWords } from "./SessionStatusStrip.tsx";

describe("SessionStatusStrip live activity word", () => {
  it("shows the animated activity label as the third segment while responding", () => {
    const html = renderToStaticMarkup(
      <SessionStatusStrip
        model="glm-5.3"
        permissionMode="Workspace write"
        state={{ kind: "responding" }}
        activity={{
          label: "Running shell…",
          startedAtMs: 0,
          lastAtMs: 1_000,
        }}
        onOpenPane={() => {}}
      />,
    );
    expect(html).toContain("glm-5.3 · Workspace write · Running shell…");
    expect(html).toMatch(/[Tt]hinking.?[Ss]pinner/);
  });

  it("keeps the plain state word when no live activity", () => {
    const html = renderToStaticMarkup(
      <SessionStatusStrip
        model="glm-5.3"
        permissionMode="Workspace write"
        state={{ kind: "responding" }}
        activity={null}
        onOpenPane={() => {}}
      />,
    );
    expect(html).toContain("glm-5.3 · Workspace write · Responding");
  });

  it("pure word mapping keeps existing vocabulary untouched", () => {
    const t = (source: string) => source;
    expect(stripStateWords({ kind: "ready" }, t)).toBe("Ready");
    expect(stripStateWords({ kind: "reconnecting" }, t)).toBe("Reconnecting");
  });

  it("does not mutate strip behavior for non-responding states", () => {
    const onOpenPane = vi.fn();
    const html = renderToStaticMarkup(
      <SessionStatusStrip
        model={null}
        permissionMode={null}
        state={{ kind: "waiting-approval" }}
        activity={{ label: "Thinking…", startedAtMs: 0, lastAtMs: 1 }}
        onOpenPane={onOpenPane}
      />,
    );
    expect(html).toContain("Waiting for your approval");
  });
});
