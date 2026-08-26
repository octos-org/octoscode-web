import {
  CORE_UI_METHODS,
  parseProjectionEnvelope,
  parseReplayLossyEvent,
  type ProjectionEnvelopeV2,
  type RpcNotification,
  type SessionHydrateResult,
  type UiCursor,
} from "@octos-org/octoscode-client";

export type SessionRecoveryPhase =
  "idle" | "hydrating" | "healthy" | "reconnecting" | "gap" | "lossy" | "error";

export interface SessionRecoverySnapshot {
  phase: SessionRecoveryPhase;
  sessionId: string;
  cursor?: UiCursor;
  detail?: string;
  reconnectAttempt: number;
}

export type ProjectionDecision =
  | { kind: "apply"; envelope: ProjectionEnvelopeV2 }
  | { kind: "ignore"; reason: "not_projection" | "wrong_session" | "duplicate" }
  | { kind: "recover"; reason: string };

/**
 * React-free integrity boundary for one durable AppUI session.
 *
 * It deliberately does not render. It owns only the facts needed to decide
 * whether an incoming canonical envelope is safe to fold into the UI:
 * session/topic scope, per-thread sequence monotonicity, replay-loss signals,
 * and the most recent server cursor used for session/open replay.
 */
export class DurableSessionProjection {
  #sessionId = "";
  #cursor: UiCursor | undefined;
  #threadSeq = new Map<string, number>();
  #phase: SessionRecoveryPhase = "idle";
  #detail: string | undefined;
  #reconnectAttempt = 0;

  reset(sessionId: string): void {
    this.#sessionId = sessionId;
    this.#cursor = undefined;
    this.#threadSeq.clear();
    this.#phase = "idle";
    this.#detail = undefined;
    this.#reconnectAttempt = 0;
  }

  beginHydrate(sessionId = this.#sessionId): void {
    this.#sessionId = sessionId;
    this.#phase = "hydrating";
    this.#detail = "Restoring authoritative session state";
  }

  beginReconnect(attempt: number): void {
    this.#phase = "reconnecting";
    this.#reconnectAttempt = attempt;
    this.#detail = `Connection lost · retry ${attempt}`;
  }

  commitHydrate(result: SessionHydrateResult): void {
    if (result.session_id !== this.#sessionId) {
      throw new Error(
        `Hydrate returned session ${result.session_id}, expected ${this.#sessionId}`,
      );
    }
    this.#cursor = { ...result.cursor };
    // Hydrate returns only selected replay lanes (currently tool/background),
    // not a complete envelope log. Seeding per-thread seq from those partial
    // lanes would make an earlier buffered assistant delta look stale. Start a
    // fresh live ordering window; the authoritative transcript already covers
    // committed history and the recovery buffer establishes the next sequence.
    this.#threadSeq.clear();
    this.#phase = "healthy";
    this.#detail = undefined;
    this.#reconnectAttempt = 0;
  }

  fail(reason: string): void {
    this.#phase = "error";
    this.#detail = reason;
  }

  observe(notification: RpcNotification): ProjectionDecision {
    if (notification.method === CORE_UI_METHODS.REPLAY_LOSSY) {
      const event = parseReplayLossyEvent(notification.params);
      if (!event || !this.#matchesScope(event.session_id)) {
        return { kind: "ignore", reason: "wrong_session" };
      }
      this.#phase = "lossy";
      this.#detail = `${event.dropped_count} durable event${event.dropped_count === 1 ? "" : "s"} dropped`;
      return { kind: "recover", reason: this.#detail };
    }

    if (notification.method !== CORE_UI_METHODS.PROJECTION_ENVELOPE) {
      return { kind: "ignore", reason: "not_projection" };
    }
    const envelope = parseProjectionEnvelope(notification.params);
    if (!envelope) {
      this.#phase = "gap";
      this.#detail = "Malformed projection/envelope";
      return { kind: "recover", reason: this.#detail };
    }
    if (!this.#matchesScope(envelope.session_id, envelope.topic)) {
      return { kind: "ignore", reason: "wrong_session" };
    }
    if (!envelope.cursor) {
      this.#phase = "gap";
      this.#detail = "Canonical envelope is missing its durable cursor";
      return { kind: "recover", reason: this.#detail };
    }
    if (this.#cursor && envelope.cursor.stream !== this.#cursor.stream) {
      this.#phase = "gap";
      this.#detail = `Cursor stream changed from ${this.#cursor.stream} to ${envelope.cursor.stream}`;
      return { kind: "recover", reason: this.#detail };
    }

    const previous = this.#threadSeq.get(envelope.thread_id);
    if (previous !== undefined && envelope.seq <= previous) {
      return { kind: "ignore", reason: "duplicate" };
    }
    if (previous !== undefined && envelope.seq !== previous + 1) {
      this.#phase = "gap";
      this.#detail = `Projection gap in ${envelope.thread_id}: expected ${previous + 1}, received ${envelope.seq}`;
      return { kind: "recover", reason: this.#detail };
    }

    this.#threadSeq.set(envelope.thread_id, envelope.seq);
    if (!this.#cursor || envelope.cursor.seq > this.#cursor.seq) {
      this.#cursor = { ...envelope.cursor };
    }
    if (this.#phase !== "healthy") {
      this.#phase = "healthy";
      this.#detail = undefined;
    }
    return { kind: "apply", envelope };
  }

  snapshot(): SessionRecoverySnapshot {
    return {
      phase: this.#phase,
      sessionId: this.#sessionId,
      reconnectAttempt: this.#reconnectAttempt,
      ...(this.#cursor ? { cursor: { ...this.#cursor } } : {}),
      ...(this.#detail ? { detail: this.#detail } : {}),
    };
  }

  #matchesScope(sessionId: string, topic?: string): boolean {
    if (!this.#sessionId) return false;
    if (sessionId === this.#sessionId) {
      const expectedTopic = this.#sessionId.split("#", 2)[1];
      return (
        expectedTopic === undefined ||
        topic === undefined ||
        topic === expectedTopic
      );
    }
    if (!topic) return false;
    return `${sessionId}#${topic}` === this.#sessionId;
  }
}
