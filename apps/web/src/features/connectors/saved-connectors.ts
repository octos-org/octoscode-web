import type {
  McpConnectorMutation,
  RuntimeMcpServer,
} from "@octos-org/octoscode-client/inventory";

/**
 * A connector the server has saved but does not list yet. mcp/status/list only
 * shows what the running server loaded, and Core has no method that lists saved
 * config, so this page is the only place that knows about it. It lives in memory:
 * a page refresh loses the row, and the page says so.
 */
export interface SavedConnector {
  id: string;
  name: string;
  transport?: string;
  enabled: boolean;
  url?: string;
  takesEffect: "restart" | "next_turn" | "unknown";
  /** Why the server could not load it just now. */
  error?: string;
}

const savedByConnection = new WeakMap<
  object,
  Map<string, readonly SavedConnector[]>
>();

/** Per connection and profile, so another server's or profile's rows never show. */
export function readSavedConnectors(
  connection: object,
  profileId: string,
): readonly SavedConnector[] {
  return savedByConnection.get(connection)?.get(profileId) ?? [];
}

export function writeSavedConnectors(
  connection: object,
  profileId: string,
  saved: readonly SavedConnector[],
): void {
  let byProfile = savedByConnection.get(connection);
  if (!byProfile) {
    byProfile = new Map();
    savedByConnection.set(connection, byProfile);
  }
  byProfile.set(profileId, saved);
}

function takesEffect(
  runtime: McpConnectorMutation["runtime"],
): SavedConnector["takesEffect"] {
  if (runtime?.restartRequired) return "restart";
  return runtime?.effectiveFrom === "next_turn" ? "next_turn" : "unknown";
}

/**
 * The rows after a mutation the server accepted. Only the server's own answer
 * adds a row, so a refused create never leaves one behind.
 */
export function afterMutation(
  saved: readonly SavedConnector[],
  mutation: McpConnectorMutation,
  connectorId?: string,
): readonly SavedConnector[] {
  if (mutation.deleted) return saved.filter((row) => row.id !== connectorId);
  const { connector } = mutation;
  if (!connector) return saved;
  if (mutation.listed) return saved.filter((row) => row.id !== connector.id);
  const known = saved.some((row) => row.id === connector.id);
  if (!known && !mutation.created) return saved;
  const row: SavedConnector = {
    id: connector.id,
    name: connector.name,
    enabled: connector.enabled,
    ...(connector.transport ? { transport: connector.transport } : {}),
    ...(connector.url ? { url: connector.url } : {}),
    takesEffect: takesEffect(mutation.runtime),
    ...(mutation.runtime?.error ? { error: mutation.runtime.error } : {}),
  };
  return known
    ? saved.map((item) => (item.id === connector.id ? row : item))
    : [...saved, row];
}

/** Once the server lists a connector, its own row tells the truth about it. */
export function withoutListed(
  saved: readonly SavedConnector[],
  servers: readonly RuntimeMcpServer[],
): readonly SavedConnector[] {
  const remaining = saved.filter(
    (row) => !servers.some((server) => server.id === row.id),
  );
  return remaining.length === saved.length ? saved : remaining;
}
