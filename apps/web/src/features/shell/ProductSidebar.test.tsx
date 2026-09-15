import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProductSidebar, type ProductSidebarProps } from "./ProductSidebar.tsx";

const baseProps: ProductSidebarProps = {
  collapsed: false,
  selectedSessionId: "session-ship",
  workspaces: [
    {
      id: "workspace-web",
      label: "octoscode-web",
      path: "/srv/octoscode-web",
      expanded: true,
      sessions: [
        {
          id: "session-ship",
          title: "Ship the product shell",
          updatedAt: "2026-08-27T00:01:00Z",
          updatedLabel: "now",
          status: "running",
        },
        {
          id: "session-review",
          title: "Review the sidebar",
          updatedAt: "2026-08-27T00:02:00Z",
          updatedLabel: "4min",
          status: "waiting",
          statusLabel: "Waiting for approval",
        },
      ],
    },
  ],
  onCollapsedChange: vi.fn(),
  onNewSession: vi.fn(),
  onAddWorkspace: vi.fn(),
  onViewModeChange: vi.fn(),
  onOrderModeChange: vi.fn(),
  onWorkspaceExpandedChange: vi.fn(),
  onSessionSelect: vi.fn(),
  onSettings: vi.fn(),
};

describe("ProductSidebar", () => {
  it("removes every Session creation affordance when the coding baseline is unavailable", () => {
    const html = renderToStaticMarkup(
      <ProductSidebar {...baseProps} sessionCreationAvailable={false} />,
    );

    expect(html).toContain("Octoscode");
    expect(html).not.toContain("New Session");
    expect(html).not.toContain('aria-label="New session"');
    expect(html).not.toContain("New session in octoscode-web");
    expect(html).not.toContain('aria-label="Add workspace"');
  });

  it("does not present a browser recent as an authoritative empty catalog", () => {
    const html = renderToStaticMarkup(
      <ProductSidebar
        {...baseProps}
        selectedSessionId={null}
        workspaces={[
          {
            id: "workspace-recent",
            label: "recent-only",
            sessionCatalogStatus: "unknown",
            sessions: [],
          },
        ]}
      />,
    );

    expect(html).toContain("Expand to load sessions.");
    expect(html).not.toContain("No sessions yet.");
  });

  it("presents the fail-closed current-session view as limited, never complete", () => {
    const grouped = renderToStaticMarkup(
      <ProductSidebar
        {...baseProps}
        selectedSessionId="open-session"
        workspaces={[
          {
            id: "workspace-open",
            label: "open-workspace",
            sessionCatalogStatus: "current-only",
            sessions: [{ id: "open-session", title: "Open session" }],
          },
          {
            id: "workspace-recent",
            label: "recent-workspace",
            sessionCatalogStatus: "current-only",
            sessions: [],
          },
        ]}
      />,
    );

    expect(grouped).toContain("Only the open session is shown.");
    expect(grouped).toContain("Start a session to open this workspace.");
    expect(grouped).not.toContain("No sessions yet.");

    const flat = renderToStaticMarkup(
      <ProductSidebar
        {...baseProps}
        viewMode="flat"
        selectedSessionId="open-session"
        workspaces={[
          {
            id: "workspace-open",
            label: "open-workspace",
            sessionCatalogStatus: "current-only",
            sessions: [{ id: "open-session", title: "Open session" }],
          },
        ]}
      />,
    );
    expect(flat).toContain("Showing sessions confirmed in this tab.");
  });

  it("renders tab-known Sessions without claiming they are a server catalog", () => {
    const grouped = renderToStaticMarkup(
      <ProductSidebar
        {...baseProps}
        selectedSessionId="known-a"
        workspaces={[
          {
            id: "workspace-known",
            label: "known-workspace",
            sessionCatalogStatus: "known-only",
            sessions: [
              { id: "known-a", title: "Session a1b2c3" },
              { id: "known-b", title: "Session d4e5f6" },
            ],
          },
        ]}
      />,
    );

    expect(grouped).toContain("Session a1b2c3");
    expect(grouped).toContain("Session d4e5f6");
    expect(grouped).not.toContain("Only the open session is shown.");
    expect(grouped).not.toContain("No sessions yet.");
  });

  it("does not claim an incomplete flat catalog has no sessions", () => {
    const html = renderToStaticMarkup(
      <ProductSidebar
        {...baseProps}
        viewMode="flat"
        selectedSessionId={null}
        workspaces={[
          {
            id: "workspace-loading",
            label: "loading",
            sessionCatalogStatus: "loading",
            sessions: [],
          },
          {
            id: "workspace-error",
            label: "error",
            sessionCatalogStatus: "error",
            sessionCatalogError: "rejected",
            sessions: [],
          },
        ]}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain("Sessions are still loading.");
    expect(html).toContain("1 workspace pending.");
    expect(html).toContain("1 workspace could not be loaded.");
    expect(html).toContain("Retry");
    expect(html).not.toContain("No sessions yet.");
    expect(html).not.toContain("No sessions found.");
  });

  it.each([
    ["grouped", "updated"],
    ["grouped", "oldest"],
    ["flat", "updated"],
    ["flat", "oldest"],
  ] as const)(
    "sorts %s sessions by %s with stable ties and missing times last",
    (viewMode, orderMode) => {
      const html = renderToStaticMarkup(
        <ProductSidebar
          {...baseProps}
          viewMode={viewMode}
          orderMode={orderMode}
          workspaces={[
            {
              id: "sort-workspace",
              label: "Sort workspace",
              expanded: true,
              sessions: [
                { id: "missing", title: "Missing timestamp" },
                { id: "newer", title: "Newer session", updatedAt: 200 },
                { id: "older", title: "Older session", updatedAt: 100 },
                { id: "tie", title: "Tied session", updatedAt: 100 },
                {
                  id: "invalid",
                  title: "Invalid timestamp",
                  updatedAt: "invalid",
                },
              ],
            },
          ]}
        />,
      );
      const titles = [
        ...(orderMode === "oldest"
          ? ["Older session", "Tied session", "Newer session"]
          : ["Newer session", "Older session", "Tied session"]),
        "Missing timestamp",
        "Invalid timestamp",
      ];
      const positions = titles.map((title) => html.indexOf(title));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual(
        [...positions].sort((left, right) => left - right),
      );
    },
  );
});
