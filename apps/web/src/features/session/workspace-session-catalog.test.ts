import { describe, expect, it, vi } from "vitest";
import {
  OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import {
  catalogSessionsFromList,
  createWorkspaceSessionCatalog,
  mergeWorkspaceSessionRows,
  supportsWorkspaceSessionCatalog,
} from "./workspace-session-catalog.ts";

const caps: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: ["session/list", "session/open"],
  supported_notifications: [],
  supported_features: ["session.workspace_cwd.v1"],
};

describe("workspace session catalog rows", () => {
  it("keeps only full sessions of the requested profile and maps server metadata", () => {
    const rows = catalogSessionsFromList("/srv/project", "dev", [
      {
        id: "dev:api:web-old",
        message_count: 730,
        title: "学习一下如何做editable pptx",
        updated_at: "2026-09-22T01:37:00.222Z",
        last_prompt: "记住现在的skills",
        active_turn: false,
      },
      { id: "dev:api:web-new", message_count: 9 },
      // Another profile's row must never show under this profile.
      { id: "other:api:web-x", message_count: 1 },
      // A bare id cannot be routed; drop it rather than guess a profile.
      { id: "bare", message_count: 1 },
    ]);
    expect(rows).toEqual([
      {
        sessionId: "dev:api:web-old",
        profileId: "dev",
        workspaceRoot: "/srv/project",
        title: "学习一下如何做editable pptx",
        lastPrompt: "记住现在的skills",
        updatedAt: Date.parse("2026-09-22T01:37:00.222Z"),
        activeTurn: false,
      },
      {
        sessionId: "dev:api:web-new",
        profileId: "dev",
        workspaceRoot: "/srv/project",
        title: null,
        lastPrompt: null,
        updatedAt: null,
      },
    ]);
  });
  it("orders newest first and tolerates an unparseable timestamp", () => {
    const rows = catalogSessionsFromList("/p", "dev", [
      { id: "dev:api:a", message_count: 1, updated_at: "2026-01-01T00:00:00Z" },
      { id: "dev:api:b", message_count: 1, updated_at: "not a date" },
      { id: "dev:api:c", message_count: 1, updated_at: "2026-02-01T00:00:00Z" },
    ]);
    expect(rows.map((row) => row.sessionId)).toEqual([
      "dev:api:c",
      "dev:api:a",
      "dev:api:b",
    ]);
    expect(rows[2]?.updatedAt).toBeNull();
  });
  it("merges tab-known refs with catalog rows: server title wins, recency is the max", () => {
    const merged = mergeWorkspaceSessionRows(
      [
        {
          sessionId: "dev:api:web-old",
          profileId: "dev",
          workspaceRoot: "/p",
          lastOpenedAt: 500,
        },
        {
          sessionId: "dev:api:web-tab-only",
          profileId: "dev",
          workspaceRoot: "/p",
          lastOpenedAt: 100,
        },
      ],
      [
        {
          sessionId: "dev:api:web-old",
          profileId: "dev",
          workspaceRoot: "/p",
          title: "Old work",
          lastPrompt: null,
          updatedAt: 300,
        },
        {
          sessionId: "dev:api:web-disk-only",
          profileId: "dev",
          workspaceRoot: "/p",
          title: null,
          lastPrompt: "last words",
          updatedAt: 200,
        },
      ],
    );
    expect(merged).toEqual([
      {
        sessionId: "dev:api:web-old",
        profileId: "dev",
        title: "Old work",
        updatedAt: 500,
      },
      {
        sessionId: "dev:api:web-disk-only",
        profileId: "dev",
        title: "last words",
        updatedAt: 200,
      },
      {
        sessionId: "dev:api:web-tab-only",
        profileId: "dev",
        title: null,
        updatedAt: 100,
      },
    ]);
  });
  it("is available only with session/list and workspace-scoped listing", () => {
    expect(supportsWorkspaceSessionCatalog(caps)).toBe(true);
    expect(supportsWorkspaceSessionCatalog(undefined)).toBe(false);
    expect(
      supportsWorkspaceSessionCatalog({ ...caps, supported_features: [] }),
    ).toBe(false);
    expect(
      supportsWorkspaceSessionCatalog({
        ...caps,
        supported_methods: ["session/open"],
      }),
    ).toBe(false);
  });
});

