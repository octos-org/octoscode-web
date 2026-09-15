import type {
  BackgroundTurnSessionScope,
  BackgroundTurnSnapshot,
  BackgroundTurnState,
} from "../session/background-turn-manager.ts";

export type AttentionState = Exclude<BackgroundTurnState, "running">;
export interface AttentionNotice extends BackgroundTurnSnapshot {
  state: AttentionState;
}

function sessionKey(scope: BackgroundTurnSessionScope): string {
  return JSON.stringify([
    scope.workspaceRoot,
    scope.profileId,
    scope.sessionId,
  ]);
}
function turnKey(turn: BackgroundTurnSnapshot): string {
  return JSON.stringify([sessionKey(turn), turn.turnId]);
}

/** Presentation-only transition memory; it never derives execution outcomes. */
export class AttentionTracker {
  #identity: object | null = null;
  #observed = new Map<string, BackgroundTurnState>();
  #unread = new Map<string, AttentionNotice>();

  get count(): number {
    return this.#unread.size;
  }

  acknowledgeAll(): void {
    this.#unread.clear();
  }

  observe(
    identity: object | null,
    turns: readonly BackgroundTurnSnapshot[],
    selected: BackgroundTurnSessionScope | null,
    visible: boolean,
  ): AttentionNotice[] {
    const reset = this.#identity !== identity;
    if (reset || identity === null) {
      this.#identity = identity;
      this.#observed.clear();
      this.#unread.clear();
    }
    if (identity === null) return [];

    const selectedKey = selected ? sessionKey(selected) : null;
    const next = new Map(this.#observed);
    const notices: AttentionNotice[] = [];
    const current = new Map(turns.map((turn) => [turnKey(turn), turn]));
    for (const turn of current.values()) {
      const key = turnKey(turn);
      const previous = this.#observed.get(key);
      next.set(
        key,
        previous === "completed" || previous === "failed"
          ? previous
          : turn.state,
      );
      const reading = visible && sessionKey(turn) === selectedKey;
      if (reading) this.#unread.delete(key);
      if (
        !reset &&
        !reading &&
        (previous === "running" || previous === "waiting") &&
        previous !== turn.state &&
        turn.state !== "running"
      ) {
        const notice: AttentionNotice = { ...turn, state: turn.state };
        this.#unread.set(key, notice);
        notices.push(notice);
      }
    }
    // Opening a previously background Session acknowledges it even when its
    // owner row is reclaimed and no longer appears in backgroundTurns.
    for (const [key, notice] of this.#unread) {
      if (visible && sessionKey(notice) === selectedKey)
        this.#unread.delete(key);
    }
    // Queue removal and the explicit terminal can arrive in separate renders.
    // Keep a bounded observation window without inventing an outcome in between.
    while (next.size > 128) {
      const oldest = next.keys().next().value!;
      next.delete(oldest);
      this.#unread.delete(oldest);
    }
    this.#observed = next;
    return notices;
  }
}

export function attentionTitle(title: string, count: number): string {
  return count > 0 ? `(${count}) ${title}` : title;
}

/** Only explicit turn terminal records can finish a hidden foreground response. */
export function foregroundAttentionTurns(
  selected: BackgroundTurnSessionScope | null,
  activeTurnId: string | null,
  waitingTurnId: string | null,
  timeline: readonly import("../timeline/model.ts").TimelineEntry[],
): BackgroundTurnSnapshot[] {
  if (!selected) return [];
  const terminal = timeline.findLast(
    (entry) =>
      entry.kind === "system" &&
      entry.turnId &&
      entry.id === `terminal:${entry.turnId}` &&
      (entry.status === "complete" || entry.status === "error"),
  );
  const rows: BackgroundTurnSnapshot[] = [];
  if (activeTurnId && activeTurnId !== terminal?.turnId) {
    rows.push({
      ...selected,
      turnId: activeTurnId,
      state: activeTurnId === waitingTurnId ? "waiting" : "running",
    });
  }
  if (terminal?.turnId) {
    rows.push({
      ...selected,
      turnId: terminal.turnId,
      state: terminal.status === "complete" ? "completed" : "failed",
    });
  }
  return rows;
}
