import type { SessionHydrateResult } from "@octos-org/octoscode-client/protocol";
import {
  validForkChatId,
  type SnapshotList,
} from "@octos-org/octoscode-client/history";
import {
  conversationCheckpoints,
  resolveCheckpoint,
  type ConversationCheckpoint,
} from "./checkpoints.ts";
import type {
  HistoryBinding,
  HistoryMode,
  HistoryMutation,
} from "./history-binding.ts";

export interface HistorySnapshot {
  loading: boolean;
  mutating: boolean;
  blockedReason: string | null;
  snapshots: SnapshotList | null;
  checkpoints: readonly ConversationCheckpoint[];
  error: string | null;
  notice: string | null;
  completed: boolean;
  uncertain: boolean;
  canRetryRefresh: boolean;
  prefill: string | null;
  prefillApplied: boolean;
  forkedSessionId: string | null;
}

type HistorySelection =
  | { mode: "undo"; snapshotId: string }
  | { mode: "rewind"; checkpoint: ConversationCheckpoint }
  | { mode: "fork"; name: string };
interface AcceptedChange {
  lease: HistoryMutation;
  prefill?: string;
  forkedSessionId?: string;
}

/** Dialog state only. The owning record remains the single queue and reducer. */
export class HistoryCoordinator {
  readonly #binding: HistoryBinding;
  readonly #mode: HistoryMode;
  readonly #listeners = new Set<() => void>();
  #unsubscribe: (() => void) | null = null;
  #loadGeneration = 0;
  #accepted: AcceptedChange | null = null;
  #snapshot: HistorySnapshot;

