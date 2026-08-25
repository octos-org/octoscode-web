import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PermissionPanel } from "./PermissionPanel.tsx";

describe("PermissionPanel", () => {
  it("renders server-confirmed state and disables unadvertised profiles", () => {
    const html = renderToStaticMarkup(
      <PermissionPanel
        connected
        state={{
          available: true,
          editable: true,
          loading: false,
          busy: false,
          error: null,
          result: {
            session_id: "s1",
            current: { mode: "workspace_write", network: "deny" },
            profiles: [
              { mode: "read_only", network: "deny" },
              { mode: "workspace_write", network: "deny" },
            ],
          },
        }}
        onUpdate={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Workspace write" aria-pressed="true"');
    expect(html).toContain(
      'aria-label="Full access" aria-pressed="false" disabled=""',
    );
    expect(html).toContain("Session scoped");
  });

  it("makes a missing capability explicit without exposing controls", () => {
    const html = renderToStaticMarkup(
      <PermissionPanel
        connected
        state={{
          available: false,
          editable: false,
          loading: false,
          busy: false,
          error: null,
          result: null,
        }}
        onUpdate={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("Full access");
  });
});
