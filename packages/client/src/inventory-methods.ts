// Narrow AppUI status extensions, audited against Core rc11.
export const APPUI_INVENTORY_METHODS = {
  TOOLS: "tool/status/list",
  MCP: "mcp/status/list",
} as const;

export const MCP_CONNECTOR_METHODS = {
  CREATE: "mcp/connector/create",
  UPDATE: "mcp/connector/update",
  DELETE: "mcp/connector/delete",
  SET_ENABLED: "mcp/connector/set_enabled",
  RECONNECT: "mcp/connector/reconnect",
} as const;

/** Request during negotiation; Core #2912 omits this from SessionOpened's response. */
export const MCP_CONNECTOR_MANAGE_V1 = "mcp.connector.manage.v1";
