import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ProductSidebar,
  ProductSidebarViewOptionsMenu,
  type ProductSidebarProps,
} from "./ProductSidebar.tsx";
import type { PeerRosterEntry } from "../peers/peer-manager.ts";

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

  it("renders accessible grouping choices from the controlled view mode", () => {
    const onViewModeChange = vi.fn();
    const onSelectComplete = vi.fn();
    const props = {
      viewMode: "grouped" as const,
      orderMode: "manual" as const,
      onViewModeChange,
      onOrderModeChange: vi.fn(),
      onSelectComplete,
    };
    const html = renderToStaticMarkup(
      <div role="menu">
        <ProductSidebarViewOptionsMenu {...props} />
      </div>,
    );

    expect(html).toContain('role="menuitemradio"');
    expect(html).toContain('aria-label="Group sessions by"');
    expect(html).toContain("Workspace");
    expect(html).toContain("In one list");
    expect(html).not.toContain("Order by");

    const flat = renderToStaticMarkup(
      <ProductSidebarViewOptionsMenu {...props} viewMode="flat" />,
    );
    expect(html).toMatch(/aria-checked="true"[^>]*><span>Workspace<\/span>/);
    expect(html).toMatch(/aria-checked="false"[^>]*><span>In one list<\/span>/);
    expect(flat).toMatch(/aria-checked="false"[^>]*><span>Workspace<\/span>/);
    expect(flat).toMatch(/aria-checked="true"[^>]*><span>In one list<\/span>/);
    expect(onViewModeChange).not.toHaveBeenCalled();
    expect(onSelectComplete).not.toHaveBeenCalled();
  });
});

describe("ProductSidebar peer dock mount (dock plan §1)", () => {
  const rosterEntry = (
    overrides: Partial<PeerRosterEntry> = {},
  ): PeerRosterEntry => ({
    identity: "dev:local:tui#peer-review",
    profileId: "dev",
    topic: "peer-review",
    slug: "review",
    cwd: "/srv/octoscode-web",
    briefPath: "/briefs/review.md",
    origin: "staged",
    turnId: "turn-1",
    status: "started",
    activity: "live",
    openedAt: 1,
    finishedAt: null,
    error: null,
    canRetry: false,
    ...overrides,
  });

  const managerWith = (peers: readonly PeerRosterEntry[]) => {
    const snapshot = {
      peers,
      blackboard: [] as const,
      prepareBusy: false,
      gatherBusy: false,
      prepareError: null,
      gatherError: null,
      prepareUncertain: false,
      dispatchRefusalKind: null,
    };
    return {
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
    };
  };

  it("omits the peer dock until a manager is mounted", () => {
    const html = renderToStaticMarkup(<ProductSidebar {...baseProps} />);

    expect(html).not.toContain('aria-label="Peers"');
    expect(html).not.toContain("Hide peers");
  });

  it("mounts the dock between the session tree and Settings", () => {
    const html = renderToStaticMarkup(
      <ProductSidebar {...baseProps} peerDock={managerWith([rosterEntry()])} />,
    );

    const tree = html.indexOf('role="tree"');
    const dock = html.indexOf('aria-label="Peers"');
    const settings = html.indexOf('aria-label="Settings"');
    expect(tree).toBeGreaterThanOrEqual(0);
    expect(dock).toBeGreaterThan(tree);
    expect(settings).toBeGreaterThan(dock);
    // Triage 4510 P2: the row body shows "Peer N · model", never the raw slug
    // (the slug survives only as the data-peer-slug diagnostic attribute).
    expect(html).toContain(">Peer 1<");
    expect(html).toContain('data-peer-slug="review"');
    expect(html).toContain(">started<");
  });

  it("renders no dock while the roster is empty", () => {
    const html = renderToStaticMarkup(
      <ProductSidebar {...baseProps} peerDock={managerWith([])} />,
    );

    expect(html).not.toContain('aria-label="Peers"');
  });

  it("threads onApprovalRespond through to the dock (web gap 6)", () => {
    const blocked = rosterEntry({
      identity: "dev:local:tui#peer-approve",
      slug: "approve",
      activity: "blocked",
      requestId: "req-1",
      requestKind: "approval",
    });
    const html = renderToStaticMarkup(
      <ProductSidebar
        {...baseProps}
        peerDock={managerWith([blocked])}
        onApprovalRespond={vi.fn()}
      />,
    );

    expect(html).toContain('data-row-action="approve"');
    expect(html).toContain('data-row-action="deny"');
  });

  it("omits the dock's row actions when no handler is threaded (web gap 6)", () => {
    const blocked = rosterEntry({
      identity: "dev:local:tui#peer-approve",
      slug: "approve",
      activity: "blocked",
      requestId: "req-1",
      requestKind: "approval",
    });
    const html = renderToStaticMarkup(
      <ProductSidebar {...baseProps} peerDock={managerWith([blocked])} />,
    );

    expect(html).not.toContain("data-row-action=");
  });
});
