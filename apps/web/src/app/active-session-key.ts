/**
 * 0555/0645 — sidebar selection key derivation, extracted from App.tsx so
 * unit tests can exercise it under node WITHOUT importing App.tsx (whose
 * module scope reads `window` via `defaultEndpoint()`).
 *
 * When `session.opened` is present the key is the canonical
 * workspaceSessionKey. When it is transiently ABSENT while a history view
 * (fork/undo/rewind receipt) is open — the mutating/reconcile window — the
 * PREVIOUS key is retained so the sidebar keeps its `aria-current="page"`
 * row ("Your selection was not changed") instead of unselecting every row.
 * Plain absences (no history view) still yield null: disconnects and real
 * navigations keep their original semantics.
 */
export function workspaceSessionKey(
  workspacePath: string,
  profileId: string,
  sessionId: string,
): string {
  return JSON.stringify([workspacePath, profileId, sessionId]);
}

export function resolveActiveSessionKey(
  opened:
    | {
        workspace_root?: string | undefined;
        active_profile_id?: string | undefined;
        session_id: string;
      }
    | null,
  activeWorkspacePath: string,
  previousKey: string | null,
  historyMutating: boolean,
): string | null {
  if (opened) {
    return workspaceSessionKey(
      activeWorkspacePath,
      opened.active_profile_id ?? "",
      opened.session_id,
    );
  }
  return historyMutating ? previousKey : null;
}