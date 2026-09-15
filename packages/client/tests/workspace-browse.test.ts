import { describe, expect, it, vi } from "vitest";
import {
  APPUI_ONBOARDING_FEATURES,
  APPUI_ONBOARDING_METHODS,
  parseWorkspaceCreateResult,
  parseWorkspaceListResult,
  supportsWorkspaceBrowse,
  workspaceBrowseRefusal,
  WORKSPACE_BROWSE_MAX_ENTRIES,
  WORKSPACE_CREATE_REFUSAL_KINDS,
  WORKSPACE_LIST_REFUSAL_KINDS,
} from "../src/index.ts";
import { OctosUiClient, OctosUiProtocolError } from "../src/client.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

/** WEB-WORKSPACE-BROWSER-CONTRACT-5000 — the client half of the contract. */

const LISTING = {
  canonical_path: "/Users/me/projects",
  parent_path: "/Users/me",
  writable: true,
  entries: [
    {
      name: "octoscode-web",
      path: "/Users/me/projects/octoscode-web",
      writable: true,
    },
    { name: "notes", path: "/Users/me/projects/notes", writable: false },
  ],
  truncated: false,
  hidden_skipped: 3,
};

const CAPABILITIES: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    APPUI_ONBOARDING_METHODS.WORKSPACE_LIST,
    APPUI_ONBOARDING_METHODS.WORKSPACE_CREATE,
  ],
  supported_notifications: [],
  supported_features: [APPUI_ONBOARDING_FEATURES.WORKSPACE_BROWSE_V1],
};

describe("workspace_list result contract", () => {
  it("decodes the contract's example listing verbatim", () => {
    expect(parseWorkspaceListResult(LISTING)).toEqual(LISTING);
  });

  it("keeps a root listing's absent parent as a null parent_path", () => {
    const root = { ...LISTING, parent_path: null, entries: [] };
    expect(parseWorkspaceListResult(root)?.parent_path).toBeNull();
    const { parent_path: _omitted, ...withoutParent } = root;
    expect(parseWorkspaceListResult(withoutParent)?.parent_path).toBeNull();
  });

  it("accepts a full, truncated page of 500 entries", () => {
    const entries = Array.from(
      { length: WORKSPACE_BROWSE_MAX_ENTRIES },
      (_value, index) => ({
        name: `folder-${index}`,
        path: `/Users/me/projects/folder-${index}`,
        writable: true,
      }),
    );
    const page = { ...LISTING, entries, truncated: true };
    expect(parseWorkspaceListResult(page)?.entries).toHaveLength(
      WORKSPACE_BROWSE_MAX_ENTRIES,
    );
    expect(
      parseWorkspaceListResult({
        ...page,
        entries: [...entries, { name: "over", path: "/over", writable: true }],
      }),
    ).toBeNull();
  });

  it.each([
    { canonical_path: "" },
    { canonical_path: 7 },
    { parent_path: "" },
    { parent_path: 7 },
    { writable: "yes" },
    { truncated: null },
    { hidden_skipped: -1 },
    { hidden_skipped: 1.5 },
    { hidden_skipped: "3" },
    { entries: null },
    { entries: [{ name: "a", path: "/a" }] },
    { entries: [{ name: "a", path: "", writable: true }] },
    { entries: [{ name: "", path: "/a", writable: true }] },
    // A separator in an entry name could never be joined onto the parent.
    { entries: [{ name: "a/b", path: "/a/b", writable: true }] },
    { entries: [{ name: "a\\b", path: "/a/b", writable: true }] },
  ])("refuses an unusable listing %j", (patch) => {
    expect(parseWorkspaceListResult({ ...LISTING, ...patch })).toBeNull();
  });

  it("refuses anything that is not a result object", () => {
    for (const value of [null, undefined, "", 1, [], true])
      expect(parseWorkspaceListResult(value)).toBeNull();
  });
});

describe("workspace_create result contract", () => {
  it("decodes both created and idempotent-existing successes", () => {
    for (const created of [true, false])
      expect(
        parseWorkspaceCreateResult({
          canonical_path: "/Users/me/projects/new-app",
          created,
        }),
      ).toEqual({ canonical_path: "/Users/me/projects/new-app", created });
  });

  it.each([
    { canonical_path: "" },
    { canonical_path: null },
    { created: "true" },
    { created: undefined },
  ])("refuses an unusable creation result %j", (patch) => {
    expect(
      parseWorkspaceCreateResult({
        canonical_path: "/Users/me/projects/new-app",
        created: true,
        ...patch,
      }),
    ).toBeNull();
  });
});

