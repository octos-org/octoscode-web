import { describe, expect, it, vi } from "vitest";
import {
  parseRuntimeTools,
  parseRuntimeMcp,
  createInventoryCommands,
} from "../src/inventory.ts";
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
    ).toEqual({ id: "mcp-1", status: "disabled", toolCount: 0, tools: [] });
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
});
