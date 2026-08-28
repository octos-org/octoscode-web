import type { ConnectionDraft } from "./ConnectionPanel.tsx";

const DURABLE_KEY = "octoscode-web.connection.v2";
const LEGACY_DURABLE_KEY = "octoscode-web.connection.v1";
const TAB_STATE_KEY = "octoscode-web.tab-connection.v2";
const LEGACY_TAB_TOKEN_KEY = "octoscode-web.connection-token.v1";
const LEGACY_TAB_AUTO_CONNECT_KEY = "octoscode-web.auto-connect.v1";
const LEGACY_TAB_SESSION_KEY = "octoscode-web.active-session.v1";

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
  version: 2;
  endpoint: string;
}

interface TabConnectionPreferences {
  version: 2;
  endpoint: string;
  token: string;
  sessionId: string;
  profileId: string;
  cwd: string;
  autoConnect: boolean;
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
  const tab = readTabConnection(tabStorage);
  return {
    endpoint:
      bounded(tab?.endpoint, LIMITS.endpoint) ??
      bounded(durable?.endpoint, LIMITS.endpoint) ??
      defaults.endpoint,
    token: bounded(tab?.token, LIMITS.token) ?? "",
    sessionId: bounded(tab?.sessionId, LIMITS.sessionId) ?? defaults.sessionId,
    profileId: bounded(tab?.profileId, LIMITS.profileId) ?? defaults.profileId,
    cwd: bounded(tab?.cwd, LIMITS.cwd) ?? defaults.cwd,
  };
}

export function saveConnectionPreferences(
  value: ConnectionDraft,
  durableStorage: StorageLike,
  tabStorage: StorageLike,
): void {
  const durable: DurableConnectionPreferences = {
    version: 2,
    endpoint: value.endpoint.slice(0, LIMITS.endpoint),
  };
  const previous = readTabConnection(tabStorage);
  const tab: TabConnectionPreferences = {
    version: 2,
    endpoint: value.endpoint.slice(0, LIMITS.endpoint),
    token: value.token.slice(0, LIMITS.token),
    sessionId: value.sessionId.slice(0, LIMITS.sessionId),
    profileId: value.profileId.slice(0, LIMITS.profileId),
    cwd: value.cwd.slice(0, LIMITS.cwd),
    autoConnect:
      previous?.endpoint === value.endpoint &&
      previous.token === value.token &&
      previous.autoConnect,
  };
  safely(() => durableStorage.setItem(DURABLE_KEY, JSON.stringify(durable)));
  safely(() => durableStorage.removeItem(LEGACY_DURABLE_KEY));
  writeTabConnection(tabStorage, tab);
  clearLegacyTabState(tabStorage);
}

export function clearConnectionPreferences(
  durableStorage: StorageLike,
  tabStorage: StorageLike,
): void {
  safely(() => durableStorage.removeItem(DURABLE_KEY));
  safely(() => durableStorage.removeItem(LEGACY_DURABLE_KEY));
  safely(() => tabStorage.removeItem(TAB_STATE_KEY));
  clearLegacyTabState(tabStorage);
}

export function loadAutoConnect(tabStorage: StorageLike): boolean {
  return readTabConnection(tabStorage)?.autoConnect === true;
}

export function setAutoConnect(
  tabStorage: StorageLike,
  enabled: boolean,
): void {
  const current = readTabConnection(tabStorage);
  if (current) {
    writeTabConnection(tabStorage, { ...current, autoConnect: enabled });
  }
  clearLegacyTabState(tabStorage);
}

function readDurable(
  storage: StorageLike,
): DurableConnectionPreferences | null {
  const raw = safely(() => storage.getItem(DURABLE_KEY));
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 2) return null;
    const endpoint = bounded(value.endpoint, LIMITS.endpoint);
    return endpoint === undefined ? null : { version: 2, endpoint };
  } catch {
    return null;
  }
}

function readTabConnection(
  storage: StorageLike,
): TabConnectionPreferences | null {
  const raw = safely(() => storage.getItem(TAB_STATE_KEY));
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 2) return null;
    const endpoint = bounded(value.endpoint, LIMITS.endpoint);
    const token = bounded(value.token, LIMITS.token);
    const sessionId = bounded(value.sessionId, LIMITS.sessionId);
    const profileId = bounded(value.profileId, LIMITS.profileId);
    const cwd = bounded(value.cwd, LIMITS.cwd);
    if (
      endpoint === undefined ||
      token === undefined ||
      sessionId === undefined ||
      profileId === undefined ||
      cwd === undefined ||
      typeof value.autoConnect !== "boolean"
    ) {
      return null;
    }
    return {
      version: 2,
      endpoint,
      token,
      sessionId,
      profileId,
      cwd,
      autoConnect: value.autoConnect,
    };
  } catch {
    return null;
  }
}

function writeTabConnection(
  storage: StorageLike,
  value: TabConnectionPreferences,
): void {
  safely(() => storage.setItem(TAB_STATE_KEY, JSON.stringify(value)));
}

function clearLegacyTabState(storage: StorageLike): void {
  safely(() => storage.removeItem(LEGACY_TAB_TOKEN_KEY));
  safely(() => storage.removeItem(LEGACY_TAB_AUTO_CONNECT_KEY));
  safely(() => storage.removeItem(LEGACY_TAB_SESSION_KEY));
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
