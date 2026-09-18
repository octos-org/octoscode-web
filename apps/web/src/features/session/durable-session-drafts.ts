import { connectionEndpointError } from "../connection/validation.ts";
import {
  parseSessionDrafts,
  type SessionDraftRecord,
} from "./session-draft-cache.ts";

const PREFIX = "octoscode-web.draft.v1:";

/** REST auth/me identifies the user; the WebSocket method only echoes a profile. */
export async function resolveDraftPrincipal(
  endpoint: string,
  token: string,
  signal: AbortSignal,
): Promise<string | null> {
  if (connectionEndpointError(endpoint)) return null;
  const response = await fetch(`${serverOrigin(endpoint)}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token.trim()}` },
    credentials: "omit",
    signal,
  });
  if (!response.ok) return null;
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || !("user" in value)) return null;
  const user = value.user;
  if (!user || typeof user !== "object" || !("id" in user)) return null;
  return typeof user.id === "string" &&
    user.id.trim() &&
    user.id.length <= 1_024
    ? user.id
    : null;
}

export function durableDraftScope(endpoint: string, principal: string): string {
  return `${PREFIX}${JSON.stringify([serverOrigin(endpoint), principal])}:`;
}

export function loadDurableDrafts(scope: string): SessionDraftRecord[] | null {
  try {
    const storage = window.localStorage;
    const drafts: SessionDraftRecord[] = [];
    for (const key of storedKeys(storage, scope)) {
      drafts.push([key.slice(scope.length), JSON.parse(storage.getItem(key)!)]);
    }
    // Concurrent tabs can briefly exceed the write limit. Keep their valid
    // records readable; SessionDraftCache still bounds the in-memory projection.
    return drafts.every((draft) => parseSessionDrafts([draft]).length === 1)
      ? drafts
      : null;
  } catch {
    return null;
  }
}

/** Write only this Session: another tab may have edited any of the others. */
export function saveDurableDraft(
  scope: string,
  sessionKey: string,
  text: string,
): boolean {
  try {
    const storage = window.localStorage;
    const key = scope + sessionKey;
    if (!text) {
      storage.removeItem(key);
      return storage.getItem(key) === null;
    }
    const drafts = loadDurableDrafts(scope);
    if (!drafts) return false;
    const next = drafts.filter(([key]) => key !== sessionKey);
    next.push([sessionKey, text]);
    if (parseSessionDrafts(next).length !== next.length) return false;
    const value = JSON.stringify(text);
    storage.setItem(key, value);
    return storage.getItem(key) === value;
  } catch {
    return false;
  }
}

export function clearDurableDrafts(scope: string): boolean {
  try {
    const storage = window.localStorage;
    for (const key of storedKeys(storage, scope)) storage.removeItem(key);
    return storedKeys(storage, scope).length === 0;
  } catch {
    return false;
  }
}

function storedKeys(storage: Storage, scope: string): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(scope)) keys.push(key);
  }
  return keys;
}

function serverOrigin(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  return url.origin;
}
