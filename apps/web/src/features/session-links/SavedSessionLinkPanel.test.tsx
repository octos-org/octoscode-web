import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  SavedSessionLinkPanel,
  type SavedSessionLinkPanelProps,
} from "./SavedSessionLinkPanel.tsx";

function props(): SavedSessionLinkPanelProps {
  return {
    reference: {
      workspaceRoot: "/srv/projects/app",
      profileId: "developer",
      sessionId: "developer:api:web-123",
    },
    serverOrigin: "https://octos.example",
    onOpen: vi.fn(),
    onDismiss: vi.fn(),
  };
}

describe("SavedSessionLinkPanel", () => {
  it("keeps the pending open visible and prevents conflicting choices", () => {
    const html = renderToStaticMarkup(
      <SavedSessionLinkPanel {...props()} opening />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Opening conversation…");
    expect(html).toContain('role="status"');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
