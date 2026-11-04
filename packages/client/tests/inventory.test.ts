import { describe, expect, it, vi } from "vitest";
import {
  parseRuntimeTools,
  parseMcpConnectorMutation,
  parseRuntimeMcp,
  createInventoryCommands,
  supportsMcpConnectorManagement,
} from "../src/inventory.ts";
import {
  APPUI_INVENTORY_METHODS,
  MCP_CONNECTOR_MANAGE_V1,
  MCP_CONNECTOR_METHODS,
} from "../src/inventory-methods.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

const scope = { session_id: "s1", profile_id: "p1" };
const tool = {
  name: "read_file",
  category: "file",
  status: "available",
  policy: "allowed",
  aliases: [],
  backend_tool: "read_file",
};
const summary = { connected: 0, connecting: 0, failed: 0, disabled: 0 };
const capabilities: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [],
  supported_notifications: [],
};
const managementCapabilities: UiProtocolCapabilities = {
  ...capabilities,
  supported_features: [MCP_CONNECTOR_MANAGE_V1],
  supported_methods: [
    ...Object.values(MCP_CONNECTOR_METHODS),
    APPUI_INVENTORY_METHODS.MCP,
  ],
};
const mcpStatus = { ...scope, servers: [], summary };
describe("runtime inventory contracts", () => {
  it("accepts actual nullable MCP fields and the rc11 empty reported inventory", () => {
    expect(
      parseRuntimeMcp({ ...scope, servers: [], summary }, "s1", "p1")?.servers,
    ).toEqual([]);
    expect(
      parseRuntimeMcp(
        {
          ...scope,
          servers: [
            {
              id: "mcp-1",
              display_name: null,
              transport: null,
              status: "disabled",
              tool_count: 0,
              tools: [],
              error: null,
            },
          ],
          summary: { ...summary, disabled: 1 },
        },
        "s1",
        "p1",
      )?.servers[0],
    ).toEqual({
      id: "mcp-1",
      status: "disabled",
      enabled: true,
      toolCount: 0,
      tools: [],
    });
  });
  it("projects MCP management fields without connector configuration", () => {
    const result = parseRuntimeMcp(
      {
        ...scope,
        servers: [
          {
            id: "mcp-1",
            status: "disabled",
            enabled: false,
            authorization: "required",
            tool_count: 0,
            tools: [],
            url: "https://private.example",
            config: { client_secret: "secret-token" },
            access_token: "secret-token",
          },
        ],
        summary: { ...summary, disabled: 1 },
      },
      "s1",
      "p1",
    );
    expect(result?.servers).toEqual([
      {
        id: "mcp-1",
        status: "disabled",
        enabled: false,
        authorization: "required",
        toolCount: 0,
        tools: [],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("private.example");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
  it("projects the T-0056 management facts and nothing else from the allowlist", () => {
    const result = parseRuntimeMcp(
      {
        ...mcpStatus,
        can_manage: true,
        stdio_allowlist: [
          {
            entry_id: "local-fs",
            display_name: "Shared files",
            description: "Read-only project files",
            command: "/opt/octos/bin/filesystem-mcp",
            args: ["--root", "/srv/shared"],
            env: { TOKEN: "secret-token" },
          },
          { entry_id: "echo", display_name: null },
        ],
      },
      "s1",
      "p1",
    );
    expect(result?.management).toEqual({ canManage: true });
    expect(result?.stdioAllowlist).toEqual([
      {
        entryId: "local-fs",
        displayName: "Shared files",
        description: "Read-only project files",
      },
      { entryId: "echo", displayName: "echo" },
    ]);
    for (const secret of ["filesystem-mcp", "/srv/shared", "secret-token"])
      expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("keeps an empty allowlist and the reason management is unavailable", () => {
    const result = parseRuntimeMcp(
      {
        ...mcpStatus,
        can_manage: false,
        manage_unavailable_reason: "requires_profile_write",
        stdio_allowlist: [],
      },
      "s1",
      "p1",
    );
    expect(result?.management).toEqual({
      canManage: false,
      reason: "requires_profile_write",
    });
    expect(result?.stdioAllowlist).toEqual([]);
  });
  it("leaves the facts absent on an older server", () => {
    const legacy = parseRuntimeMcp(mcpStatus, "s1", "p1");
    expect(legacy).not.toBeNull();
    expect(legacy).not.toHaveProperty("management");
    expect(legacy).not.toHaveProperty("stdioAllowlist");
    expect(legacy).not.toHaveProperty("invalidFacts");
  });
  it.each([
    [{ can_manage: "false" }, ["can_manage"]],
    [{ can_manage: null }, ["can_manage"]],
    [{ can_manage: false, manage_unavailable_reason: 7 }, ["can_manage"]],
    [
      { stdio_allowlist: [{ entry_id: "a" }, { entry_id: "a" }] },
      ["stdio_allowlist"],
    ],
    [{ stdio_allowlist: { entry_id: "a" } }, ["stdio_allowlist"]],
    [{ stdio_allowlist: [{ entry_id: 3 }] }, ["stdio_allowlist"]],
    [
      {
        stdio_allowlist: Array.from({ length: 1001 }, (_, i) => ({
          entry_id: `e${i}`,
        })),
      },
      ["stdio_allowlist"],
    ],
    [
      {
        can_manage: "yes",
        stdio_allowlist: [{ entry_id: "a" }, { entry_id: "a" }],
      },
      ["can_manage", "stdio_allowlist"],
    ],
  ])(
    "reports malformed facts %j instead of passing for an older server",
    (facts, invalid) => {
      const result = parseRuntimeMcp({ ...mcpStatus, ...facts }, "s1", "p1");
      expect(result?.servers).toEqual([]);
      expect(result?.invalidFacts).toEqual(invalid);
      if (invalid.includes("can_manage"))
        expect(result).not.toHaveProperty("management");
      if (invalid.includes("stdio_allowlist"))
        expect(result).not.toHaveProperty("stdioAllowlist");
    },
  );
  it("keeps an unknown reason as reported", () => {
    expect(
      parseRuntimeMcp(
        {
          ...mcpStatus,
          can_manage: false,
          manage_unavailable_reason: "temporary_maintenance",
        },
        "s1",
        "p1",
      )?.management,
    ).toEqual({ canManage: false, reason: "temporary_maintenance" });
  });
  it("projects only status fields and rejects duplicate or wrong-scope rows", () => {
    const result = parseRuntimeTools(
      {
        ...scope,
        policy_id: "profile",
        api_key: "must-not-project",
        tools: [{ ...tool, secret: "must-not-project", backend_tool: null }],
      },
      "s1",
      "p1",
    );
    expect(result?.tools[0]?.backendTool).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("must-not-project");
    expect(
      parseRuntimeTools(
        { ...scope, policy_id: "profile", tools: [tool, tool] },
        "s1",
        "p1",
      ),
    ).toBeNull();
    expect(
      parseRuntimeTools(
        { ...scope, policy_id: "profile", tools: [tool] },
        "s1",
        "other",
      ),
    ).toBeNull();
    expect(
      parseRuntimeMcp({ ...scope, servers: [], summary }, "other", "p1"),
    ).toBeNull();
  });
  it("rejects malformed nullable fields and unsafe counts", () => {
    expect(
      parseRuntimeMcp(
        {
          ...scope,
          servers: [
            {
              id: "x",
              display_name: {},
              status: "failed",
              tool_count: 0,
              tools: [],
            },
          ],
          summary,
        },
        "s1",
        "p1",
      ),
    ).toBeNull();
    expect(
      parseRuntimeMcp(
        {
          ...scope,
          servers: [
            {
              id: "x",
              status: "failed",
              enabled: "false",
              authorization: {},
              tool_count: 0,
              tools: [],
            },
          ],
          summary,
        },
        "s1",
        "p1",
      ),
    ).toBeNull();
    expect(
      parseRuntimeMcp(
        { ...scope, servers: [], summary: { ...summary, connected: 2 ** 54 } },
        "s1",
        "p1",
      ),
    ).toBeNull();
  });
  it("gates each status method before sending and validates returned scope", async () => {
    const request = vi.fn(async () => ({
      ...scope,
      profile_id: "wrong",
      policy_id: "profile",
      tools: [],
    }));
    await expect(
      createInventoryCommands({ request }, "s1", "p1", capabilities).tools(),
    ).rejects.toThrow("not advertised");
    expect(request).not.toHaveBeenCalled();
    const commands = createInventoryCommands({ request }, "s1", "p1", {
      ...capabilities,
      supported_methods: ["tool/status/list"],
    });
    await expect(commands.tools()).rejects.toThrow("wrong-scope");
    expect(request).toHaveBeenCalledWith("tool/status/list", {
      session_id: "s1",
      profile_id: "p1",
      include_denied: true,
    });
    await expect(commands.mcp()).rejects.toThrow("not advertised");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("sends exact connector management payloads without reading status", async () => {
    const request = vi.fn(async (method: string) => ({
      status: method === MCP_CONNECTOR_METHODS.DELETE ? null : { id: "mcp-1" },
    }));
    const commands = createInventoryCommands(
      { request },
      "s1",
      "p1",
      managementCapabilities,
    );
    await commands.createHttpConnector("Docs", "https://docs.example/mcp");
    await commands.updateConnector("mcp-1", { name: "Renamed" });
    await commands.deleteConnector("mcp-1");
    await commands.setConnectorEnabled("mcp-1", false);
    await commands.reconnectConnector("mcp-1");
    expect(request).toHaveBeenNthCalledWith(1, MCP_CONNECTOR_METHODS.CREATE, {
      session_id: "s1",
      connector: {
        transport: "http",
        name: "Docs",
        url: "https://docs.example/mcp",
      },
    });
    expect(request).toHaveBeenNthCalledWith(2, MCP_CONNECTOR_METHODS.UPDATE, {
      session_id: "s1",
      connector_id: "mcp-1",
      patch: { name: "Renamed" },
    });
    expect(request).toHaveBeenNthCalledWith(3, MCP_CONNECTOR_METHODS.DELETE, {
      session_id: "s1",
      connector_id: "mcp-1",
    });
    expect(request).toHaveBeenNthCalledWith(
      4,
      MCP_CONNECTOR_METHODS.SET_ENABLED,
      { session_id: "s1", connector_id: "mcp-1", enabled: false },
    );
    expect(request).toHaveBeenNthCalledWith(
      5,
      MCP_CONNECTOR_METHODS.RECONNECT,
      { session_id: "s1", connector_id: "mcp-1" },
    );
    expect(request).toHaveBeenCalledTimes(5);
  });
  it("reads what the server saved from Core's real create result", async () => {
    // Captured from a startup-pinned profile on Core 4748d11b.
    const request = vi.fn(async () => ({
      status: null,
      runtime: {
        runtime_disposition: "restart_required",
        restart_required: true,
        config_revision: "2026-11-04T10:05:54.140841525+00:00",
        effective_from: "next_turn",
      },
      connector: {
        id: "mcp-c1023b4b",
        name: "Fixture",
        transport: "http",
        enabled: true,
        url: "https://fixture.invalid/mcp",
        allowlist_entry_id: null,
        oauth: false,
        scopes: [],
        concurrency_class: null,
      },
      created: true,
    }));
    const commands = createInventoryCommands(
      { request },
      "s1",
      "p1",
      managementCapabilities,
    );
    await expect(
      commands.createHttpConnector("Fixture", "https://fixture.invalid/mcp"),
    ).resolves.toEqual({
      connector: {
        id: "mcp-c1023b4b",
        name: "Fixture",
        transport: "http",
        enabled: true,
        url: "https://fixture.invalid/mcp",
      },
      runtime: { restartRequired: true, effectiveFrom: "next_turn" },
      created: true,
      deleted: false,
      listed: false,
    });
  });
  it("a mutation result it can't read yields no connector, not an error", () => {
    const unread = { created: false, deleted: false, listed: false };
    expect(parseMcpConnectorMutation(null)).toEqual(unread);
    expect(parseMcpConnectorMutation({ connector: { id: 1 } })).toEqual(unread);
    expect(
      parseMcpConnectorMutation({ connector: { id: "a", name: "b" } }),
    ).toEqual(unread);
    expect(
      parseMcpConnectorMutation({ runtime: { restart_required: "yes" } }),
    ).toEqual(unread);
  });
  it("marks a connector the server already lists, and carries a rebuild failure", () => {
    expect(
      parseMcpConnectorMutation({
        status: { id: "a" },
        runtime: {
          restart_required: false,
          effective_from: "next_turn",
          runtime_error: "rebuild failed",
        },
        deleted: true,
      }),
    ).toEqual({
      runtime: {
        restartRequired: false,
        effectiveFrom: "next_turn",
        error: "rebuild failed",
      },
      created: false,
      deleted: true,
      listed: true,
    });
  });
  it("creates a stdio connector from an allowlist entry, never a command", async () => {
    const request = vi.fn(async (method: string) =>
      method === APPUI_INVENTORY_METHODS.MCP ? mcpStatus : { status: null },
    );
    const commands = createInventoryCommands(
      { request },
      "s1",
      "p1",
      managementCapabilities,
    );
    await commands.createStdioConnector("Shared files", "local-fs");
    expect(request).toHaveBeenNthCalledWith(1, MCP_CONNECTOR_METHODS.CREATE, {
      session_id: "s1",
      connector: {
        transport: "stdio",
        name: "Shared files",
        allowlist_entry_id: "local-fs",
      },
    });
    await expect(commands.createStdioConnector("Files", "")).rejects.toThrow(
      /allowlist entry/,
    );
  });
  it("uses method capabilities when Core #2912 omits the feature", async () => {
    const request = vi.fn(async (method: string) =>
      method === APPUI_INVENTORY_METHODS.MCP
        ? mcpStatus
        : { status: { id: "mcp-1" } },
    );
    const withoutFeature = {
      ...managementCapabilities,
      supported_features: [],
    };
    expect(supportsMcpConnectorManagement(withoutFeature)).toBe(true);
    const noFeature = createInventoryCommands(
      { request },
      "s1",
      "p1",
      withoutFeature,
    );
    await expect(
      noFeature.createHttpConnector("Docs", "https://docs.example/mcp"),
    ).resolves.toMatchObject({ listed: true });
    expect(request).toHaveBeenCalledTimes(1);
    request.mockClear();

    const withoutDelete = {
      ...managementCapabilities,
      supported_methods: managementCapabilities.supported_methods.filter(
        (method) => method !== MCP_CONNECTOR_METHODS.DELETE,
      ),
    };
    const noDelete = createInventoryCommands(
      { request },
      "s1",
      "p1",
      withoutDelete,
    );
    await expect(noDelete.deleteConnector("mcp-1")).rejects.toThrow(
      "not advertised",
    );
    expect(request).not.toHaveBeenCalled();
    expect(supportsMcpConnectorManagement(managementCapabilities)).toBe(true);
    expect(supportsMcpConnectorManagement(withoutDelete)).toBe(false);

    const disabledSetEnabled = createInventoryCommands(
      { request },
      "s1",
      "p1",
      {
        ...managementCapabilities,
        unsupported: [
          { method: MCP_CONNECTOR_METHODS.SET_ENABLED, reason: "disabled" },
        ],
      },
    );
    await expect(
      disabledSetEnabled.setConnectorEnabled("mcp-1", true),
    ).rejects.toThrow("not advertised");
    expect(request).not.toHaveBeenCalled();

    const readOnly = createInventoryCommands({ request }, "s1", "p1", {
      ...capabilities,
      supported_methods: [APPUI_INVENTORY_METHODS.MCP],
    });
    await expect(readOnly.mcp()).resolves.toMatchObject({
      sessionId: "s1",
      profileId: "p1",
    });
    expect(request).toHaveBeenCalledWith(APPUI_INVENTORY_METHODS.MCP, {
      session_id: "s1",
      profile_id: "p1",
      include_disabled: true,
    });
  });
  it("rejects wrong-scope connector status", async () => {
    const request = vi.fn(async () => ({ ...mcpStatus, profile_id: "other" }));
    const commands = createInventoryCommands(
      { request },
      "s1",
      "p1",
      managementCapabilities,
    );
    await expect(commands.mcp()).rejects.toThrow("wrong-scope");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
