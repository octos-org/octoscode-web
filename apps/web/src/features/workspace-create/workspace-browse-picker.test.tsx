import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  APPUI_ONBOARDING_FEATURES,
  OctosUiProtocolError,
  type OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import { UiTextProvider } from "../preferences/ui-text.tsx";
import zh from "../preferences/zh.ts";
import { NewSessionWorkspacePicker } from "./NewSessionWorkspacePicker.tsx";
import { workspaceBrowseAdapter } from "./workspace-browse-adapter.ts";
import type { WorkspaceBrowseAdapter } from "./workspace-browse.ts";

const ADAPTER: WorkspaceBrowseAdapter = {
  list: vi.fn(async () => ({
    status: "ok" as const,
    value: {
      canonicalPath: "/srv/projects",
      parentPath: "/srv",
      writable: true,
      entries: [],
      truncated: false,
      hiddenSkipped: 0,
    },
  })),
  create: vi.fn(async () => ({
    status: "ok" as const,
    value: { canonicalPath: "/srv/projects/new-app" },
  })),
};

const CAPABILITIES: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [],
  supported_notifications: [],
  supported_features: [APPUI_ONBOARDING_FEATURES.WORKSPACE_BROWSE_V1],
};

function picker(
  props: Partial<Parameters<typeof NewSessionWorkspacePicker>[0]>,
) {
  return renderToStaticMarkup(
    <NewSessionWorkspacePicker
      open
      presentation="hero"
      initialView="add"
      workspaces={[]}
      onCancel={vi.fn()}
      onCreate={vi.fn()}
      {...props}
    />,
  );
}

describe("§Gate: the Browse affordance is advertised, never assumed", () => {
  it("offers Browse with a real accessible name when the adapter is present", () => {
    const html = picker({ browse: ADAPTER });
    expect(html).toContain('data-workspace-browse="true"');
    expect(html).toContain('aria-label="Browse server folders"');
    // The typed path box is untouched: browsing is additive.
    expect(html).toContain("Server workspace path");
  });

  it("hides every browsing affordance without the adapter (fail closed)", () => {
    const html = picker({});
    expect(html).not.toContain("data-workspace-browse");
    expect(html).not.toContain("Browse");
    // …and the form is byte-for-byte the pre-feature form.
    expect(html).toBe(picker({ browse: null }));
  });

  it("refuses to stand in the browse view without an adapter", () => {
    const html = picker({ initialView: "browse" });
    expect(html).not.toContain("data-workspace-browser");
    expect(html).toContain("Server workspace path");
  });
});

describe("the browser is keyboard-operable with real accessible names", () => {
  const html = picker({ initialView: "browse", browse: ADAPTER });

  it("names the surface, the way up, and the choose action", () => {
    expect(html).toContain('data-workspace-browser="true"');
    expect(html).toContain("Browse server folders");
    expect(html).toContain('aria-label="Go to the parent folder"');
    expect(html).toContain("Use this folder");
    expect(html).toContain("Back to the path");
  });

  it("keeps every control a real button, so Tab and Enter reach it", () => {
    // No div-with-onclick: each affordance in the browser is a <button>.
    const browser = html.slice(html.indexOf("data-workspace-browser"));
    expect(browser).not.toMatch(/<div[^>]*role="button"/);
    expect(browser).toMatch(/<button[^>]*type="button"/);
  });

  it("disables the way up until the server reports a parent", () => {
    // Nothing is listed yet on first paint, so Up cannot be pressed.
    const up = html.slice(html.indexOf('aria-label="Go to the parent folder"'));
    expect(up.slice(0, 200)).toContain("disabled");
  });
});

describe("Chinese presentation", () => {
  it("translates the browsing affordance and its accessible name", () => {
    const html = renderToStaticMarkup(
      <UiTextProvider language="zh" catalog={zh}>
        <NewSessionWorkspacePicker
          open
          presentation="hero"
          initialView="browse"
          workspaces={[]}
          browse={ADAPTER}
          onCancel={vi.fn()}
          onCreate={vi.fn()}
        />
      </UiTextProvider>,
    );
    expect(html).toContain("浏览服务器文件夹");
    expect(html).toContain('aria-label="转到上一级文件夹"');
    expect(html).toContain("使用此文件夹");
    expect(html).not.toContain("Use this folder");
  });
});

describe("adapter gate and refusal mapping", () => {
  const client = {
    listWorkspaceFolders: vi.fn(),
    createWorkspaceFolder: vi.fn(),
  } as unknown as OctosUiClient;

  it("is null without a client or without the advertised feature", () => {
    expect(workspaceBrowseAdapter(null, CAPABILITIES)).toBeNull();
    expect(workspaceBrowseAdapter(client, undefined)).toBeNull();
    expect(
      workspaceBrowseAdapter(client, {
        ...CAPABILITIES,
        supported_features: [],
      }),
    ).toBeNull();
    expect(workspaceBrowseAdapter(client, CAPABILITIES)).not.toBeNull();
  });

  it("renames the wire result onto the product's own shape", async () => {
    vi.mocked(client.listWorkspaceFolders).mockResolvedValue({
      canonical_path: "/srv/projects",
      parent_path: null,
      writable: false,
      entries: [{ name: "app", path: "/srv/projects/app", writable: true }],
      truncated: true,
      hidden_skipped: 2,
    });
    const adapter = workspaceBrowseAdapter(client, CAPABILITIES)!;
    await expect(adapter.list(null)).resolves.toEqual({
      status: "ok",
      value: {
        canonicalPath: "/srv/projects",
        parentPath: null,
        writable: false,
        entries: [{ name: "app", path: "/srv/projects/app", writable: true }],
        truncated: true,
        hiddenSkipped: 2,
      },
    });
    expect(client.listWorkspaceFolders).toHaveBeenCalledWith({ path: null });
  });

  it("keeps a typed kind and buries every other failure as unknown", async () => {
    const adapter = workspaceBrowseAdapter(client, CAPABILITIES)!;
    vi.mocked(client.createWorkspaceFolder).mockRejectedValue(
      new OctosUiProtocolError(-32_010, "raw server prose", {
        kind: "workspace_create_permission_denied",
      }),
    );
    await expect(adapter.create("/srv", "app")).resolves.toEqual({
      status: "failed",
      failure: "workspace_create_permission_denied",
    });
    vi.mocked(client.createWorkspaceFolder).mockRejectedValue(
      new Error("raw server prose"),
    );
    await expect(adapter.create("/srv", "app")).resolves.toEqual({
      status: "failed",
      failure: "unknown",
    });
    vi.mocked(client.listWorkspaceFolders).mockRejectedValue(
      new OctosUiProtocolError(-32_010, "raw server prose", {
        kind: "workspace_list_future_kind",
      }),
    );
    await expect(adapter.list("/srv")).resolves.toEqual({
      status: "failed",
      failure: "unknown",
    });
  });
});
