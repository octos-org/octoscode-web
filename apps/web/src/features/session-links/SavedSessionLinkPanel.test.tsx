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
  it("previews the destination without opening a session or claiming recovery", () => {
    const options = props();
    const html = renderToStaticMarkup(<SavedSessionLinkPanel {...options} />);
    expect(options.onOpen).not.toHaveBeenCalled();
    expect(html).toContain("Open saved conversation");
    expect(html).toContain("https://octos.example");
    expect(html).toContain("/srv/projects/app");
    expect(html).toContain("server may open an empty session");
    expect(html).toContain("Opening the link does not send a message");
    expect(html).toContain("Conversation details</summary>");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Open conversation</button>");
    expect(html).toContain("Dismiss link</button>");
    expect(html).not.toMatch(/restored|recovered successfully/i);
  });

  it("keeps the pending open visible and prevents conflicting choices", () => {
    const html = renderToStaticMarkup(
      <SavedSessionLinkPanel {...props()} opening />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Opening conversation…");
    expect(html).toContain('role="status"');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("renders a retriable error and treats reference values as text", () => {
    const options = props();
    options.reference.workspaceRoot = "/srv/<img src=x onerror=alert(1)>";
    const html = renderToStaticMarkup(
      <SavedSessionLinkPanel
        {...options}
        error="Could not open this session."
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not open this session.");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain('disabled=""');
  });
});
