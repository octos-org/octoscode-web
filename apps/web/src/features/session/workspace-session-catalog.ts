import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  supportsFeature,
  supportsMethod,
  type OctosUiClient,
  type SessionListEntry,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import { isFullSessionForProfile } from "../resume/resume-binding.ts";
import type { KnownSessionRef } from "./known-session-registry.ts";

/**
 * The server's per-workspace session catalog, read through
 * `session/list { cwd, profile_id }` (the `<cwd>/.octos/<profile>` store the
 * server writes every session of that workspace to).
 *
 * The tab-known registry only remembers what THIS tab opened, so a fresh tab
 * showed an empty sidebar even though the workspace held days of history.
 * This catalog is what the sidebar lists instead; rows are still opened
 * through the ordinary session/open path, so nothing here is trusted beyond
 * "a candidate id the server reported for this workspace and profile".
 */
export interface WorkspaceCatalogSession {
  readonly sessionId: string;
  readonly profileId: string;
  readonly workspaceRoot: string;
  readonly title: string | null;
  readonly lastPrompt: string | null;
  /** Server `updated_at`, as epoch milliseconds; null when absent/unparseable. */
  readonly updatedAt: number | null;
  readonly activeTurn?: boolean;
}

export interface WorkspaceCatalogState {
  readonly status: "loading" | "loaded" | "error";
  readonly sessions: readonly WorkspaceCatalogSession[];
  readonly error?: string;
}

export type WorkspaceSessionCatalogSnapshot = ReadonlyMap<
  string,
  WorkspaceCatalogState
>;

export function supportsWorkspaceSessionCatalog(
  capabilities: UiProtocolCapabilities | undefined,
): boolean {
  return (
    supportsMethod(capabilities, CORE_UI_METHODS.SESSION_LIST) &&
    supportsFeature(capabilities, CORE_UI_FEATURES.SESSION_WORKSPACE_CWD_V1)
  );
}

/** Project one `session/list` result onto routable rows, newest first. */
export function catalogSessionsFromList(
  workspaceRoot: string,
  profileId: string,
  entries: readonly SessionListEntry[],
): WorkspaceCatalogSession[] {
  const rows: WorkspaceCatalogSession[] = [];
  for (const entry of entries) {
    if (!isFullSessionForProfile(entry.id, profileId)) continue;
    const updatedAt = entry.updated_at ? Date.parse(entry.updated_at) : NaN;
    rows.push({
      sessionId: entry.id,
      profileId,
      workspaceRoot,
      title: entry.title?.trim() || null,
      lastPrompt: entry.last_prompt?.trim() || null,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
      ...(entry.active_turn === undefined
        ? {}
        : { activeTurn: entry.active_turn }),
    });
  }
  return rows.sort((left, right) => {
    const l = left.updatedAt ?? Number.NEGATIVE_INFINITY;
    const r = right.updatedAt ?? Number.NEGATIVE_INFINITY;
    return r - l;
  });
}

export interface WorkspaceSessionRow {
  readonly sessionId: string;
  readonly profileId: string;
  readonly title: string | null;
  readonly updatedAt: number;
}

/**
 * One workspace's sidebar rows: the catalog (server truth, with titles) plus
 * any ref this tab opened that the catalog did not report (e.g. a session the
 * server has not persisted yet). Recency is the later of the server's
 * `updated_at` and the tab's last open, so the row you just used stays on top.
 */
