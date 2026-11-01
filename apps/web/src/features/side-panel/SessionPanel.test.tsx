import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SessionPanel } from "./SessionPanel.tsx";

function render(automationAvailable: boolean) {
  return renderToStaticMarkup(
    createElement(SessionPanel, {
      presentation: "column" as const,
      tab: "automation" as const,
      width: 380,
      availableWidth: () => 1200,
      counts: {},
      automationAvailable,
      onTabChange: vi.fn(),
      onWidthChange: vi.fn(),
      onClose: vi.fn(),
      children: createElement("div", null, "automation-content"),
    }),
  );
}

describe("SessionPanel automation tab", () => {
  it("shows the tab only when the server advertises autonomy", () => {
    expect(render(true)).toContain(">Automation<");
    expect(render(true)).toContain("automation-content");
    expect(render(false)).not.toContain(">Automation<");
  });
});
