import type { StorageLike } from "../connection/preferences.ts";

/**
 * §4.4 / §7 "New-session defaults": the profile-level model is SERVER state;
 * the permission mode and sandbox are THIS BROWSER's preference (localStorage,
 * endpoint-scoped), applied at CREATION only — sandbox into `session/open`,
 * one `permission/profile/set` right after creation. Re-opening an existing
 * session NEVER re-applies them.
 */

export const DEFAULTS_PREFERENCES_KEY = "octoscode-web.session-defaults.v1";

const MAX_READ_ALLOW_PATHS = 16;
const MAX_PATH_LENGTH = 4_096;

export type DefaultsPermissionMode =
  | "read_only"
  | "workspace_write"
  | "danger_full_access";

export type DefaultsNetworkPolicy = "deny" | "allow";

/** The `session/open` sandbox params (feature session.sandbox.v1), narrowed. */
export interface DefaultsSandbox {
  enabled: boolean;
  networkAccess: boolean;
  readAllowPaths: string[];
}

export interface SessionDefaults {
  permissionMode: DefaultsPermissionMode;
  network: DefaultsNetworkPolicy;
  sandbox: DefaultsSandbox;
}

interface StoredDefaults {
  version: 1;
  permissionMode: string;
  network: string;
  sandbox: {
    enabled: boolean;
    networkAccess: boolean;
    readAllowPaths: string[];
  };
}

const MODES: readonly DefaultsPermissionMode[] = [
  "read_only",
  "workspace_write",
  "danger_full_access",
];
const NETWORKS: readonly DefaultsNetworkPolicy[] = ["deny", "allow"];

function scopedKey(endpoint?: string): string {
  const origin = endpoint?.trim();
  return origin ? `${DEFAULTS_PREFERENCES_KEY}:${origin}` : DEFAULTS_PREFERENCES_KEY;
}

function sanitizePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_PATH_LENGTH ? trimmed : null;
}

function parse(value: string | null): SessionDefaults | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Partial<StoredDefaults>;
  if (candidate.version !== 1) return null;
  if (
    !MODES.includes(candidate.permissionMode as DefaultsPermissionMode) ||
    !NETWORKS.includes(candidate.network as DefaultsNetworkPolicy)
  ) {
    return null;
  }
  const sandbox = candidate.sandbox;
  if (
    typeof sandbox !== "object" ||
    sandbox === null ||
    typeof sandbox.enabled !== "boolean" ||
    typeof sandbox.networkAccess !== "boolean" ||
    !Array.isArray(sandbox.readAllowPaths)
  ) {
    return null;
  }
  const readAllowPaths = sandbox.readAllowPaths
    .slice(0, MAX_READ_ALLOW_PATHS)
    .map(sanitizePath)
    .filter((path): path is string => path !== null);
  return {
    permissionMode: candidate.permissionMode as DefaultsPermissionMode,
    network: candidate.network as DefaultsNetworkPolicy,
    sandbox: {
      enabled: sandbox.enabled,
      networkAccess: sandbox.networkAccess,
      readAllowPaths,
    },
  };
}

/** Load this browser's new-session defaults; null when none/corrupt. */
export function loadSessionDefaults(
  storage: StorageLike,
  endpoint?: string,
): SessionDefaults | null {
  return parse(storage.getItem(scopedKey(endpoint)));
}

/** Persist the operator's defaults draft (bounded, no credentials). */
export function saveSessionDefaults(
  value: SessionDefaults,
  storage: StorageLike,
  endpoint?: string,
): void {
  const stored: StoredDefaults = {
    version: 1,
    permissionMode: value.permissionMode,
    network: value.network,
    sandbox: {
      enabled: value.sandbox.enabled,
      networkAccess: value.sandbox.networkAccess,
      readAllowPaths: value.sandbox.readAllowPaths
        .slice(0, MAX_READ_ALLOW_PATHS)
        .map((path) => path.trim().slice(0, MAX_PATH_LENGTH))
        .filter((path) => path !== ""),
    },
  };
  storage.setItem(scopedKey(endpoint), JSON.stringify(stored));
}
