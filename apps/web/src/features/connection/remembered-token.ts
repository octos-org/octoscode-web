/**
 * WEB-PAIRING-CONTRACT-5100 §Remembering — the per-device half of token
 * storage. "Remember on this device" puts the token in localStorage under the
 * existing per-origin key shape; unchecked it stays in sessionStorage exactly
 * as today. Every access here is guarded, and a write that cannot be read back
 * reports failure so the caller can degrade to in-memory WITH a notice instead
 * of silently losing the credential.
 */
import type { StorageLike } from "./preferences.ts";

const STORAGE_PREFIX = "octoscode-web.remembered-token.v1";
const MAX_TOKEN_LENGTH = 16_384;

/** Which storage actually holds the token right now. */
export type TokenStorageKind = "device" | "tab" | "memory";

export function rememberedTokenKey(endpoint: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(endpoint.trim())}`;
}

export function loadRememberedToken(
  storage: StorageLike,
  endpoint: string,
): string | null {
  if (!endpoint.trim()) return null;
  try {
    const raw = storage.getItem(rememberedTokenKey(endpoint));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1) return null;
    const token = value.token;
    return typeof token === "string" &&
      token.length > 0 &&
      token.length <= MAX_TOKEN_LENGTH
      ? token
      : null;
  } catch {
    return null;
  }
}

/**
 * Persist the token for this origin. A storage that silently drops the write
 * (a denied `localStorage` property degrades to a no-op shim) is NOT
 * persistence, so the value is read back before reporting success.
 */
export function rememberToken(
  storage: StorageLike,
  endpoint: string,
  token: string,
): boolean {
  if (!endpoint.trim() || !token || token.length > MAX_TOKEN_LENGTH) {
    return false;
  }
  const key = rememberedTokenKey(endpoint);
  const payload = JSON.stringify({ version: 1, token });
  try {
    storage.setItem(key, payload);
    return storage.getItem(key) === payload;
  } catch {
    return false;
  }
}

/** True only when the key is provably gone afterwards. */
export function forgetRememberedToken(
  storage: StorageLike,
  endpoint: string,
): boolean {
  const key = rememberedTokenKey(endpoint);
  try {
    storage.removeItem(key);
    return storage.getItem(key) === null;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
