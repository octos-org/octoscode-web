import type { TurnMedia } from "@octos-org/octoscode-client/protocol";

export interface PromptTurn {
  turnId: string;
  text: string;
  /** Native review owns a normal turn slot but dispatches review/start, not a prompt. */
  kind?: "review";
  /**
   * The Session's reasoning selection captured AT ENQUEUE TIME. rc11 clears
   * the persisted value when a turn omits it, so every queued entry must
   * carry the choice the user made when they typed it — not whatever is
   * selected when the FIFO eventually drains.
   */
  reasoningEffort?: string;
  /** Uploaded handles owned by this turn, captured when admitted locally. */
  media?: TurnMedia[];
}

export interface PromptTurnQueueSnapshot {
  active: PromptTurn | null;
  pending: readonly PromptTurn[];
}

export interface QueueTransition {
  settled: boolean;
  next: PromptTurn | null;
}

/** A user-interrupt prompt held until its OWN turn's terminal arrives. */
export interface PendingInterruptRestore {
  sessionId: string;
  turnId: string;
  prompt: string;
}

/**
 * Mirrors octoscode's default mid-turn submission contract: one active turn,
 * followed by a FIFO of prompts that each become their own turn.
 */
export class PromptTurnQueue {
  readonly #pending: PromptTurn[] = [];
  /**
   * Per-SESSION interrupt prompt restores (audit row 9). Mirrors the TUI's
   * `pending_interrupt_restores`: a user Esc/Ctrl+C stashes the interrupted
   * turn's prompt here and it is applied when THAT turn's terminal arrives —
   * keyed by session so switching Sessions neither loses nor misapplies it.
   */
  readonly #interruptRestores: PendingInterruptRestore[] = [];
  #active: PromptTurn | null = null;

  enqueue(turn: PromptTurn): { startNow: boolean } {
    if (this.#active === null) {
      this.#active = copyTurn(turn);
      return { startNow: true };
    }

    this.#pending.push(copyTurn(turn));
    return { startNow: false };
  }

  /** Returned/rejected steering preceded later ordinary drafts. */
  prependPending(turns: readonly PromptTurn[]): void {
    this.#pending.unshift(...turns.map(copyTurn));
  }

  restoreActive(turn: PromptTurn, preserveUnsentActive = false): boolean {
    if (this.#active !== null) {
      if (this.#active.turnId === turn.turnId) return true;
      if (!preserveUnsentActive) return false;
      this.#pending.unshift(this.#active);
    }
    this.#active = copyTurn(turn);
    return true;
  }

  settle(turnId: string): QueueTransition {
    if (this.#active?.turnId !== turnId) {
      return { settled: false, next: null };
    }

    this.#active = this.#pending.shift() ?? null;
    return {
      settled: true,
      next: this.#active ? copyTurn(this.#active) : null,
    };
  }

  removePending(turnId: string): boolean {
    const index = this.#pending.findIndex((turn) => turn.turnId === turnId);
    if (index === -1) return false;
    this.#pending.splice(index, 1);
    return true;
  }

  clear(): void {
    this.#active = null;
    this.#pending.length = 0;
    this.#interruptRestores.length = 0;
  }

  /**
   * Stash the interrupted turn's prompt for the session that owns it. One
   * entry per session: a re-Esc on the same session replaces its own entry
   * while other sessions' entries stay untouched. Empty prompts are ignored —
   * there is nothing to give back.
   */
  stashInterruptPrompt(
    sessionId: string,
    turnId: string,
    prompt: string,
  ): void {
    if (!prompt.trim()) return;
    const existing = this.#interruptRestores.findIndex(
      (pending) => pending.sessionId === sessionId,
    );
    const entry: PendingInterruptRestore = { sessionId, turnId, prompt };
    if (existing >= 0) this.#interruptRestores[existing] = entry;
    else this.#interruptRestores.push(entry);
  }

  /**
   * Consume the restore armed for exactly this turn — the prompt comes back
   * only when ITS OWN terminal arrives. The turn id is globally unique, and
   * the entry carries the owning session, so a terminal from another session
   * never matches and switching Sessions cannot lose or misapply a restore.
   * Keyed on the turn (not the session) because the Web terminal receipt
   * carries only the turn id.
   */
  takeInterruptPrompt(turnId: string): PendingInterruptRestore | null {
    const index = this.#interruptRestores.findIndex(
      (pending) => pending.turnId === turnId,
    );
    if (index < 0) return null;
    const [entry] = this.#interruptRestores.splice(index, 1);
    return entry ?? null;
  }

  snapshot(): PromptTurnQueueSnapshot {
    return {
      active: this.#active ? copyTurn(this.#active) : null,
      pending: this.#pending.map(copyTurn),
    };
  }
}

function copyTurn(turn: PromptTurn): PromptTurn {
  return {
    ...turn,
    ...(turn.media ? { media: turn.media.map((media) => ({ ...media })) } : {}),
  };
}
