import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NewSessionWorkspacePicker,
  serverWorkingDirectoryEntry,
  workspaceCreateRequest,
} from "./NewSessionWorkspacePicker.tsx";

describe("§5.1 Server's working directory entry", () => {
  it("labels the first entry from opened.workspace_root", () => {
    const entry = serverWorkingDirectoryEntry("/srv/project", true);
    expect(entry.label).toBe("Server's working directory");
    expect(entry.path).toBe("/srv/project");
    expect(entry.order).toBe("first");
  });

  it("falls back to 'path not reported' when workspace_root is absent", () => {
    const entry = serverWorkingDirectoryEntry(null, false);
    expect(entry.label).toBe("Server's working directory (path not reported)");
    expect(entry.requiresExplicitPath).toBe(true);
  });

  it("renders as the first row above remembered projects", () => {
    const html = renderToStaticMarkup(
      <NewSessionWorkspacePicker
        open
        workspaces={[
          { id: "w1", name: "proj-a", path: "/srv/a" },
          { id: "w2", name: "proj-b", path: "/srv/b" },
        ]}
        serverWorkingDirectory={{
          label: "Server&#x27;s working directory",
          path: "/srv/project",
        }}
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    const firstPos = html.indexOf('data-workspace-entry="server-working-directory"');
    const rememberedPos = html.indexOf("proj-a");
    expect(firstPos).toBeGreaterThan(-1);
    expect(firstPos).toBeLessThan(rememberedPos);
  });

  it("shows the (path not reported) variant in the list", () => {
    const html = renderToStaticMarkup(
      <NewSessionWorkspacePicker
        open
        workspaces={[]}
        serverWorkingDirectory={{
          label: "Server&#x27;s working directory (path not reported)",
          path: null,
        }}
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(html).toContain("(path not reported)");
    expect(html).toMatch(/disabled=""/);
  });
});

describe("§5.1 path validation copy stays verbatim", () => {
  it("keeps a workspaceCreateRequest a pure normalization", () => {
    expect(workspaceCreateRequest("  /srv/x  ")).toEqual({
      workspacePath: "/srv/x",
    });
    expect(workspaceCreateRequest("   ")).toBeNull();
  });

  it("surfaces a server rejection verbatim with the typed value kept", () => {
    const html = renderToStaticMarkup(
      <NewSessionWorkspacePicker
        open
        initialView="add"
        workspaces={[]}
        serverPathError="not a directory"
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(html).toContain("not a directory");
  });
});

describe("hero presentation region naming", () => {
  const workspaces = [
    { id: "w1", name: "proj-a", path: "/srv/a" },
    { id: "w2", name: "proj-b", path: "/srv/b" },
  ];

  it("names the hero region the way the product specs select it", () => {
    const choose = renderToStaticMarkup(
      <NewSessionWorkspacePicker
        presentation="hero"
        workspaces={workspaces}
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    const add = renderToStaticMarkup(
      <NewSessionWorkspacePicker
        presentation="hero"
        initialView="add"
        workspaces={workspaces}
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    const headingFor = (html: string): string => {
      const labelledBy = /<section[^>]*aria-labelledby="([^"]+)"/.exec(
        html,
      )?.[1];
      expect(labelledBy).toBeTruthy();
      const heading = new RegExp(
        `<h2[^>]*id="${labelledBy}"[^>]*>([^<]*)</h2>`,
      ).exec(html)?.[1];
      return (heading ?? "").trim();
    };

    // The region's accessible name must track the visible heading: "Add
    // workspace" needs a different name than "Choose a workspace", so a
    // static aria-label cannot carry it. Product specs select this region by
    // role+name; dropping aria-labelledby breaks that wall.
    for (const html of [choose, add]) {
      expect(html).not.toMatch(/<section[^>]*aria-label="/);
    }
    expect(headingFor(choose)).toBe("Choose a workspace");
    expect(headingFor(add)).toBe("Add workspace");
  });
});