describe("workspace session catalog loader", () => {
  function fixture() {
    const client = new OctosUiClient({ endpoint: "ws://server.test/ui" });
    const list = vi.spyOn(client, "listSessions");
    const catalog = createWorkspaceSessionCatalog({ client, profileId: "dev" });
    const seen: number[] = [];
    catalog.subscribe(() => seen.push(catalog.getSnapshot().size));
    return { client, list, catalog, seen };
  }
  it("lists each workspace with cwd and profile and publishes loading then loaded", async () => {
    const f = fixture();
    f.list.mockImplementation(async (params) => {
      const cwd = params?.cwd ?? "";
      return {
        sessions: [{ id: `dev:api:${cwd}`, message_count: 1, title: cwd }],
      };
    });
    const pending = f.catalog.refresh(["/a", "/b"]);
    expect(f.catalog.getSnapshot().get("/a")?.status).toBe("loading");
    await pending;
    expect(f.list).toHaveBeenCalledWith({ cwd: "/a", profile_id: "dev" });
    expect(f.list).toHaveBeenCalledWith({ cwd: "/b", profile_id: "dev" });
    const a = f.catalog.getSnapshot().get("/a");
    expect(a?.status).toBe("loaded");
    expect(a?.sessions.map((row) => row.title)).toEqual(["/a"]);
    expect(f.catalog.getSnapshot().get("/b")?.status).toBe("loaded");
    expect(f.seen.length).toBeGreaterThan(0);
  });
  it("keeps the previous rows while reloading and on a server error", async () => {
    const f = fixture();
    f.list.mockResolvedValueOnce({
      sessions: [{ id: "dev:api:one", message_count: 1 }],
    });
    await f.catalog.refresh(["/a"]);
    f.list.mockRejectedValueOnce(new Error("cwd_runtime_unavailable"));
    const pending = f.catalog.refresh(["/a"]);
    const loading = f.catalog.getSnapshot().get("/a");
    expect(loading?.status).toBe("loading");
    expect(loading?.sessions.map((row) => row.sessionId)).toEqual([
      "dev:api:one",
    ]);
    await pending;
    const failed = f.catalog.getSnapshot().get("/a");
    expect(failed?.status).toBe("error");
    expect(failed?.error).toBe("cwd_runtime_unavailable");
    expect(failed?.sessions.map((row) => row.sessionId)).toEqual([
      "dev:api:one",
    ]);
  });
  it("drops workspaces that are no longer requested and ignores results after dispose", async () => {
    const f = fixture();
    f.list.mockResolvedValue({ sessions: [] });
    await f.catalog.refresh(["/a", "/b"]);
    await f.catalog.refresh(["/a"]);
    expect([...f.catalog.getSnapshot().keys()]).toEqual(["/a"]);
    let release!: () => void;
    f.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ sessions: [{ id: "dev:api:late", message_count: 1 }] });
        }),
    );
    const pending = f.catalog.refresh(["/a"]);
    f.catalog.dispose();
    release();
    await pending;
    expect(f.catalog.getSnapshot().size).toBe(0);
  });
  it("does nothing without a profile to scope the listing", async () => {
    const client = new OctosUiClient({ endpoint: "ws://server.test/ui" });
    const list = vi.spyOn(client, "listSessions");
    const catalog = createWorkspaceSessionCatalog({ client, profileId: "" });
    await catalog.refresh(["/a"]);
    expect(list).not.toHaveBeenCalled();
    expect(catalog.getSnapshot().size).toBe(0);
  });
});
