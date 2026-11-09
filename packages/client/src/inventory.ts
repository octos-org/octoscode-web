import { isRecord } from "./rpc.ts";
import { supportsMethod } from "./interaction.ts";
import type { UiProtocolCapabilities } from "./types.ts";
import {
  APPUI_INVENTORY_METHODS,
  MCP_CONNECTOR_METHODS,
  MCP_OAUTH_METHODS,
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
  /**
   * The connector's configured OAuth flag (Core #3145). Absent from older
   * servers, which say nothing about whether a connector signs in.
   */
  oauth?: boolean;
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
  /**
   * Facts the server sent in a shape this client can't trust (T-0138). Not
   * the same as absent: an older server simply omits them, a broken one must
   * not be mistaken for it.
   */
  invalidFacts?: string[];
}
export interface McpConnectorPatch {
  name?: string;
  url?: string;
}
/** A connector as the server saved it, which may not be what it is running. */
export interface McpConnectorSaved {
  id: string;
  name: string;
  transport?: string;
  enabled: boolean;
  url?: string;
  /** Whether the connector signs in with OAuth; says nothing about stored tokens. */
  oauth?: boolean;
}
export interface McpConnectorRuntime {
  /**
   * The server keeps its startup config until it restarts. Core sends
   * `effective_from: "next_turn"` alongside this, but turns do not load the
   * change, so this one wins.
   */
  restartRequired: boolean;
  effectiveFrom?: string;
  error?: string;
}
export interface McpConnectorMutation {
  connector?: McpConnectorSaved;
  runtime?: McpConnectorRuntime;
  created: boolean;
  deleted: boolean;
  /** The server already lists this connector, so nothing is waiting to load. */
  listed: boolean;
  /** `mcp/oauth/complete` saved the sign-in. */
  completed?: boolean;
  /** `mcp/oauth/revoke` removed the stored sign-in. */
  revoked?: boolean;
}
/** An OAuth sign-in the server has started and is waiting to complete. */
export interface McpOAuthStart {
  flowId: string;
  /** Where the person signs in. Checked to be a web page before it is used. */
  authorizationUrl: string;
  redirectUri: string;
  /**
   * `web_origin`: the provider sends the person back to this web app.
   * `manual_callback_url`: back to an address nothing answers on, which the
   * person copies into the page.
   */
  completion: string;
  expiresAt?: string;
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
      (row.oauth !== undefined && typeof row.oauth !== "boolean") ||
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
      ...(typeof row.oauth === "boolean" ? { oauth: row.oauth } : {}),
      ...(text(row.error) ? { error: row.error } : {}),
    });
  }
  // Absent facts mean an older server; present but malformed ones are
  // reported, never silently treated as absent.
  const invalidFacts: string[] = [];
  let management: McpManagementAvailability | undefined;
  if (value.can_manage !== undefined) {
    const parsed = parseManagement(value);
    if (parsed) management = parsed;
    else invalidFacts.push("can_manage");
  }
  let stdioAllowlist: McpStdioAllowlistEntry[] | undefined;
  if (value.stdio_allowlist !== undefined) {
    const parsed = parseStdioAllowlist(value.stdio_allowlist);
    if (parsed) stdioAllowlist = parsed;
    else invalidFacts.push("stdio_allowlist");
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
    ...(management ? { management } : {}),
    ...(stdioAllowlist ? { stdioAllowlist } : {}),
    ...(invalidFacts.length ? { invalidFacts } : {}),
  };
}

/** Null when `can_manage` or its reason has the wrong shape. */
function parseManagement(
  value: Record<string, unknown>,
): McpManagementAvailability | null {
  if (typeof value.can_manage !== "boolean") return null;
  if (value.can_manage) return { canManage: true };
  const reason = value.manage_unavailable_reason;
  if (reason === undefined) return { canManage: false };
  if (!nonempty(reason) || reason.length > 128) return null;
  return { canManage: false, reason };
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
 * Only projected fields enter the UI. The mutation already happened, so a shape
 * this client can't read yields no connector instead of an error.
 */
export function parseMcpConnectorMutation(
  value: unknown,
): McpConnectorMutation {
  if (!isRecord(value))
    return { created: false, deleted: false, listed: false };
  const connector = parseSavedConnector(value.connector);
  const runtime = parseConnectorRuntime(value.runtime);
  return {
    ...(connector ? { connector } : {}),
    ...(runtime ? { runtime } : {}),
    created: value.created === true,
    deleted: value.deleted === true,
    listed: isRecord(value.status),
    ...(value.completed === true ? { completed: true } : {}),
    ...(value.revoked === true ? { revoked: true } : {}),
  };
}

/**
 * The sign-in page is opened in a window, so only a web page is accepted:
 * https, or http on this computer for a local test server.
 */
export function parseMcpOAuthStart(value: unknown): McpOAuthStart | null {
  if (
    !isRecord(value) ||
    !nonempty(value.flow_id) ||
    !nonempty(value.authorization_url) ||
    !nonempty(value.redirect_uri) ||
    !nonempty(value.completion) ||
    !webPage(value.authorization_url)
  )
    return null;
  return {
    flowId: value.flow_id,
    authorizationUrl: value.authorization_url,
    redirectUri: value.redirect_uri,
    completion: value.completion,
    ...(nonempty(value.expires_at) ? { expiresAt: value.expires_at } : {}),
  };
}

function webPage(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  );
}

