import type {
  FileMutationNotice,
  HydratedFileMutation,
} from "@octos-org/octoscode-client/protocol";

/**
 * The files this Session's tools touched, folded from Core's `file_mutation`
 * notices, restored from hydrate's retained mutation snapshot on selection and
 * reload, then continued by live notifications after the hydrate cursor.
 */
export interface SessionFileChange {
  /** Relative to the workspace when it lies inside it; otherwise as reported. */
  path: string;
  /** What the file is now, across the Session: a file created and then edited is still new. */
  operation: FileMutationNotice["operation"];
  /** The latest preview Core kept for this file, when it kept one. */
  previewId: string | null;
  bytesWritten: number | null;
}

const MAX_CHANGES = 500;

/** Newest first; one row per file. */
export function applyFileMutation(
  changes: readonly SessionFileChange[],
  notice: FileMutationNotice,
  workspaceRoot: string,
): SessionFileChange[] {
  const path = workspaceRelativePath(notice.path, workspaceRoot);
  const previous = changes.find((change) => change.path === path);
  const rest = changes.filter((change) => change !== previous);
  const created = previous?.operation === "create";
  // Created and removed within the Session: nothing is left to show.
  if (created && notice.operation === "delete") return rest;
  const next: SessionFileChange = {
    path,
    operation:
      created && notice.operation !== "delete" ? "create" : notice.operation,
    previewId: notice.previewId ?? previous?.previewId ?? null,
    bytesWritten: notice.bytesWritten,
  };
  return [next, ...rest].slice(0, MAX_CHANGES);
}

/** `/srv/w/docs/a.md` under `/srv/w` is `docs/a.md`; `./a.md` is `a.md`. */
export function workspaceRelativePath(path: string, root: string): string {
  const base = root.replace(/\/+$/, "");
  if (base && path.startsWith(`${base}/`)) return path.slice(base.length + 1);
  return path.replace(/^(\.\/)+/, "");
}

/** Fold the authoritative history in the same order as live tool notices. */
export function restoreSessionChanges(
  mutations: readonly HydratedFileMutation[],
  workspaceRoot: string,
): SessionFileChange[] {
  return mutations.reduce<SessionFileChange[]>(
    (current, mutation) =>
      applyFileMutation(
        current,
        {
          sessionId: null,
          turnId: null,
          path: mutation.path,
          operation: mutation.operation,
          previewId: mutation.preview_id ?? null,
          bytesWritten: mutation.bytes_written ?? null,
        },
        workspaceRoot,
      ),
    [],
  );
}
