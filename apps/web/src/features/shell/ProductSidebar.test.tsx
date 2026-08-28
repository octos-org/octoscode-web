import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ProductSidebar,
  ProductSidebarViewOptionsMenu,
  type ProductSidebarProps,
} from "./ProductSidebar.tsx";

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
  it("keeps the DSH product information architecture and product-only copy", () => {
    const html = renderToStaticMarkup(<ProductSidebar {...baseProps} />);

    expect(html.indexOf("Octoscode")).toBeLessThan(html.indexOf("New Session"));
    expect(html.indexOf("New Session")).toBeLessThan(
      html.indexOf("Workspaces"),
    );
    expect(html.indexOf("Workspaces")).toBeLessThan(
      html.indexOf("octoscode-web"),
    );
    expect(html.indexOf("octoscode-web")).toBeLessThan(
      html.indexOf("Ship the product shell"),
    );
    expect(html.indexOf("Ship the product shell")).toBeLessThan(
      html.indexOf("Settings"),
    );

    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-status="running"');
    expect(html).toContain("Waiting for approval");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toMatch(
      /Runtime|Connection|Permissions|Boundary|Session files|Activity/,
    );
  });

  it("renders the compact rail without leaking the expanded tree", () => {
    const html = renderToStaticMarkup(
      <ProductSidebar {...baseProps} collapsed />,
    );

    expect(html).toContain('aria-label="Expand sidebar"');
    expect(html).toContain('aria-label="New session"');
    expect(html).toContain('aria-label="Search sessions"');
    expect(html).toContain('aria-label="Add workspace"');
    expect(html).toContain('aria-label="Settings"');
    expect(html).not.toContain("Ship the product shell");
    expect(html).not.toContain(">Workspaces<");
  });

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

  it("shows bounded empty, loading, and recoverable error states", () => {
    const empty = renderToStaticMarkup(
      <ProductSidebar
        {...baseProps}
        workspaces={[]}
        selectedSessionId={null}
      />,
    );
    expect(empty).toContain("No workspaces yet.");

    const loading = renderToStaticMarkup(
      <ProductSidebar
        {...baseProps}
        workspaces={[]}
        selectedSessionId={null}
        loading
      />,
    );
    expect(loading).toContain('aria-label="Loading workspaces"');

    const error = renderToStaticMarkup(
      <ProductSidebar
        {...baseProps}
        workspaces={[]}
        selectedSessionId={null}
        error="Could not load workspaces."
        onRetry={vi.fn()}
      />,
    );
    expect(error).toContain('role="alert"');
    expect(error).toContain("Could not load workspaces.");
    expect(error).toContain("Retry");
    expect(error).not.toContain("No workspaces yet.");
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

  it("caps long workspace groups while always retaining the selected row", () => {
    const sessions = Array.from({ length: 7 }, (_, index) => ({
      id: `session-${index}`,
      title: `Session ${index}`,
    }));
    const html = renderToStaticMarkup(
      <ProductSidebar
        {...baseProps}
        selectedSessionId="session-6"
        workspaces={[
          {
            id: "workspace-many",
            label: "Many sessions",
            expanded: true,
            sessions,
          },
        ]}
      />,
    );

    expect(html).toContain("Session 6");
    expect(html).not.toContain("Show 2 more");
  });

  it("renders a single status-preserving list in Last updated order", () => {
    const html = renderToStaticMarkup(
      <ProductSidebar
        {...baseProps}
        viewMode="flat"
        orderMode="updated"
        selectedSessionId="session-review"
      />,
    );

    expect(html).toContain(">Sessions<");
    expect(html).not.toContain(">Workspaces<");
    expect(html).not.toContain("octoscode-web");
    expect(html.indexOf("Review the sidebar")).toBeLessThan(
      html.indexOf("Ship the product shell"),
    );
    expect(html).toContain('data-status="waiting"');
    expect(html).toContain('aria-current="page"');
  });

  it("exposes accessible grouping choices and dispatches the controlled change", () => {
    const onViewModeChange = vi.fn();
    const onSelectComplete = vi.fn();
    const props = {
      viewMode: "grouped" as const,
      orderMode: "manual" as const,
      onViewModeChange,
      onOrderModeChange: vi.fn(),
      onSelectComplete,
    };
    const menu = ProductSidebarViewOptionsMenu(props);
    const html = renderToStaticMarkup(<div role="menu">{menu}</div>);

    expect(html).toContain('role="menuitemradio"');
    expect(html).toContain('aria-label="Group sessions by"');
    expect(html).toContain("Workspace");
    expect(html).toContain("In one list");
    expect(html).not.toContain("Order by");

    findButton(menu, "In one list").props.onClick();
    expect(onViewModeChange).toHaveBeenCalledWith("flat");
    expect(onSelectComplete).toHaveBeenCalledTimes(1);
  });
});

function findButton(
  node: ReactNode,
  label: string,
): ReactElement<{ children?: ReactNode; onClick: () => void }> {
  let match: ReactElement<{
    children?: ReactNode;
    onClick: () => void;
  }> | null = null;

  const visit = (candidate: ReactNode): void => {
    if (match || !isValidElement(candidate)) return;
    const element = candidate as ReactElement<{
      children?: ReactNode;
      onClick?: () => void;
    }>;
    if (
      element.type === "button" &&
      Children.toArray(element.props.children).map(textContent).join("") ===
        label &&
      element.props.onClick
    ) {
      match = element as ReactElement<{
        children?: ReactNode;
        onClick: () => void;
      }>;
      return;
    }
    Children.forEach(element.props.children, visit);
  };

  visit(node);
  if (!match) throw new Error(`Could not find button: ${label}`);
  return match;
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (!isValidElement(node)) return "";
  const element = node as ReactElement<{ children?: ReactNode }>;
  return Children.toArray(element.props.children).map(textContent).join("");
}
