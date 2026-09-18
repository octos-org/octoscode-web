import {
  CORE_UI_METHODS,
  supportsMethod,
  type OctosUiClient,
  type SessionHydrateResult,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import { APPUI_SNAPSHOT_METHODS } from "@octos-org/octoscode-client/history";
import type {
  SessionRecord,
  SessionRecordManager,
} from "../session/session-record-manager.ts";
import {
  sessionRuntimeScopeKey,
  type SessionRuntimeScope,
} from "../session/session-scope.ts";

export type HistoryMode = "undo" | "rewind" | "fork";
export type HistoryCommands = Awaited<
  ReturnType<OctosUiClient["historyCommands"]>
>;

export interface HistoryMutation {
  isCurrent(): boolean;
  release(): void;
  rehydrate(): Promise<SessionHydrateResult>;
  openFork(sessionId: string): Promise<void>;
  applyPrefill(text: string): boolean;
}

export interface HistoryBinding {
  readonly scope: Readonly<SessionRuntimeScope>;
  readonly authorityKey: string;
  readonly capabilities: UiProtocolCapabilities;
  isCurrent(): boolean;
  subscribe(listener: () => void): () => void;
  blockedReason(mode: HistoryMode): string | null;
  commands(): Promise<HistoryCommands>;
  readHistory(): Promise<SessionHydrateResult>;
  acquire(mode: HistoryMode): HistoryMutation;
}

export interface HistoryBindingOptions {
  manager: SessionRecordManager<OctosUiClient>;
  record: SessionRecord<OctosUiClient>;
  /** Must write only this scope's empty draft; never the selected composer. */
  applyPrefill?: (
    scope: Readonly<SessionRuntimeScope>,
    text: string,
  ) => boolean;
}

export function historySupported(
  capabilities: UiProtocolCapabilities,
  mode: HistoryMode,
): boolean {
  // Every mutation ends in the engine's canonical hydrate, including file undo.
  if (!supportsMethod(capabilities, CORE_UI_METHODS.SESSION_HYDRATE))
    return false;
  return mode === "undo"
    ? supportsMethod(capabilities, APPUI_SNAPSHOT_METHODS.LIST) &&
        supportsMethod(capabilities, APPUI_SNAPSHOT_METHODS.RESTORE)
    : mode === "rewind"
      ? supportsMethod(capabilities, CORE_UI_METHODS.SESSION_ROLLBACK)
      : supportsMethod(capabilities, CORE_UI_METHODS.SESSION_FORK) &&
        supportsMethod(capabilities, CORE_UI_METHODS.SESSION_OPEN);
}

/** Capture one confirmed record, not the current selection or a session-id hint. */
export function createHistoryBinding({
  manager,
  record,
  applyPrefill,
}: HistoryBindingOptions): HistoryBinding {
  const authority = record.runtime.currentAuthority();
  if (!authority?.capabilities)
    throw new Error("Open a confirmed Session before changing history.");
  const scope = Object.freeze({ ...record.scope });
  const { client, capabilities, generation } = authority;
  const isCurrent = () => {
    const current = record.runtime.currentAuthority();
    return (
      manager.get(scope) === record &&
      !record.closed &&
      record.runtime.isCurrent(authority) &&
      client.status === "connected" &&
      current?.config.endpoint === scope.endpoint &&
      current.sessionId === scope.sessionId &&
      current.profileId === scope.profileId &&
      current.cwd === scope.workspaceRoot &&
      current.capabilities === capabilities
    );
  };
  const assertCurrent = () => {
    if (!isCurrent()) throw new Error("History Session authority changed.");
  };
  const blockedReason = (mode: HistoryMode): string | null => {
    if (!isCurrent())
      return "History Session authority changed. Reopen history.";
    if (!historySupported(capabilities, mode))
      return "This server does not advertise the required history methods.";
    const affected = manager
      .records()
      .filter(
        (candidate) =>
          !candidate.closed &&
          (mode === "undo"
            ? candidate.scope.endpoint === scope.endpoint &&
              candidate.scope.authorityEpoch === scope.authorityEpoch &&
              candidate.scope.workspaceRoot === scope.workspaceRoot
            : candidate === record),
      );
    if (
      affected.some((candidate) => {
        const queue = candidate.queue.snapshot();
        const state = candidate.runtime.getSnapshot();
        return (
          queue.active !== null ||
          queue.pending.length > 0 ||
          candidate.interactions.current(candidate.scope) !== null ||
          state.phase !== "ready" ||
          state.status !== "connected" ||
          state.recovery.phase !== "healthy"
        );
      })
    )
      return "Wait for affected turns, queued prompts, and questions to settle before changing history.";
    return null;
  };
  return {
    scope,
    authorityKey: JSON.stringify([sessionRuntimeScopeKey(scope), generation]),
    capabilities,
    isCurrent,
    subscribe: manager.subscribe,
    blockedReason,
    async commands() {
      assertCurrent();
      const commands = await client.historyCommands(
        scope.sessionId,
        capabilities,
      );
      assertCurrent();
      return commands;
    },
    async readHistory() {
      assertCurrent();
      if (!supportsMethod(capabilities, CORE_UI_METHODS.SESSION_HYDRATE))
        throw new Error("Canonical conversation history is unavailable.");
      const thread = await client.hydrateSession({
        session_id: scope.sessionId,
        include: ["messages", "turns", "pending_approvals"],
      });
      assertCurrent();
      if (thread.session_id !== scope.sessionId)
        throw new Error("History belongs to another Session.");
      return thread;
    },
    acquire(mode) {
      const blocked = blockedReason(mode);
      if (blocked) throw new Error(blocked);
      const lease = manager.acquireHistoryMutation(record, authority, {
        workspaceWide: mode === "undo",
      });
      if (!lease) throw new Error("Affected work changed. Wait and try again.");
      const abort = new AbortController();
      const current = () =>
        isCurrent() && lease.isCurrent() && !abort.signal.aborted;
      const assertLease = () => {
        if (!current()) throw new Error("History mutation authority changed.");
      };
      const unsubscribe = manager.subscribe(() => {
        if (!current()) abort.abort();
      });
      return {
        isCurrent: current,
        release() {
          unsubscribe();
          abort.abort();
          lease.release();
        },
        async rehydrate() {
          assertLease();
          await manager.rehydrateRecord(record, authority, lease);
          assertLease();
          const thread = record.payload?.hydrated;
          if (thread?.session_id !== scope.sessionId)
            throw new Error("Canonical refresh belongs to another Session.");
          return thread;
        },
        async openFork(sessionId) {
          assertLease();
          if (!sessionId || sessionId === scope.sessionId)
            throw new Error("The server returned an invalid fork identity.");
          const child = await manager.openOnRecord(
            {
              endpoint: scope.endpoint,
              token: "", // Existing authenticated pooled transport; no token copy.
              sessionId,
              profileId: scope.profileId,
              cwd: scope.workspaceRoot,
            },
            client,
            abort.signal,
            current,
          );
          assertLease();
          if (
            child.scope.sessionId !== sessionId ||
            child.scope.profileId !== scope.profileId ||
            child.scope.workspaceRoot !== scope.workspaceRoot ||
            child.scope.endpoint !== scope.endpoint ||
            child.scope.authorityEpoch !== scope.authorityEpoch
          )
            throw new Error(
              "The fork opened outside its owning Session scope.",
            );
          // No select(), turn start, or replacement queue: opening is background-only.
        },
        applyPrefill(text) {
          assertLease();
          return applyPrefill?.(scope, text) ?? false;
        },
      };
    },
  };
}