  constructor(binding: HistoryBinding, mode: HistoryMode) {
    this.#binding = binding;
    this.#mode = mode;
    this.#snapshot = {
      loading: false,
      mutating: false,
      blockedReason: binding.blockedReason(mode),
      snapshots: null,
      checkpoints: [],
      error: null,
      notice: null,
      completed: false,
      uncertain: false,
      canRetryRefresh: false,
      prefill: null,
      prefillApplied: false,
      forkedSessionId: null,
    };
  }

  getSnapshot = (): HistorySnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    this.#unsubscribe ??= this.#binding.subscribe(() => {
      if (!this.#snapshot.mutating && !this.#binding.isCurrent())
        this.#releaseAccepted();
      this.#publish({ blockedReason: this.#binding.blockedReason(this.#mode) });
    });
    return () => {
      this.#listeners.delete(listener);
      if (!this.#listeners.size) {
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        this.cancelLoad();
        // An accepted in-flight mutation still reconciles its captured record
        // after presentation goes away. An idle failed retry does not hold a lock.
        if (!this.#snapshot.mutating) this.#releaseAccepted();
      }
    };
  };

  cancelLoad(): void {
    this.#loadGeneration += 1;
  }

  async load(): Promise<void> {
    if (this.#snapshot.mutating || this.#accepted) return;
    const ticket = ++this.#loadGeneration;
    const current = () =>
      ticket === this.#loadGeneration && this.#binding.isCurrent();
    this.#publish({ loading: true, error: null });
    try {
      this.#assertCurrent();
      if (this.#mode === "undo") {
        const commands = await this.#binding.commands();
        if (!current()) return;
        const snapshots = await commands.listSnapshots();
        if (!current()) return;
        if (snapshots.session_id !== this.#binding.scope.sessionId)
          throw new Error("Snapshots belong to another Session.");
        this.#publish({ snapshots });
      } else if (this.#mode === "rewind") {
        const thread = await this.#binding.readHistory();
        if (!current()) return;
        this.#assertThread(thread);
        this.#publish({ checkpoints: conversationCheckpoints(thread) });
      }
    } catch (cause) {
      if (current()) this.#publish({ error: errorText(cause) });
    } finally {
      if (ticket === this.#loadGeneration) this.#publish({ loading: false });
    }
  }

  async apply(selection: HistorySelection): Promise<void> {
    if (
      selection.mode !== this.#mode ||
      this.#snapshot.mutating ||
      this.#snapshot.completed ||
      this.#snapshot.uncertain ||
      this.#accepted
    )
      return;
    this.cancelLoad();
    let lease: HistoryMutation | null = null;
    let submitted = false;
    this.#publish({
      loading: false,
      mutating: true,
      error: null,
      notice: null,
    });
    try {
      // Reserve before resolving the lazy command module: no enqueue race.
      lease = this.#binding.acquire(this.#mode);
      const commands = await this.#binding.commands();
      this.#assertLease(lease);
      if (selection.mode === "undo") {
        const fresh = await commands.listSnapshots();
        this.#assertLease(lease);
        if (
          fresh.session_id !== this.#binding.scope.sessionId ||
          !fresh.available ||
          !fresh.snapshots.some(
            (snapshot) => snapshot.id === selection.snapshotId,
          )
        )
          throw new Error(
            "The selected snapshot is no longer available. Reload history.",
          );
        this.#assertIdle();
        submitted = true;
        const response = await commands.restoreSnapshot(selection.snapshotId);
        this.#assertLease(lease);
        if (
          response.session_id !== this.#binding.scope.sessionId ||
          response.restored !== selection.snapshotId
        )
          throw new Error("Snapshot restoration returned another target.");
        this.#accepted = { lease };
        this.#publish({
          snapshots: { ...fresh, snapshots: response.snapshots },
        });
      } else if (selection.mode === "rewind") {
        const fresh = await this.#binding.readHistory();
        this.#assertLease(lease);
        this.#assertThread(fresh);
        this.#assertIdle();
        if (fresh.turns?.some((turn) => turn.state === "active"))
          throw new Error("The Session became active. Wait before rewinding.");
        const target = resolveCheckpoint(fresh, selection.checkpoint);
        if (!target)
          throw new Error("History changed. Reload the checkpoint picker.");
        submitted = true;
        const response = await commands.rewind(target.numTurns);
        this.#assertLease(lease);
        this.#assertThread(response.thread);
        this.#accepted = { lease, prefill: target.prefill };
      } else {
        if (!validForkChatId(selection.name))
          throw new Error("Choose a valid conversation name.");
        this.#assertIdle();
        submitted = true;
        const response = await commands.fork(selection.name);
        this.#assertLease(lease);
        if (
          response.parent_session_id !== this.#binding.scope.sessionId ||
          !response.new_session_id ||
          response.new_session_id === this.#binding.scope.sessionId
        )
          throw new Error("The fork response belongs to another Session.");
        this.#accepted = { lease, forkedSessionId: response.new_session_id };
        this.#publish({ forkedSessionId: response.new_session_id });
      }
      await this.#reconcileAccepted();
    } catch (cause) {
      if (this.#binding.isCurrent()) {
        if (submitted && !this.#accepted) {
          // A transport error does not prove a rollback/restore/fork was rejected.
          // Refresh the owner when possible, but never replay the mutation.
          if (lease?.isCurrent()) {
            try {
              await lease.rehydrate();
            } catch {
              // The engine marks a failed canonical refresh unready.
            }
          }
          if (this.#binding.isCurrent())
            this.#publish({
              uncertain: true,
              error: `History request outcome is unknown. Inspect server history before trying again. ${errorText(cause)}`,
            });
        } else {
          this.#publish({ error: errorText(cause) });
        }
      }
    } finally {
      if (this.#accepted?.lease !== lease) lease?.release();
      if (!this.#listeners.size) this.#releaseAccepted();
      this.#publish({
        mutating: false,
        blockedReason: this.#binding.blockedReason(this.#mode),
      });
    }
  }

  /** Retry only local opening/canonical refresh of an acknowledged mutation. */
  async retryRefresh(): Promise<void> {
    if (this.#snapshot.mutating || !this.#accepted) return;
    this.#publish({ mutating: true, error: null });
    try {
      await this.#reconcileAccepted();
    } finally {
      if (!this.#listeners.size) this.#releaseAccepted();
      this.#publish({
        mutating: false,
        blockedReason: this.#binding.blockedReason(this.#mode),
      });
    }
  }

  async #reconcileAccepted(): Promise<void> {
    const accepted = this.#accepted;
    if (!accepted) return;
    try {
      this.#assertLease(accepted.lease);
      const thread = await accepted.lease.rehydrate();
      this.#assertLease(accepted.lease);
      this.#assertThread(thread);
      if (accepted.forkedSessionId) {
        await accepted.lease.openFork(accepted.forkedSessionId);
        this.#assertLease(accepted.lease);
      }
      let prefillApplied = false;
      if (accepted.prefill !== undefined) {
        try {
          prefillApplied = accepted.lease.applyPrefill(accepted.prefill);
        } catch {
          // Preserve the text in the dialog if the owning draft cannot accept it.
        }
      }
      this.#publish({
        completed: true,
        canRetryRefresh: false,
        checkpoints: conversationCheckpoints(thread),
        prefill: accepted.prefill ?? null,
        prefillApplied,
        notice:
          this.#mode === "undo"
            ? "Workspace snapshot restored. Conversation history was not changed."
            : this.#mode === "rewind"
              ? "Conversation rewound. Workspace files were not restored."
              : "Conversation fork opened in the background. Your selection was not changed.",
      });
      this.#releaseAccepted();
    } catch (cause) {
      if (accepted.lease.isCurrent()) {
        this.#publish({
          canRetryRefresh: true,
          error: `The server accepted the history change, but local reconciliation failed. Retry refresh without repeating the change. ${errorText(cause)}`,
        });
      } else {
        this.#releaseAccepted();
      }
    }
  }

  #assertCurrent(): void {
    if (!this.#binding.isCurrent())
      throw new Error("History Session authority changed.");
  }
  #assertLease(lease: HistoryMutation): void {
    this.#assertCurrent();
    if (!lease.isCurrent())
      throw new Error("History mutation authority changed.");
  }
  #assertIdle(): void {
    const reason = this.#binding.blockedReason(this.#mode);
    if (reason) throw new Error(reason);
  }
  #assertThread(thread: SessionHydrateResult): void {
    if (thread.session_id !== this.#binding.scope.sessionId)
      throw new Error("History belongs to another Session.");
  }
  #releaseAccepted(): void {
    const accepted = this.#accepted;
    this.#accepted = null;
    accepted?.lease.release();
    if (this.#snapshot.canRetryRefresh)
      this.#publish({ canRetryRefresh: false });
  }
  #publish(patch: Partial<HistorySnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const listener of this.#listeners) listener();
  }
}

function errorText(cause: unknown): string {
  return (
    cause instanceof Error ? cause.message : "History request failed"
  ).slice(0, 512);
}
