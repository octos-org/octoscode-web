export interface RecentWorkspace {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
}

const STORAGE_PREFIX = "octoscode.product.workspace-recents.v2";
const LEGACY_STORAGE_PREFIX = "octoscode.product.workspace-recents.v1";
const MAX_WORKSPACES = 20;

/**
 * Browser recents are a tab-scoped workspace navigation cache, never a session
 * catalog. In particular, do not persist session ids, titles, prompts, or
 * protocol projections here: only Core can say which sessions are valid for
 * the current authenticated principal.
 */
export function loadRecentWorkspaces(
  storage: Pick<Storage, "getItem">,
  endpoint: string,
): RecentWorkspace[] {
  try {
    const raw = storage.getItem(storageKey(endpoint));
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .map(parseWorkspace)
      .filter((workspace): workspace is RecentWorkspace => workspace !== null)
      .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
      .slice(0, MAX_WORKSPACES);
  } catch {
    return [];
  }
}

export function rememberWorkspace(
  storage: Pick<Storage, "getItem" | "setItem">,
  endpoint: string,
  path: string,
  now = Date.now(),
): RecentWorkspace[] {
  const canonicalPath = path.trim();
  if (!canonicalPath) return loadRecentWorkspaces(storage, endpoint);
  const current = loadRecentWorkspaces(storage, endpoint);
  const workspace: RecentWorkspace = {
    id: canonicalPath,
    name: workspaceName(canonicalPath),
    path: canonicalPath,
    lastOpenedAt: now,
  };
  const next = [
    workspace,
    ...current.filter((candidate) => candidate.path !== canonicalPath),
  ].slice(0, MAX_WORKSPACES);
  storage.setItem(storageKey(endpoint), JSON.stringify(next));
  return next;
}

export function clearRecentWorkspaces(
  storage: Pick<Storage, "removeItem">,
  endpoint: string,
): void {
  storage.removeItem(storageKey(endpoint));
  storage.removeItem(legacyStorageKey(endpoint));
}

export function workspaceName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const name = normalized.split(/[\\/]/).filter(Boolean).at(-1);
  return name || path;
}

function storageKey(endpoint: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(endpoint.trim())}`;
}

function parseWorkspace(value: unknown): RecentWorkspace | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const name = text(value.name);
  const path = text(value.path);
  const lastOpenedAt = value.lastOpenedAt;
  if (!id || !name || !path || typeof lastOpenedAt !== "number") return null;
  return { id, name, path, lastOpenedAt };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function legacyStorageKey(endpoint: string): string {
  return `${LEGACY_STORAGE_PREFIX}:${encodeURIComponent(endpoint.trim())}`;
}
