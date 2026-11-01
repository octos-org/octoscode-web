import {
  clearRecentWorkspaces,
  loadRecentWorkspaces,
  rememberWorkspace,
  type RecentWorkspace,
} from "../workspace/workspace-recents.ts";

/**
 * The folders the phone overview watches, per server. Unlike the tab-scoped
 * workspace recents, these persist in localStorage: a phone reopened next
 * morning should still know which folders to list. Only folder paths are
 * stored — never tokens, session ids, titles or prompts; Core stays the only
 * authority on which sessions exist and who may open them.
 */
const STORAGE_NAMESPACE = "octoscode.remote.folders.v1";

function namespaced(endpoint: string): string {
  return `${STORAGE_NAMESPACE}|${endpoint.trim()}`;
}

export function loadRemoteFolders(
  storage: Pick<Storage, "getItem"> | null,
  endpoint: string,
): RecentWorkspace[] {
  if (!storage) return [];
  return loadRecentWorkspaces(storage, namespaced(endpoint));
}

export function rememberRemoteFolder(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  endpoint: string,
  path: string,
): RecentWorkspace[] {
  if (!storage) return [];
  return rememberWorkspace(storage, namespaced(endpoint), path);
}

export function forgetRemoteFolder(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
  endpoint: string,
  path: string,
): RecentWorkspace[] {
  if (!storage) return [];
  const remaining = loadRemoteFolders(storage, endpoint).filter(
    (folder) => folder.path !== path,
  );
  clearRecentWorkspaces(storage, namespaced(endpoint));
  // Re-remember oldest first so the stored order (newest first) survives.
  let next: RecentWorkspace[] = [];
  for (const folder of [...remaining].reverse())
    next = rememberWorkspace(storage, namespaced(endpoint), folder.path);
  return next;
}
