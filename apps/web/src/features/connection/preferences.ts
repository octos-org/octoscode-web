import type { ConnectionDraft } from "./ConnectionPanel.tsx";
import { isRecord } from "../../shared/guards.ts";
import type { SessionOpened } from "@octos-org/octoscode-client/protocol";
import { connectionEndpointError } from "./validation.ts";
import {
  parseSessionDrafts,
  type SessionDraftRecord,
} from "../session/session-draft-cache.ts";
import {
  parseKnownSessionRegistry,
  rememberKnownSession as rememberRegistrySession,
  type KnownSessionRef,
} from "../session/known-session-registry.ts";

const DURABLE_KEY = "octoscode-web.connection.v2";
const LEGACY_DURABLE_KEY = "octoscode-web.connection.v1";
const TAB_STATE_KEY = "octoscode-web.tab-connection.v3";
const LEGACY_TAB_STATE_KEY = "octoscode-web.tab-connection.v2";
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

const UNAVAILABLE_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/** The browser can deny access to the storage property itself. */
export function browserStorage(
  kind: "localStorage" | "sessionStorage",
): StorageLike {
  try {
    return window[kind];
  } catch {
    return UNAVAILABLE_STORAGE;
  }
}

interface DurableConnectionPreferences {
  version: 2;
  endpoint: string;
}

interface TabConnectionPreferences {
  version: 3;
  endpoint: string;
  token: string;
  sessionId: string;
  profileId: string;
  cwd: string;
  autoConnect: boolean;
  knownSessions: KnownSessionRef[];
  composerDrafts: SessionDraftRecord[];
  draftPrincipal?: string | undefined;
}

type ConnectionIdentity = Pick<ConnectionDraft, "endpoint" | "token">;

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
  // App saves drafts as they change, before form submission. Never persist a
  // pasted credential-bearing URL, and do not auto-connect an old draft after
  // the user has started replacing its address.
  if (connectionEndpointError(value.endpoint)) {
    setAutoConnect(tabStorage, false);
    return;
  }
  const durable: DurableConnectionPreferences = {
    version: 2,
    endpoint: value.endpoint.slice(0, LIMITS.endpoint),
  };
  const previous = readTabConnection(tabStorage);
  const endpoint = value.endpoint.slice(0, LIMITS.endpoint);
  const token = value.token.slice(0, LIMITS.token);
  const sameIdentity =
    value.endpoint.length <= LIMITS.endpoint &&
    value.token.length <= LIMITS.token &&
    previous?.endpoint === endpoint &&
    previous.token === token;
  const tab: TabConnectionPreferences = {
    version: 3,
    endpoint,
    token,
    sessionId: value.sessionId.slice(0, LIMITS.sessionId),
    profileId: value.profileId.slice(0, LIMITS.profileId),
    cwd: value.cwd.slice(0, LIMITS.cwd),
    autoConnect: Boolean(sameIdentity && previous?.autoConnect),
    // One envelope write changes the credential identity and invalidates its
    // tab-known Session projection together. No token is copied into an entry.
    knownSessions: sameIdentity ? previous.knownSessions : [],
    composerDrafts: sameIdentity ? previous.composerDrafts : [],
    draftPrincipal: sameIdentity ? previous.draftPrincipal : undefined,
  };
  safely(() => durableStorage.setItem(DURABLE_KEY, JSON.stringify(durable)));
  safely(() => durableStorage.removeItem(LEGACY_DURABLE_KEY));
  writeTabConnection(tabStorage, tab);
  clearLegacyTabState(tabStorage);
}

export function clearConnectionPreferences(
  durableStorage: StorageLike,
  tabStorage: StorageLike,
): boolean {
  const durableCleared = removeStoredKeys(durableStorage, [
    DURABLE_KEY,
    LEGACY_DURABLE_KEY,
  ]);
  const tabCleared = removeStoredKeys(tabStorage, [
    TAB_STATE_KEY,
    LEGACY_TAB_STATE_KEY,
    LEGACY_TAB_TOKEN_KEY,
    LEGACY_TAB_AUTO_CONNECT_KEY,
    LEGACY_TAB_SESSION_KEY,
  ]);
  return durableCleared && tabCleared;
}

/** A swallowed removal error is not evidence that credentials were forgotten. */
function removeStoredKeys(
  storage: StorageLike,
  keys: readonly string[],
): boolean {
  let cleared = storage !== UNAVAILABLE_STORAGE;
  for (const key of keys) {
    safely(() => storage.removeItem(key));
    if (safely(() => storage.getItem(key)) !== null) cleared = false;
  }
  return cleared;
}

/**
 * Read the Sessions confirmed for exactly this tab credential identity.
 * Callers should render this only after the same identity authenticates.
 */
export function loadKnownSessions(
  tabStorage: StorageLike,
  identity: ConnectionIdentity,
): KnownSessionRef[] {
  const current = readTabConnection(tabStorage);
  return current && matchesIdentity(current, identity)
    ? [...current.knownSessions]
    : [];
}

/**
 * Remember one committed, healthy session/open result for this tab identity.
 * A missing server profile/workspace echo is not accepted as scope proof.
 */
