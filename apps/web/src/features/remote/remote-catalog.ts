import { useEffect, useMemo, useSyncExternalStore } from "react";
import type {
  LaunchResolveParams,
  LaunchResolveResult,
  SessionListParams,
  SessionListResult,
} from "@octos-org/octoscode-client/protocol";
import {
  catalogSessionsFromList,
  type WorkspaceCatalogSession,
} from "../session/workspace-session-catalog.ts";
import { errorMessage } from "../../shared/errors.ts";

/**
 * The phone overview's session list: `session/list { cwd, profile_id }` for
 * every watched folder. A phone usually has not opened anything yet, so when
 * the connection has no profile the folder's own profile comes from
 * `launch/resolve` (folder-sticky, then the server default) — the same profile
 * a desktop opening that folder would use.
 */
export interface RemoteFolderState {
  readonly status: "loading" | "loaded" | "error";
  readonly profileId: string | null;
  readonly sessions: readonly WorkspaceCatalogSession[];
  readonly error?: string;
  /** When this folder last listed successfully (epoch ms). */
  readonly listedAt: number | null;
}

export type RemoteCatalogSnapshot = ReadonlyMap<string, RemoteFolderState>;

export interface RemoteCatalogClient {
  listSessions(params: SessionListParams): Promise<SessionListResult>;
  resolveLaunch(params: LaunchResolveParams): Promise<LaunchResolveResult>;
}

export interface RemoteCatalog {
  subscribe(listener: () => void): () => void;
  getSnapshot(): RemoteCatalogSnapshot;
  /**
   * Re-list through `client`, the CURRENT transport, under `profileId` (the
   * connection's profile; empty means resolve each folder). The store
   * outlives any one transport AND any one profile, so a reconnect or a
   * profile change lists into the same rows instead of starting from an
   * empty overview.
   */
  refresh(
    client: RemoteCatalogClient,
    folders: readonly string[],
    profileId: string,
  ): Promise<void>;
  dispose(): void;
}

export function createRemoteCatalog(
  deps: { now?: () => number } = {},
): RemoteCatalog {
  const now = deps.now ?? Date.now;
  const listeners = new Set<() => void>();
  const resolved = new Map<string, string>();
  let snapshot: RemoteCatalogSnapshot = new Map();
  let epoch = 0;
  let disposed = false;
  const publish = (next: RemoteCatalogSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const profileFor = async (
    client: RemoteCatalogClient,
    folder: string,
    profileId: string,
  ): Promise<string> => {
    if (profileId) return profileId;
    const known = resolved.get(folder);
    if (known) return known;
    const result = await client.resolveLaunch({ cwd: folder });
    const profile = result.resolved_profile?.trim();
    if (!profile)
      throw new Error("This folder has no profile on the server yet.");
    resolved.set(folder, profile);
    return profile;
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    async refresh(client, folders, profileId) {
      if (disposed) return;
      const generation = ++epoch;
      const paths = [...new Set(folders.map((folder) => folder.trim()))].filter(
        Boolean,
      );
      const next = new Map<string, RemoteFolderState>();
      for (const path of paths)
        next.set(
          path,
          snapshot.get(path) ?? {
            status: "loading",
            profileId: null,
            sessions: [],
            listedAt: null,
          },
        );
      publish(next);
      await Promise.all(
        paths.map(async (path) => {
          const previous = next.get(path)!;
          let state: RemoteFolderState;
          try {
            const folderProfile = await profileFor(client, path, profileId);
            const result = await client.listSessions({
              cwd: path,
              profile_id: folderProfile,
            });
            state =
              result.workspace_root && result.profile_id === folderProfile
                ? {
                    status: "loaded",
                    profileId: folderProfile,
                    sessions: catalogSessionsFromList(
                      result.workspace_root,
                      folderProfile,
                      result.sessions,
                    ),
                    listedAt: now(),
                  }
                : {
                    ...previous,
                    status: "error",
                    profileId: folderProfile,
                    error: "This server cannot list sessions by folder.",
                  };
          } catch (reason) {
            // Keep the last good rows: an outage must not empty the overview.
            state = {
              ...previous,
              status: "error",
              error: errorMessage(reason),
            };
          }
          if (disposed || generation !== epoch) return;
          const patched = new Map(snapshot);
          if (!patched.has(path)) return;
          patched.set(path, state);
          publish(patched);
        }),
      );
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}

/** React binding: re-lists when the folders or `refreshKey` change. */
export function useRemoteCatalog(options: {
  client: RemoteCatalogClient | null;
  profileId: string;
  folders: readonly string[];
  refreshKey: string;
}): RemoteCatalogSnapshot {
  const { client, profileId } = options;
  // One store for the page, NOT per transport or per profile: the profile
  // follows the opened session and drops back when the connection does, and
  // a fresh store at that moment emptied the overview exactly when the
  // server became unreachable (found on the demo, T-0094).
  const catalog = useMemo(() => createRemoteCatalog(), []);
  useEffect(() => () => catalog.dispose(), [catalog]);
  const foldersKey = options.folders.join("\n");
  useEffect(() => {
    if (!client) return;
    void catalog.refresh(
      client,
      foldersKey ? foldersKey.split("\n") : [],
      profileId,
    );
  }, [catalog, client, foldersKey, profileId, options.refreshKey]);
  return useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
}