/** All four, or none: a sign-in that can start must be able to finish and stop. */
export function supportsMcpOAuth(
  capabilities: UiProtocolCapabilities | undefined,
): boolean {
  return Object.values(MCP_OAUTH_METHODS).every((method) =>
    supportsMethod(capabilities, method),
  );
}

function parseSavedConnector(value: unknown): McpConnectorSaved | null {
  if (!isRecord(value) || !nonempty(value.id)) return null;
  const name = nonempty(value.name) ? value.name : value.display_name;
  if (!nonempty(name) || typeof value.enabled !== "boolean") return null;
  return {
    id: value.id,
    name,
    enabled: value.enabled,
    ...(nonempty(value.transport) ? { transport: value.transport } : {}),
    ...(nonempty(value.url) ? { url: value.url } : {}),
    ...(typeof value.oauth === "boolean" ? { oauth: value.oauth } : {}),
  };
}

function parseConnectorRuntime(value: unknown): McpConnectorRuntime | null {
  if (!isRecord(value) || typeof value.restart_required !== "boolean")
    return null;
  return {
    restartRequired: value.restart_required,
    ...(nonempty(value.effective_from)
      ? { effectiveFrom: value.effective_from }
      : {}),
    ...(nonempty(value.runtime_error) ? { error: value.runtime_error } : {}),
  };
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
  ): Promise<McpConnectorMutation> {
    managementAvailable(method);
    // finish_mutation returns one mutated server (or null), not a full
    // mcp/status/list payload; read the inventory with mcp() afterwards. They
    // stay apart because a failed read must not hide a save that went through.
    return parseMcpConnectorMutation(await client.request(method, params));
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
    async createHttpConnector(
      name: string,
      url: string,
    ): Promise<McpConnectorMutation> {
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
    ): Promise<McpConnectorMutation> {
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
    ): Promise<McpConnectorMutation> {
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
    async deleteConnector(connectorId: string): Promise<McpConnectorMutation> {
      if (!nonempty(connectorId)) throw new Error("A connector id is required");
      return manage(MCP_CONNECTOR_METHODS.DELETE, {
        session_id: sessionId,
        connector_id: connectorId,
      });
    },
    async setConnectorEnabled(
      connectorId: string,
      enabled: boolean,
    ): Promise<McpConnectorMutation> {
      if (!nonempty(connectorId) || typeof enabled !== "boolean")
        throw new Error("A connector id and enabled state are required");
      return manage(MCP_CONNECTOR_METHODS.SET_ENABLED, {
        session_id: sessionId,
        connector_id: connectorId,
        enabled,
      });
    },
    async reconnectConnector(
      connectorId: string,
    ): Promise<McpConnectorMutation> {
      if (!nonempty(connectorId)) throw new Error("A connector id is required");
      return manage(MCP_CONNECTOR_METHODS.RECONNECT, {
        session_id: sessionId,
        connector_id: connectorId,
      });
    },
    /** Without a return address the server falls back to a pasted callback. */
    async startOAuth(
      connectorId: string,
      redirectUri?: string,
    ): Promise<McpOAuthStart> {
      if (
        !nonempty(connectorId) ||
        (redirectUri !== undefined && !nonempty(redirectUri))
      )
        throw new Error("A connector id is required");
      managementAvailable(MCP_OAUTH_METHODS.START);
      const result = parseMcpOAuthStart(
        await client.request(MCP_OAUTH_METHODS.START, {
          session_id: sessionId,
          connector_id: connectorId,
          ...(redirectUri === undefined ? {} : { redirect_uri: redirectUri }),
        }),
      );
      if (!result) throw new Error("Invalid OAuth start result");
      return result;
    },
    async completeOAuth(
      flowId: string,
      callbackUrl: string,
    ): Promise<McpConnectorMutation> {
      if (!nonempty(flowId) || !nonempty(callbackUrl))
        throw new Error("A sign-in and its return address are required");
      return manage(MCP_OAUTH_METHODS.COMPLETE, {
        session_id: sessionId,
        flow_id: flowId,
        callback_url: callbackUrl,
      });
    },
    async cancelOAuth(flowId: string): Promise<void> {
      if (!nonempty(flowId)) throw new Error("A sign-in is required");
      managementAvailable(MCP_OAUTH_METHODS.CANCEL);
      await client.request(MCP_OAUTH_METHODS.CANCEL, {
        session_id: sessionId,
        flow_id: flowId,
      });
    },
    async revokeOAuth(connectorId: string): Promise<McpConnectorMutation> {
      if (!nonempty(connectorId)) throw new Error("A connector id is required");
      return manage(MCP_OAUTH_METHODS.REVOKE, {
        session_id: sessionId,
        connector_id: connectorId,
      });
    },
  };
}