export function rememberKnownSession(
  tabStorage: StorageLike,
  identity: ConnectionIdentity,
  opened: SessionOpened,
  now = Date.now(),
): KnownSessionRef[] {
  const current = readTabConnection(tabStorage);
  if (!current || !matchesIdentity(current, identity)) return [];
  const knownSessions = rememberRegistrySession(
    current.knownSessions,
    opened,
    now,
  );
  writeTabConnection(tabStorage, { ...current, knownSessions });
  return knownSessions;
}

/** Clear only the registry belonging to the supplied current identity. */
export function clearKnownSessions(
  tabStorage: StorageLike,
  identity: ConnectionIdentity,
): void {
  const current = readTabConnection(tabStorage);
  if (!current || !matchesIdentity(current, identity)) return;
  writeTabConnection(tabStorage, { ...current, knownSessions: [] });
}

/**
 * The last origin this browser actually saved, or null when this is a first
 * visit. WEB-PAIRING-CONTRACT-5100 §Discovery probes exactly this address and
 * nothing else — never the configured default, and never a range of ports.
 */
export function loadDurableEndpoint(
  durableStorage: StorageLike,
): string | null {
  return readDurable(durableStorage)?.endpoint ?? null;
}

export function loadAutoConnect(tabStorage: StorageLike): boolean {
  return readTabConnection(tabStorage)?.autoConnect === true;
}

export function loadComposerDrafts(
  tabStorage: StorageLike,
  identity: ConnectionIdentity,
): SessionDraftRecord[] {
  const current = readTabConnection(tabStorage);
  return current && matchesIdentity(current, identity)
    ? current.composerDrafts
    : [];
}

/** Remember only for offline Forget; restoring drafts still requires REST auth. */
export function loadDraftPrincipal(
  tabStorage: StorageLike,
  identity: ConnectionIdentity,
): string | null {
  const current = readTabConnection(tabStorage);
  return current && matchesIdentity(current, identity)
    ? (current.draftPrincipal ?? null)
    : null;
}

export function rememberDraftPrincipal(
  tabStorage: StorageLike,
  identity: ConnectionIdentity,
  principal: string,
): void {
  const current = readTabConnection(tabStorage);
  if (current && matchesIdentity(current, identity)) {
    writeTabConnection(tabStorage, { ...current, draftPrincipal: principal });
  }
}

/** Unsent text only; never restore or dispatch a server-owned turn. */
export function saveComposerDrafts(
  tabStorage: StorageLike,
  identity: ConnectionIdentity,
  drafts: SessionDraftRecord[],
): boolean {
  const current = readTabConnection(tabStorage);
  if (!current || !matchesIdentity(current, identity)) return false;
  const parsed = parseSessionDrafts(drafts);
  if (parsed.length !== drafts.length) return false;
  const value = { ...current, composerDrafts: parsed };
  writeTabConnection(tabStorage, value);
  return (
    safely(() => tabStorage.getItem(TAB_STATE_KEY)) === JSON.stringify(value)
  );
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
    return endpoint === undefined || connectionEndpointError(endpoint)
      ? null
      : { version: 2, endpoint };
  } catch {
    return null;
  }
}

function readTabConnection(
  storage: StorageLike,
): TabConnectionPreferences | null {
  const raw =
    safely(() => storage.getItem(TAB_STATE_KEY)) ??
    safely(() => storage.getItem(LEGACY_TAB_STATE_KEY));
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || (value.version !== 2 && value.version !== 3)) {
      return null;
    }
    const endpoint = bounded(value.endpoint, LIMITS.endpoint);
    const token = bounded(value.token, LIMITS.token);
    const sessionId = bounded(value.sessionId, LIMITS.sessionId);
    const profileId = bounded(value.profileId, LIMITS.profileId);
    const cwd = bounded(value.cwd, LIMITS.cwd);
    if (
      endpoint === undefined ||
      connectionEndpointError(endpoint) ||
      token === undefined ||
      sessionId === undefined ||
      profileId === undefined ||
      cwd === undefined ||
      typeof value.autoConnect !== "boolean"
    ) {
      return null;
    }
    return {
      version: 3,
      endpoint,
      token,
      sessionId,
      profileId,
      cwd,
      autoConnect: value.autoConnect,
      knownSessions:
        value.version === 3
          ? parseKnownSessionRegistry(value.knownSessions)
          : [],
      composerDrafts: parseSessionDrafts(value.composerDrafts),
      draftPrincipal: bounded(value.draftPrincipal, 1_024) || undefined,
    };
  } catch {
    return null;
  }
}

function writeTabConnection(
  storage: StorageLike,
  value: TabConnectionPreferences,
): void {
  try {
    storage.setItem(TAB_STATE_KEY, JSON.stringify(value));
  } catch {
    return;
  }
  safely(() => storage.removeItem(LEGACY_TAB_STATE_KEY));
}

function matchesIdentity(
  current: TabConnectionPreferences,
  identity: ConnectionIdentity,
): boolean {
  if (
    identity.endpoint.length > LIMITS.endpoint ||
    identity.token.length > LIMITS.token
  ) {
    return false;
  }
  return (
    current.endpoint === identity.endpoint && current.token === identity.token
  );
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
