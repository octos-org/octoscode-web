/**
 * The workspace file tree over `session/files.list`'s tree fields
 * (UPCR-2026-RDA916EB5, T-0416/#3046). A tree request asks for one folder's
 * immediate children; the entry `path` is workspace-relative and feeds
 * `session/files.read` directly. Older Cores answer the same method with the
 * legacy flat listing (entries without `kind`) — callers must fall back
 * instead of pretending the tree exists.
 */

export interface WorkspaceTreeEntry {
  /** The entry's own name (the path's last segment). */
  name: string;
  /** Workspace-relative path, safe for `session/files.read`. */
  path: string;
  kind: "file" | "dir";
}

export interface WorkspaceTreePage {
  entries: WorkspaceTreeEntry[];
  /** Present when more entries follow; pass back as `cursor`. */
  nextCursor: string | null;
}

import { CORE_UI_METHODS } from "./generated/core-contract.ts";

export type WorkspaceTreeListResult =
  { supported: true; page: WorkspaceTreePage } | { supported: false };

type Rpc = (method: string, params: unknown) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The wire shape only; a workspace-relative path with no escapes. */
function workspaceRelativePath(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    /^[A-Za-z]:/.test(value) ||
    value.split("/").includes("..")
  )
    return null;
  return value;
}

/**
 * One folder's page from the tree listing. `supported: false` when the
 * server answered with the legacy flat shape (a Core before
 * UPCR-2026-RDA916EB5), so the caller can show its older fallback instead of
 * an invented tree. Malformed tree payloads throw — an answer this client
 * cannot read is a server fault, not a fallback.
 */
export async function listWorkspaceTree(
  rpc: Rpc,
  sessionId: string,
  options: { prefix?: string; limit?: number; cursor?: string } = {},
): Promise<WorkspaceTreeListResult> {
  const params: Record<string, unknown> = { session_id: sessionId };
  if (options.prefix !== undefined) params.prefix = options.prefix;
  if (options.prefix !== undefined) params.depth = 1;
  if (options.limit !== undefined) params.limit = options.limit;
  if (options.cursor !== undefined) params.cursor = options.cursor;
  const result = await rpc(CORE_UI_METHODS.SESSION_FILES_LIST, params);
  if (!isRecord(result) || !Array.isArray(result.files))
    throw new Error("session/files.list returned an unreadable result");
  // Legacy flat listings carry no `kind`; the tree listing always does. An
  // empty page cannot tell the two apart and shows the same either way, so
  // report supported — the next non-empty page or a refresh re-checks.
  if (
    result.files.length > 0 &&
    !result.files.every((entry) => isRecord(entry) && entry.kind !== undefined)
  )
    return { supported: false };
  const entries: WorkspaceTreeEntry[] = [];
  for (const entry of result.files) {
    if (
      !isRecord(entry) ||
      (entry.kind !== "file" && entry.kind !== "dir") ||
      typeof entry.filename !== "string" ||
      !entry.filename
    )
      throw new Error("session/files.list returned an unreadable tree entry");
    const path = workspaceRelativePath(entry.path);
    if (path === null)
      throw new Error(
        "session/files.list returned an entry outside the workspace",
      );
    entries.push({ name: entry.filename, path, kind: entry.kind });
  }
  return {
    supported: true,
    page: {
      entries,
      nextCursor:
        typeof result.next_cursor === "string" && result.next_cursor
          ? result.next_cursor
          : null,
    },
  };
}
