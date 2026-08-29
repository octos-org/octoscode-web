import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  NewSessionWorkspacePicker,
  workspaceCreateRequest,
  type RecentWorkspacePath,
} from "./NewSessionWorkspacePicker.tsx";

const workspaces: readonly RecentWorkspacePath[] = [
  {
    id: "workspace-private-identifier",
    name: "octoscode-web",
    path: "/srv/projects/octoscode-web",
  },
  {
    id: "workspace-second-identifier",
    name: "octos-core",
    path: "/srv/projects/octos-core",
  },
];

describe("NewSessionWorkspacePicker", () => {
  it("chooses a known workspace using only its server path", () => {
    const onCreate = vi.fn();
    const request = workspaceCreateRequest(workspaces[0]!.path);

    expect(request).toEqual({ workspacePath: "/srv/projects/octoscode-web" });
    if (request) onCreate(request);
    expect(onCreate).toHaveBeenCalledWith({
      workspacePath: "/srv/projects/octoscode-web",
    });
  });

  it("normalizes an added server path and rejects an empty draft", () => {
    expect(workspaceCreateRequest("  /opt/repos/new-workspace  ")).toEqual({
      workspacePath: "/opt/repos/new-workspace",
    });
    expect(workspaceCreateRequest("   ")).toBeNull();

    const html = renderToStaticMarkup(
      <NewSessionWorkspacePicker
        presentation="hero"
        initialView="add"
        workspaces={workspaces}
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(html).toContain("Server workspace path");
    expect(html).toContain("a path on the Octos server");
    expect(html).not.toMatch(/directory picker|Choose folder|Browse/);
  });

  it("shows selected and recent Workspaces without exposing protocol ids", () => {
    const html = renderToStaticMarkup(
      <NewSessionWorkspacePicker
        presentation="hero"
        workspaces={workspaces}
        selectedWorkspaceId="workspace-private-identifier"
        recentWorkspaceId="workspace-second-identifier"
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    expect(html).toContain("octoscode-web");
    expect(html).toContain("/srv/projects/octoscode-web");
    expect(html).toContain("Current");
    expect(html).toContain("Recent");
    expect(html).not.toContain("workspace-private-identifier");
    expect(html).not.toContain("workspace-second-identifier");
    expect(html).not.toMatch(/Session id|Profile id/i);
  });

  it("renders bounded loading, error, and empty states with Cancel", () => {
    const loading = renderToStaticMarkup(
      <NewSessionWorkspacePicker
        presentation="hero"
        workspaces={[]}
        loading
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(loading).toContain('role="status"');
    expect(loading).toContain("Loading recent workspace paths");
    expect(loading).toContain("Cancel");

    const error = renderToStaticMarkup(
      <NewSessionWorkspacePicker
        presentation="hero"
        workspaces={[]}
        error="Could not load workspaces."
        onRetry={vi.fn()}
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(error).toContain('role="alert"');
    expect(error).toContain("Could not load workspaces.");
    expect(error).toContain("Retry");

    const empty = renderToStaticMarkup(
      <NewSessionWorkspacePicker
        presentation="hero"
        workspaces={[]}
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(empty).toContain("No recent workspace paths");
    expect(empty).toContain("Add workspace");
    expect(empty.match(/data-octopus-logo=""/g)).toHaveLength(2);
  });
});
