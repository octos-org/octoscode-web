import { isRecord } from "./rpc.ts";
import { supportsMethod } from "./interaction.ts";
import type { UiProtocolCapabilities } from "./types.ts";
import {
  APPUI_INVENTORY_METHODS,
  MCP_CONNECTOR_METHODS,
} from "./inventory-methods.ts";

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
  enabled: boolean;
  authorization?: string;
  toolCount: number;
  tools: string[];
  error?: string;
}
/** One operator-configured stdio entry, as projected by the server (T-0056). */
export interface McpStdioAllowlistEntry {
  entryId: string;
  displayName: string;
  description?: string;
}
/**
 * Whether this requester may run connector mutations, judged by the server
 * with the same checks as the mutations themselves (T-0056).
 */
export interface McpManagementAvailability {
  canManage: boolean;
  /** Present when `canManage` is false, e.g. `requires_profile_write`. */
  reason?: string;
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
  /** Absent on a server without the T-0056 facts: handle refusals passively. */
  management?: McpManagementAvailability;
  /** Absent on a server without the T-0056 facts; `[]` when none is configured. */
  stdioAllowlist?: McpStdioAllowlistEntry[];
}
export interface McpConnectorPatch {
  name?: string;
  url?: string;
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
      (row.enabled !== undefined && typeof row.enabled !== "boolean") ||
      !nullableText(row.authorization) ||
      !nullableText(row.error)
    )
      return null;
    ids.add(row.id);
    servers.push({
      id: row.id,
      status: row.status,
      enabled: row.enabled === undefined ? true : row.enabled,
      toolCount: row.tool_count,
      tools: row.tools,
      ...(text(row.display_name) ? { displayName: row.display_name } : {}),
      ...(text(row.transport) ? { transport: row.transport } : {}),
      ...(text(row.authorization) ? { authorization: row.authorization } : {}),
      ...(text(row.error) ? { error: row.error } : {}),
    });
  }
  const management = parseManagement(value);
  const stdioAllowlist = parseStdioAllowlist(value.stdio_allowlist);
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
    ...(management ? { management } : {}),
    ...(stdioAllowlist ? { stdioAllowlist } : {}),
  };
}

// The T-0056 facts are additive: a malformed one is dropped (the page falls
// back to handling refusals) rather than failing the whole status.
function parseManagement(
  value: Record<string, unknown>,
): McpManagementAvailability | null {
  if (typeof value.can_manage !== "boolean") return null;
  if (value.can_manage) return { canManage: true };
  return {
    canManage: false,
    ...(nonempty(value.manage_unavailable_reason) &&
    value.manage_unavailable_reason.length <= 64
      ? { reason: value.manage_unavailable_reason }
      : {}),
  };
}

/** Only id, label and description enter the UI; nothing else is copied. */
function parseStdioAllowlist(value: unknown): McpStdioAllowlistEntry[] | null {
  if (!Array.isArray(value) || value.length > 1000) return null;
  const ids = new Set<string>();
  const entries: McpStdioAllowlistEntry[] = [];
  for (const row of value) {
    if (
      !isRecord(row) ||
      !nonempty(row.entry_id) ||
      ids.has(row.entry_id) ||
      !nullableText(row.display_name) ||
      !nullableText(row.description)
    )
      return null;
    ids.add(row.entry_id);
    entries.push({
      entryId: row.entry_id,
      displayName: nonempty(row.display_name) ? row.display_name : row.entry_id,
      ...(nonempty(row.description) ? { description: row.description } : {}),
    });
  }
  return entries;
}

/**
 * Core #2912 omits `mcp.connector.manage.v1` from SessionOpened's
 * supported_features even when negotiated. Keep requesting the feature, but
 * treat the five advertised methods as the availability contract.
 */
export function supportsMcpConnectorManagement(
  capabilities: UiProtocolCapabilities | undefined,
): boolean {
  return Object.values(MCP_CONNECTOR_METHODS).every((method) =>
    supportsMethod(capabilities, method),
  );
}

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
  function managementAvailable(method: string) {
    // Core #2912: the method advertisement is authoritative; the negotiated
    // feature is omitted from SessionOpened's supported_features response.
    if (!supportsMethod(capabilities, method))
      throw new Error(`${method} is not advertised by this server`);
    if (!sessionId || !profileId)
      throw new Error("A confirmed session and profile are required");
  }
  async function mcp(): Promise<RuntimeMcp> {
    available(APPUI_INVENTORY_METHODS.MCP);
    const value = await client.request(APPUI_INVENTORY_METHODS.MCP, {
      session_id: sessionId,
      profile_id: profileId,
      include_disabled: true,
    });
    const result = parseRuntimeMcp(value, sessionId, profileId);
    if (!result) throw new Error("Invalid or wrong-scope MCP status");
    return result;
  }
  async function manage(
    method: string,
    params: Record<string, unknown>,
  ): Promise<RuntimeMcp> {
    managementAvailable(method);
    // finish_mutation returns one mutated server (or null), not a full
    // mcp/status/list payload. Refresh the canonical inventory instead.
    await client.request(method, params);
    return mcp();
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
    mcp,
    async createHttpConnector(name: string, url: string): Promise<RuntimeMcp> {
      if (!nonempty(name) || !nonempty(url))
        throw new Error("A connector name and URL are required");
      return manage(MCP_CONNECTOR_METHODS.CREATE, {
        session_id: sessionId,
        connector: { transport: "http", name, url },
      });
    },
    /** Stdio takes only an operator allowlist entry, never a command. */
    async createStdioConnector(
      name: string,
      allowlistEntryId: string,
    ): Promise<RuntimeMcp> {
      if (!nonempty(name) || !nonempty(allowlistEntryId))
        throw new Error("A connector name and allowlist entry are required");
      return manage(MCP_CONNECTOR_METHODS.CREATE, {
        session_id: sessionId,
        connector: {
          transport: "stdio",
          name,
          allowlist_entry_id: allowlistEntryId,
        },
      });
    },
    async updateConnector(
      connectorId: string,
      patch: McpConnectorPatch,
    ): Promise<RuntimeMcp> {
      if (
        !nonempty(connectorId) ||
        !isRecord(patch) ||
        (patch.name !== undefined && !nonempty(patch.name)) ||
        (patch.url !== undefined && !nonempty(patch.url))
      )
        throw new Error("A valid connector id and patch are required");
      return manage(MCP_CONNECTOR_METHODS.UPDATE, {
        session_id: sessionId,
        connector_id: connectorId,
        patch: {
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.url === undefined ? {} : { url: patch.url }),
        },
      });
    },
    async deleteConnector(connectorId: string): Promise<RuntimeMcp> {
      if (!nonempty(connectorId)) throw new Error("A connector id is required");
      return manage(MCP_CONNECTOR_METHODS.DELETE, {
        session_id: sessionId,
        connector_id: connectorId,
      });
    },
    async setConnectorEnabled(
      connectorId: string,
      enabled: boolean,
    ): Promise<RuntimeMcp> {
      if (!nonempty(connectorId) || typeof enabled !== "boolean")
        throw new Error("A connector id and enabled state are required");
      return manage(MCP_CONNECTOR_METHODS.SET_ENABLED, {
        session_id: sessionId,
        connector_id: connectorId,
        enabled,
      });
    },
    async reconnectConnector(connectorId: string): Promise<RuntimeMcp> {
      if (!nonempty(connectorId)) throw new Error("A connector id is required");
      return manage(MCP_CONNECTOR_METHODS.RECONNECT, {
        session_id: sessionId,
        connector_id: connectorId,
      });
    },
  };
}
