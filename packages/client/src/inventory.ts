import { isRecord } from "./rpc.ts";
import { supportsMethod } from "./interaction.ts";
import type { UiProtocolCapabilities } from "./types.ts";
import { APPUI_INVENTORY_METHODS } from "./inventory-methods.ts";

export interface RuntimeTool {
  name: string;
  category: string;
  status: string;
  policy: string;
  aliases: string[];
  backendTool?: string;
  detail?: string;
}
export interface RuntimeTools {
  sessionId: string;
  profileId: string;
  policyId: string;
  tools: RuntimeTool[];
}
export interface RuntimeMcpServer {
  id: string;
  displayName?: string;
  transport?: string;
  status: string;
  toolCount: number;
  tools: string[];
  error?: string;
}
export interface RuntimeMcp {
  sessionId: string;
  profileId: string;
  servers: RuntimeMcpServer[];
  summary: {
    connected: number;
    connecting: number;
    failed: number;
    disabled: number;
  };
}

const text = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 4096;
const nonempty = (value: unknown): value is string =>
  text(value) && value.length > 0;
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const nullableText = (value: unknown) => value == null || text(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 10000 && value.every(text);

/** Only projected status fields enter the UI; arbitrary config/secret fields are discarded. */
export function parseRuntimeTools(
  value: unknown,
  sessionId: string,
  profileId: string,
): RuntimeTools | null {
  if (
    !isRecord(value) ||
    value.session_id !== sessionId ||
    value.profile_id !== profileId ||
    !text(value.policy_id) ||
    !Array.isArray(value.tools) ||
    value.tools.length > 10000
  )
    return null;
  const names = new Set<string>();
  const tools: RuntimeTool[] = [];
  for (const row of value.tools) {
    if (
      !isRecord(row) ||
      !nonempty(row.name) ||
      names.has(row.name) ||
      !text(row.category) ||
      !text(row.status) ||
      !text(row.policy) ||
      !strings(row.aliases) ||
      !nullableText(row.backend_tool) ||
      !nullableText(row.detail)
    )
      return null;
    names.add(row.name);
    tools.push({
      name: row.name,
      category: row.category,
      status: row.status,
      policy: row.policy,
      aliases: row.aliases,
      ...(text(row.backend_tool) ? { backendTool: row.backend_tool } : {}),
      ...(text(row.detail) ? { detail: row.detail } : {}),
    });
  }
  return { sessionId, profileId, policyId: value.policy_id, tools };
}

export function parseRuntimeMcp(
  value: unknown,
  sessionId: string,
  profileId: string,
): RuntimeMcp | null {
  if (
    !isRecord(value) ||
    value.session_id !== sessionId ||
    value.profile_id !== profileId ||
    !Array.isArray(value.servers) ||
    value.servers.length > 10000 ||
    !isRecord(value.summary)
  )
    return null;
  const summary = value.summary;
  if (
    !count(summary.connected) ||
    !count(summary.connecting) ||
    !count(summary.failed) ||
    !count(summary.disabled)
  )
    return null;
  const ids = new Set<string>();
  const servers: RuntimeMcpServer[] = [];
  for (const row of value.servers) {
    if (
      !isRecord(row) ||
      !nonempty(row.id) ||
      ids.has(row.id) ||
      !text(row.status) ||
      !count(row.tool_count) ||
      !strings(row.tools) ||
      !nullableText(row.display_name) ||
      !nullableText(row.transport) ||
      !nullableText(row.error)
    )
      return null;
    ids.add(row.id);
    servers.push({
      id: row.id,
      status: row.status,
      toolCount: row.tool_count,
      tools: row.tools,
      ...(text(row.display_name) ? { displayName: row.display_name } : {}),
      ...(text(row.transport) ? { transport: row.transport } : {}),
      ...(text(row.error) ? { error: row.error } : {}),
    });
  }
  return {
    sessionId,
    profileId,
    servers,
    summary: {
      connected: summary.connected,
      connecting: summary.connecting,
      failed: summary.failed,
      disabled: summary.disabled,
    },
  };
}

/** Read-only. rc11 has no MCP/tool configuration mutation API. */
export function createInventoryCommands(
  client: { request(method: string, params: unknown): Promise<unknown> },
  sessionId: string,
  profileId: string,
  capabilities: UiProtocolCapabilities,
) {
  function available(method: string) {
    if (!supportsMethod(capabilities, method))
      throw new Error(`${method} is not advertised by this server`);
    if (!sessionId || !profileId)
      throw new Error("A confirmed session and profile are required");
  }
  return {
    async tools(): Promise<RuntimeTools> {
      available(APPUI_INVENTORY_METHODS.TOOLS);
      const value = await client.request(APPUI_INVENTORY_METHODS.TOOLS, {
        session_id: sessionId,
        profile_id: profileId,
        include_denied: true,
      });
      const result = parseRuntimeTools(value, sessionId, profileId);
      if (!result) throw new Error("Invalid or wrong-scope tool status");
      return result;
    },
    async mcp(): Promise<RuntimeMcp> {
      available(APPUI_INVENTORY_METHODS.MCP);
      const value = await client.request(APPUI_INVENTORY_METHODS.MCP, {
        session_id: sessionId,
        profile_id: profileId,
        include_disabled: true,
      });
      const result = parseRuntimeMcp(value, sessionId, profileId);
      if (!result) throw new Error("Invalid or wrong-scope MCP status");
      return result;
    },
  };
}
