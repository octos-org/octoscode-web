export interface PromptTurn {
  turnId: string;
  text: string;
}

export interface PromptTurnQueueSnapshot {
  active: PromptTurn | null;
  pending: readonly PromptTurn[];
}

export interface QueueTransition {
  settled: boolean;
  next: PromptTurn | null;
}

/**
 * Mirrors octoscode's default mid-turn submission contract: one active turn,
 * followed by a FIFO of prompts that each become their own turn.
 */
export class PromptTurnQueue {
  readonly #pending: PromptTurn[] = [];
  #active: PromptTurn | null = null;

  enqueue(turn: PromptTurn): { startNow: boolean } {
    if (this.#active === null) {
      this.#active = turn;
      return { startNow: true };
    }

    this.#pending.push(turn);
    return { startNow: false };
  }

  settle(turnId: string): QueueTransition {
    if (this.#active?.turnId !== turnId) {
      return { settled: false, next: null };
    }

    this.#active = this.#pending.shift() ?? null;
    return { settled: true, next: this.#active };
  }

  clear(): void {
    this.#active = null;
    this.#pending.length = 0;
  }

  snapshot(): PromptTurnQueueSnapshot {
    return {
      active: this.#active ? { ...this.#active } : null,
      pending: this.#pending.map((turn) => ({ ...turn })),
    };
  }
}
