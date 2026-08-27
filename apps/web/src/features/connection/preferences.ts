import type { ConnectionDraft } from "./ConnectionPanel.tsx";

const DURABLE_KEY = "octoscode-web.connection.v1";
const TAB_TOKEN_KEY = "octoscode-web.connection-token.v1";
const TAB_AUTO_CONNECT_KEY = "octoscode-web.auto-connect.v1";

const LIMITS = {
  endpoint: 2_048,
  token: 16_384,
  sessionId: 1_024,
  profileId: 512,
  cwd: 4_096,
} as const;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface DurableConnectionPreferences {
  version: 1;
  endpoint: string;
  sessionId: string;
  profileId: string;
  cwd: string;
}

/**
 * Restore connection intent without making browser storage authoritative.
 *
 * Server identity and workspace validation still happen during session/open.
 * The credential is deliberately read only from tab-scoped sessionStorage.
 */
export function loadConnectionPreferences(
  defaults: ConnectionDraft,
  durableStorage: StorageLike,
  tabStorage: StorageLike,
): ConnectionDraft {
  const durable = readDurable(durableStorage);
  return {
    endpoint: bounded(durable?.endpoint, LIMITS.endpoint) ?? defaults.endpoint,
    token: readBounded(tabStorage, TAB_TOKEN_KEY, LIMITS.token) ?? "",
    sessionId:
      bounded(durable?.sessionId, LIMITS.sessionId) ?? defaults.sessionId,
    profileId:
      bounded(durable?.profileId, LIMITS.profileId) ?? defaults.profileId,
    cwd: bounded(durable?.cwd, LIMITS.cwd) ?? defaults.cwd,
  };
}

export function saveConnectionPreferences(
  value: ConnectionDraft,
  durableStorage: StorageLike,
  tabStorage: StorageLike,
): void {
  const durable: DurableConnectionPreferences = {
    version: 1,
    endpoint: value.endpoint.slice(0, LIMITS.endpoint),
    sessionId: value.sessionId.slice(0, LIMITS.sessionId),
    profileId: value.profileId.slice(0, LIMITS.profileId),
    cwd: value.cwd.slice(0, LIMITS.cwd),
  };
  safely(() => durableStorage.setItem(DURABLE_KEY, JSON.stringify(durable)));
  safely(() => {
    if (value.token) {
      tabStorage.setItem(TAB_TOKEN_KEY, value.token.slice(0, LIMITS.token));
    } else {
      tabStorage.removeItem(TAB_TOKEN_KEY);
    }
  });
}

export function clearConnectionPreferences(
  durableStorage: StorageLike,
  tabStorage: StorageLike,
): void {
  safely(() => durableStorage.removeItem(DURABLE_KEY));
  safely(() => tabStorage.removeItem(TAB_TOKEN_KEY));
  setAutoConnect(tabStorage, false);
}

export function loadAutoConnect(tabStorage: StorageLike): boolean {
  return safely(() => tabStorage.getItem(TAB_AUTO_CONNECT_KEY)) === "1";
}

export function setAutoConnect(
  tabStorage: StorageLike,
  enabled: boolean,
): void {
  safely(() => {
    if (enabled) tabStorage.setItem(TAB_AUTO_CONNECT_KEY, "1");
    else tabStorage.removeItem(TAB_AUTO_CONNECT_KEY);
  });
}

function readDurable(
  storage: StorageLike,
): DurableConnectionPreferences | null {
  const raw = safely(() => storage.getItem(DURABLE_KEY));
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1) return null;
    const endpoint = bounded(value.endpoint, LIMITS.endpoint);
    const sessionId = bounded(value.sessionId, LIMITS.sessionId);
    const profileId = bounded(value.profileId, LIMITS.profileId);
    const cwd = bounded(value.cwd, LIMITS.cwd);
    if (
      endpoint === undefined ||
      sessionId === undefined ||
      profileId === undefined ||
      cwd === undefined
    ) {
      return null;
    }
    return { version: 1, endpoint, sessionId, profileId, cwd };
  } catch {
    return null;
  }
}

function readBounded(
  storage: StorageLike,
  key: string,
  limit: number,
): string | undefined {
  return bounded(
    safely(() => storage.getItem(key)),
    limit,
  );
}

function bounded(value: unknown, limit: number): string | undefined {
  return typeof value === "string" && value.length <= limit ? value : undefined;
}

function safely<T>(operation: () => T): T | undefined {
  try {
    return operation();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