describe("typed refusals", () => {
  it("whitelists every kind the contract defines, both families", () => {
    for (const kind of [
      ...WORKSPACE_LIST_REFUSAL_KINDS,
      ...WORKSPACE_CREATE_REFUSAL_KINDS,
    ]) {
      expect(
        workspaceBrowseRefusal(
          new OctosUiProtocolError(-32_010, "server prose", { kind }),
        ),
      ).toEqual({ kind });
    }
  });

  it("carries banned_root on a root escape", () => {
    expect(
      workspaceBrowseRefusal(
        new OctosUiProtocolError(-32_010, "server prose", {
          kind: "workspace_list_root_escape",
          banned_root: "/etc",
        }),
      ),
    ).toEqual({ kind: "workspace_list_root_escape", bannedRoot: "/etc" });
  });

  it("refuses an unknown kind, a lookalike error, and a bare failure", () => {
    expect(
      workspaceBrowseRefusal(
        new OctosUiProtocolError(-32_010, "x", {
          kind: "workspace_list_future",
        }),
      ),
    ).toBeNull();
    expect(
      workspaceBrowseRefusal(
        new OctosUiProtocolError(-32_010, "x", { kind: 7 }),
      ),
    ).toBeNull();
    expect(
      workspaceBrowseRefusal(new OctosUiProtocolError(-32_010, "x")),
    ).toBeNull();
    // Identity, not duck-typing: a plain object with a matching kind is data.
    expect(
      workspaceBrowseRefusal({ data: { kind: "workspace_list_not_found" } }),
    ).toBeNull();
    expect(
      workspaceBrowseRefusal(new Error("workspace_list_not_found")),
    ).toBeNull();
  });
});

describe("feature gate", () => {
  it("opens only on the advertised feature and fails closed otherwise", () => {
    expect(supportsWorkspaceBrowse(CAPABILITIES)).toBe(true);
    expect(supportsWorkspaceBrowse(undefined)).toBe(false);
    expect(
      supportsWorkspaceBrowse({ ...CAPABILITIES, supported_features: [] }),
    ).toBe(false);
    const { supported_features: _absent, ...withoutFeatures } = CAPABILITIES;
    expect(supportsWorkspaceBrowse(withoutFeatures)).toBe(false);
    // An advertised method is never the gate.
    expect(
      supportsWorkspaceBrowse({
        ...CAPABILITIES,
        supported_features: ["onboarding.workspace_probe.v1"],
      }),
    ).toBe(false);
  });
});

describe("transport methods", () => {
  it("sends both contract methods and validates their results", async () => {
    const socket = createSocket();
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await connecting;

    const listing = client.listWorkspaceFolders({ path: null });
    let frame = lastFrame(socket);
    expect(frame).toMatchObject({
      method: "onboarding/workspace_list",
      params: { path: null },
    });
    respond(socket, frame.id, LISTING);
    await expect(listing).resolves.toEqual(LISTING);

    const creating = client.createWorkspaceFolder({
      parent: "/Users/me/projects",
      name: "new-app",
    });
    frame = lastFrame(socket);
    expect(frame).toMatchObject({
      method: "onboarding/workspace_create",
      params: { parent: "/Users/me/projects", name: "new-app" },
    });
    respond(socket, frame.id, {
      canonical_path: "/Users/me/projects/new-app",
      created: true,
    });
    await expect(creating).resolves.toEqual({
      canonical_path: "/Users/me/projects/new-app",
      created: true,
    });

    const invalid = client.listWorkspaceFolders({ path: "/Users/me" });
    frame = lastFrame(socket);
    respond(socket, frame.id, { ...LISTING, entries: "not-a-list" });
    await expect(invalid).rejects.toThrow("returned an invalid result");

    const refused = client.createWorkspaceFolder({ parent: "/", name: ".." });
    frame = lastFrame(socket);
    socket.onmessage?.({
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: frame.id,
        error: {
          code: -32_010,
          message: "server prose",
          data: { kind: "workspace_create_invalid_name" },
        },
      }),
    } as MessageEvent);
    await expect(refused).rejects.toThrow();
    await refused.catch((reason: unknown) => {
      expect(workspaceBrowseRefusal(reason)).toEqual({
        kind: "workspace_create_invalid_name",
      });
    });
    client.disconnect();
  });
});

function createSocket() {
  return {
    readyState: 0,
    send: vi.fn(),
    close: vi.fn(),
    onopen: undefined as ((event: Event) => void) | undefined,
    onclose: undefined as ((event: CloseEvent) => void) | undefined,
    onerror: undefined as ((event: Event) => void) | undefined,
    onmessage: undefined as ((event: MessageEvent) => void) | undefined,
  };
}

function lastFrame(socket: ReturnType<typeof createSocket>) {
  return JSON.parse(String(socket.send.mock.calls.at(-1)?.[0])) as {
    id: string;
    method: string;
    params: unknown;
  };
}

function respond(
  socket: ReturnType<typeof createSocket>,
  id: string,
  result: unknown,
) {
  socket.onmessage?.({
    data: JSON.stringify({ jsonrpc: "2.0", id, result }),
  } as MessageEvent);
}