export function mergeWorkspaceSessionRows(
  known: readonly KnownSessionRef[],
  catalog: readonly WorkspaceCatalogSession[],
): WorkspaceSessionRow[] {
  const lastOpened = new Map(
    known.map((ref) => [rowKey(ref), ref.lastOpenedAt]),
  );
  const rows = new Map<string, WorkspaceSessionRow>();
  for (const entry of catalog) {
    const key = rowKey(entry);
    rows.set(key, {
      sessionId: entry.sessionId,
      profileId: entry.profileId,
      title: entry.title ?? entry.lastPrompt,
      updatedAt: Math.max(entry.updatedAt ?? 0, lastOpened.get(key) ?? 0),
    });
  }
  for (const ref of known) {
    const key = rowKey(ref);
    if (rows.has(key)) continue;
    rows.set(key, {
      sessionId: ref.sessionId,
      profileId: ref.profileId,
      title: null,
      updatedAt: ref.lastOpenedAt,
    });
  }
  return [...rows.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function rowKey(row: { sessionId: string; profileId: string }): string {
  return `${row.profileId}\n${row.sessionId}`;
}

export interface WorkspaceSessionCatalog {
  subscribe(listener: () => void): () => void;
  getSnapshot(): WorkspaceSessionCatalogSnapshot;
  /** Reload the given workspaces; ones no longer listed are dropped. */
  refresh(workspacePaths: readonly string[]): Promise<void>;
  dispose(): void;
}

export function createWorkspaceSessionCatalog(deps: {
  client: OctosUiClient;
  profileId: string;
}): WorkspaceSessionCatalog {
  const listeners = new Set<() => void>();
  let snapshot: WorkspaceSessionCatalogSnapshot = new Map();
  let epoch = 0;
  let disposed = false;
  const publish = (next: WorkspaceSessionCatalogSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const patch = (path: string, state: WorkspaceCatalogState) => {
    const next = new Map(snapshot);
    next.set(path, state);
    publish(next);
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    async refresh(workspacePaths) {
      if (disposed || !deps.profileId) return;
      const generation = ++epoch;
      const paths = [...new Set(workspacePaths)];
      const next = new Map<string, WorkspaceCatalogState>();
      for (const path of paths) {
        next.set(path, {
          status: "loading",
          sessions: snapshot.get(path)?.sessions ?? [],
        });
      }
      publish(next);
      await Promise.all(
        paths.map(async (path) => {
          const previous = next.get(path)?.sessions ?? [];
          let state: WorkspaceCatalogState;
          try {
            const result = await deps.client.listSessions({
              cwd: path,
              profile_id: deps.profileId,
            });
            state = {
              status: "loaded",
              sessions: catalogSessionsFromList(
                path,
                deps.profileId,
                result.sessions,
              ),
            };
          } catch (reason) {
            state = {
              status: "error",
              sessions: previous,
              error: reason instanceof Error ? reason.message : String(reason),
            };
          }
          if (disposed || generation !== epoch) return;
          patch(path, state);
        }),
      );
    },
    dispose() {
      disposed = true;
      epoch += 1;
      publish(new Map());
    },
  };
}

const EMPTY_CATALOG: WorkspaceSessionCatalogSnapshot = new Map();
const noopSubscribe = () => () => undefined;
const emptySnapshot = () => EMPTY_CATALOG;

/**
 * Sidebar hook: one catalog per (transport, profile), refreshed whenever the
 * workspace set or `refreshKey` changes. Without a client, a profile, or the
 * server features, the snapshot is empty and the sidebar stays tab-only.
 */
export function useWorkspaceSessionCatalog(options: {
  client: OctosUiClient | null;
  capabilities: UiProtocolCapabilities | undefined;
  profileId: string;
  workspacePaths: readonly string[];
  /** Any change re-lists (e.g. the active session or a finished turn). */
  refreshKey: string;
}): WorkspaceSessionCatalogSnapshot {
  const { client, profileId } = options;
  const supported = supportsWorkspaceSessionCatalog(options.capabilities);
  const catalog = useMemo(
    () =>
      client && profileId && supported
        ? createWorkspaceSessionCatalog({ client, profileId })
        : null,
    [client, profileId, supported],
  );
  useEffect(() => () => catalog?.dispose(), [catalog]);
  const pathsKey = options.workspacePaths.join("\n");
  useEffect(() => {
    if (!catalog) return;
    void catalog.refresh(pathsKey ? pathsKey.split("\n") : []);
  }, [catalog, pathsKey, options.refreshKey]);
  return useSyncExternalStore(
    catalog ? catalog.subscribe : noopSubscribe,
    catalog ? catalog.getSnapshot : emptySnapshot,
  );
}
