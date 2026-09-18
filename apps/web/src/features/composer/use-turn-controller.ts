import {
  CORE_UI_METHODS,
  isProtocolUuid,
  OctosUiProtocolError,
  type OctosUiClient,
  type SessionHydrateResult,
} from "@octos-org/octoscode-client/protocol";
import type { TurnLifecycleState } from "@octos-org/octoscode-client";
import type { ReviewStartResult } from "@octos-org/octoscode-client/history";
import type { TurnSteerResult } from "@octos-org/octoscode-client/steer";
import type { RpcNotification } from "@octos-org/octoscode-client/protocol";
import { notificationMatchesSessionScope } from "../session/scope.ts";
import {
  addOptimisticUser,
  addSystemMessage,
  notificationTurnId,
  settleTimelineTurn,
  type TimelineEntry,
} from "../timeline/model.ts";
import {
  PromptTurnQueue,
  type PromptTurn,
  type PromptTurnQueueSnapshot,
} from "./turn-queue.ts";
import { RequestAuthorityGate } from "../async/request-authority.ts";
import { boundedTurnAdmissionError } from "./composer-seat-handover.ts";
import { turnCollisionFrom } from "./turn-collision.ts";

export interface TurnControllerDependencies {
  client: () => OctosUiClient | null;
  sessionId: () => string;
  canEnqueue: () => boolean;
  canStart: () => boolean;
  canInterrupt: () => boolean;
  /**
   * Whether the Session advertises the targeted `turn/state/get` lifecycle
   * lookup. Absent or false holds an unresolved turn as "unavailable".
   */
  canGetTurnState?: () => boolean;
  /** A lifecycle lookup proved the turn terminal (settle its interactions). */
  onRecoveredTerminal?: (turnId: string) => void;
  setTimeline: (
    update: TimelineEntry[] | ((previous: TimelineEntry[]) => TimelineEntry[]),
  ) => void;
  setConnectionError: (message: string) => void;
  onDispatchState?: (event: TurnDispatchStateEvent) => void;
  /**
   * Fires when a user-interrupted turn's prompt comes back, on THAT turn's own
   * terminal. `sessionId` is the turn's OWNING session (not necessarily the one
   * on screen), so the caller can route the prompt into the owning Session's
   * composer or saved draft — mirroring the TUI's per-session
   * `pending_interrupt_restores`. Never fires for a forgotten or superseded turn.
   */
  onInterruptPromptRestore?: (prompt: string, sessionId: string) => void;
  /**
   * The Session's current reasoning selection. Read at ENQUEUE time and stored
   * on the PromptTurn, because rc11 clears the persisted value on any turn
   * that omits it.
   */
  reasoningEffort?: () => string | undefined;
  /** Root resolves scoped public commands, fencing full record authority across awaits. */
  startReview?: (
    request: NativeReviewStartRequest,
  ) => Promise<ReviewStartResult>;
  steer?: (request: NativeSteerRequest) => Promise<TurnSteerResult>;
  /**
   * §5.2 composer handover gate (brief 4010 clause b). Called ONCE per user
   * turn, BEFORE any `turn/start` frame. THIS tab holding the driver seat
   * would make Core refuse the turn `ExternalMasterHeld`, so the seam must
   * first release the seat (`next:"internal"`) and only resolve `{ sent: true }`
   * once the release is CONFIRMED; a refusal resolves `{ sent: false, message }`
   * and the turn is never started (the draft is kept by the caller). NULL =
   * the session carries no driver-seat surface at all (ordinary chat): send
   * directly, exactly as before.
   */
  releaseSeatBeforeTurn?: () => Promise<
    { readonly sent: true } | { readonly sent: false; readonly message: string }
  >;
  /**
   * A turn refused by handback or a collision never started, so the queue's
   * copy is the ONLY remaining one. Park the turn
   * back on the OWNING record (resolved by session id) so the composer shows it
   * again instead of silently eating the message. Never overwrites a pending
   * restore.
   */
  onTurnNotSentRestore?: (turn: PromptTurn, sessionId: string) => void;
}

export interface NativeSteerRequest {
  readonly client: OctosUiClient;
  readonly sessionId: string;
  readonly expectedTurnId: string;
  readonly text: string;
  isCurrent(): boolean;
  markSent(): void;
}

export interface NativeReviewStartRequest {
  readonly client: OctosUiClient;
  readonly sessionId: string;
  readonly turnId: string;
  readonly prompt?: string;
  isCurrent(): boolean;
  /** Call exactly once, immediately before invoking typed commands.startReview. */
  markSent(): void;
}

export interface TurnDispatchStateEvent {
  state: "dispatching" | "accepted" | "rejected" | "cancelled";
  client: OctosUiClient;
  sessionId: string;
  turnId: string;
}

export interface TurnRecoveryState {
  turnId: string;
  phase: "checking" | "unknown" | "unavailable" | "error";
  message?: string;
}

export interface QueueBackedTurnController {
  queueSnapshot: () => PromptTurnQueueSnapshot;
  /**
   * The active turn whose outcome hydrate could not prove. While set, new
   * admission, dispatch and interrupt are held until a lifecycle lookup (or a
   * terminal) resolves it; the turn is never resent.
   */
  readonly turnRecovery: TurnRecoveryState | null;
  turnRecoveryNow: () => TurnRecoveryState | null;
  retryTurnRecovery: () => Promise<void>;
  dispatchingTurnIdNow: () => string | null;
  interruptingTurnIdNow: () => string | null;
  interruptibleNow: () => boolean;
  snapshot: () => PromptTurnQueueSnapshot;
  /**
   * The active turn only after `turn/start` or `review/start` is accepted by Core.
   * Optimistic/in-flight starts cannot be detached because a rejected RPC
   * would otherwise leave an owner socket parked without a terminal event.
   */
  backgroundHandoffTurn: () => {
    turnId: string;
    state: "running" | "waiting" | "completed" | "failed";
  } | null;
  activeTurnOwnership: () =>
    "none" | "dispatching" | "local-owner" | "observed";
  reset: () => void;
  enqueuePrompt: (text: string) => boolean;
  /** Remove a not-yet-dispatched queued prompt; the active turn stays. */
  cancelQueuedPrompt: (turnId: string) => boolean;
  /** Admit an immutable turn with the caller's native UUID. */
  enqueueTurn: (turn: PromptTurn) => boolean;
  /** Explicit user submission only; peer/gather submissions keep enqueueTurn FIFO. */
  submitTurn: (turn: PromptTurn) => boolean;
  setSteeringEnabled: (enabled: boolean) => void;
  steeringEnabled: () => boolean;
  /**
   * Observe every admitted notification for this Session: returned steering
   * inputs, and server-side turn activity, which proves an unacknowledged
   * `turn/start` was accepted (see `confirmTurnAccepted`).
   */
  observeSteerDropped: (notification: RpcNotification) => void;
  /** Retry only a never-sent queue head after the record becomes ready. */
  resumePendingTurn: () => void;
  /** Invalidate old RPC completions without dropping any queued turns. */
  suspendTransport: () => void;
  interrupt: () => Promise<void>;
  reconcileFromHydrate: (
    hydrated: SessionHydrateResult,
    preserveTransportOwnership?: boolean,
  ) => PromptTurn | null;
  clearTransportOwnership: () => void;
  /** Keep an accepted local owner's handoff state aligned with interactions. */
  setAcceptedOwnerInteraction: (waiting: boolean, turnId?: string) => boolean;
  restoreTransportOwnership: (turn: {
    turnId: string;
    state: "running" | "waiting" | "completed" | "failed";
  }) => boolean;
  /**
   * Promote an unacknowledged dispatch once server-side activity for the
   * turn proves Core accepted it (the start RPC may have timed out while
   * the turn is live). No-op without a matching dispatch lease.
   */
  confirmTurnAccepted: (turnId: string) => boolean;
  startTurn: (turn: PromptTurn) => Promise<void>;
  settleTurn: (turnId: string, outcome?: "completed" | "failed") => void;
}

/** One executable controller for one persistent Session queue. */
export function createQueueBackedTurnController(options: {
  /**
   * Record-scoped dependencies. Async requests capture their originating
   * client and Session and recheck that authority at completion.
   */
  dependenciesRef: { current: TurnControllerDependencies };
  /**
   * The persistent record's queue. Captured once: selection never rebinds an
   * existing executable controller to a different Session's queue.
   */
  queueRef: { current: PromptTurnQueue };
  /** Publish queue and ownership changes to record subscribers. */
  sync?: () => void;
  setDispatchingTurnId?: (turnId: string | null) => void;
  setInterruptingTurnId?: (turnId: string | null) => void;
}): QueueBackedTurnController {
  const startRequests = new RequestAuthorityGate<OctosUiClient>();
  const interruptRequests = new RequestAuthorityGate<OctosUiClient>();
  const recoveryRequests = new RequestAuthorityGate<OctosUiClient>();
  const dependenciesRef = options.dependenciesRef;
  const queue = options.queueRef.current;
  const queueOf = () => queue;
  const sync = options.sync ?? (() => undefined);
  const setDispatchingTurnId =
    options.setDispatchingTurnId ?? (() => undefined);
  const setInterruptingTurnId =
    options.setInterruptingTurnId ?? (() => undefined);
  let locallyStartedTurn: {
    client: OctosUiClient;
    sessionId: string;
    turnId: string;
  } | null = null;
  let acceptedOwner: {
    client: OctosUiClient;
    sessionId: string;
    turnId: string;
    state: "running" | "waiting" | "completed" | "failed";
  } | null = null;
  let interruptingTurnId: string | null = null;
  let dispatchingTurnId: string | null = null;
  let recovery: TurnRecoveryState | null = null;
  /** Hydrate's server foreground turn; local FIFO never advances over it. */
  let hydratedActiveTurn: {
    turnId: string;
    state: "active" | "interrupting";
  } | null = null;
  /** The start whose RPC timed out: unknown outcome until evidence arrives. */
  let timedOutStartTurnId: string | null = null;
  // Absence from hydrate cannot prove an RPC was rejected. Retain attempted
  // IDs across suspension, so an ambiguous accepted start is never replayed.
  const attemptedTurns = new Set<string>();
  // Review loading and control handback happen before a turn crosses the wire.
  let preflightTurnId: string | null = null;
  let steeringEnabled = false;
  let steerEpoch = 0;
  let steerInFlight = false;
  let steerUnknown = false;
  const terminalReceipts = new Set<string>();
  const steerAdmittedIds = new Set<string>();
  const retainedSteers: Array<{
    turn: PromptTurn;
    ownerTurnId: string;
    sent: boolean;
    returned: boolean;
  }> = [];

  const publishRecovery = (value: TurnRecoveryState | null) => {
    recovery = value;
    sync();
  };
  const clearRecovery = () => {
    recoveryRequests.invalidate();
    if (recovery) publishRecovery(null);
  };

  const reset = () => {
    clearRecovery();
    hydratedActiveTurn = null;
    timedOutStartTurnId = null;
    steerEpoch++;
    steerInFlight = false;
    steerUnknown = false;
    retainedSteers.length = 0;
    terminalReceipts.clear();
    steerAdmittedIds.clear();
    startRequests.invalidate();
    interruptRequests.invalidate();
    queueOf().clear();
    attemptedTurns.clear();
    preflightTurnId = null;
    locallyStartedTurn = null;
    acceptedOwner = null;
    dispatchingTurnId = null;
    setDispatchingTurnId(null);
    interruptingTurnId = null;
    setInterruptingTurnId(null);
    sync();
  };

  const startTurn = async (turn: PromptTurn) => {
    const currentDependencies = dependenciesRef.current;
    const client = currentDependencies.client();
    const sessionId = currentDependencies.sessionId();
    const queued = queueOf().snapshot().active;
    // A turn held by lifecycle recovery or blocked admission stays unsent (not
    // attempted); reconcile or the record's ready drain dispatches it later.
    if (
      !client ||
      !sessionId ||
      recovery ||
      !currentDependencies.canStart() ||
      steerInFlight ||
      steerUnknown ||
      queued?.turnId !== turn.turnId ||
      attemptedTurns.has(turn.turnId)
    )
      return;
    // Dispatch the queue's owned copy, never the caller's mutable object.
    turn = queued;
    attemptedTurns.add(turn.turnId);
    preflightTurnId = turn.turnId;
    locallyStartedTurn = { client, sessionId, turnId: turn.turnId };
    dispatchingTurnId = turn.turnId;
    setDispatchingTurnId(turn.turnId);
    currentDependencies.onDispatchState?.({
      state: "dispatching",
      client,
      sessionId,
      turnId: turn.turnId,
    });
    const request = startRequests.begin(client, sessionId);
    let reviewSent = false;
    let reviewRejected = false;
    currentDependencies.setTimeline((current) =>
      turn.kind === "review"
        ? addSystemMessage(
            current,
            `review-request:${turn.turnId}`,
            "Native code review",
            turn.text || "Review requested for current project changes.",
          )
        : addOptimisticUser(current, turn.turnId, turn.text),
    );
    // §5.2: a user prompt crosses the driver seam FIRST. Await the seat
    // release (or its refusal) BEFORE any turn/start frame is written.
    const seatGate = currentDependencies.releaseSeatBeforeTurn;
    if (seatGate && turn.kind !== "review") {
      const outcome = await seatGate();
      if (!requestIsCurrent()) return;
      if (!dependenciesRef.current.canStart()) {
        attemptedTurns.delete(turn.turnId);
        preflightTurnId = null;
        retireLocalDispatch(turn.turnId, "cancelled");
        startRequests.finish(request);
        return;
      }
      if (!outcome.sent) {
        retireLocalDispatch(turn.turnId, "rejected");
        dependenciesRef.current.onTurnNotSentRestore?.(turn, sessionId);
        dependenciesRef.current.setTimeline((current) =>
          addSystemMessage(
            current,
            `send-error:${turn.turnId}`,
            "Turn not sent",
            boundedTurnAdmissionError(outcome.message),
            "error",
          ),
        );
        settleTurn(turn.turnId, "failed");
        startRequests.finish(request);
        return;
      }
    }
    try {
      if (turn.kind === "review") {
        if (!currentDependencies.startReview)
          throw new Error("Native review is unavailable for this Session.");
        const result = await currentDependencies.startReview({
          client,
          sessionId,
          turnId: turn.turnId,
          ...(turn.text ? { prompt: turn.text } : {}),
          isCurrent: requestIsCurrent,
          markSent() {
            if (reviewSent) throw new Error("Native review was already sent.");
            if (!requestIsCurrent() || !dependenciesRef.current.canStart())
              throw new Error(
                "Native review authority changed before dispatch.",
              );
            reviewSent = true;
            preflightTurnId = null;
          },
        });
        if (!requestIsCurrent()) return;
        if (
          result.session_id !== sessionId ||
          result.turn_id !== turn.turnId ||
          result.workflow !== "code_review" ||
          result.backend !== "native"
        )
          throw new Error("Native review returned another turn or workflow.");
        if (!result.accepted) {
          reviewRejected = true;
          throw new Error("The server did not accept native review.");
        }
      } else {
        preflightTurnId = null;
        await client.startTurn({
          session_id: sessionId,
          turn_id: turn.turnId,
          input: [{ kind: "text", text: turn.text }],
          // rc11 clears the persisted reasoning selection when a turn omits it,
          // so every dispatched turn re-sends the value captured at enqueue time.
          ...(turn.reasoningEffort
            ? { reasoning_effort: turn.reasoningEffort }
            : {}),
          ...(turn.media?.length
            ? { media: turn.media.map((media) => ({ ...media })) }
            : {}),
        });
      }
      if (requestIsCurrent()) {
        acceptLocalDispatch(turn.turnId, "running");
      }
    } catch (reason) {
      if (!requestIsCurrent()) return;
      if (turn.kind !== "review" && !(reason instanceof OctosUiProtocolError)) {
        // Server-side activity may already have promoted the dispatch while
        // the ACK was still missing; then the timeout says nothing new.
        if (locallyStartedTurn?.turnId !== turn.turnId) return;
        // Missing ACKs and transport failures cannot prove rejection. Keep
        // the turn and FIFO until explicit lifecycle evidence arrives.
        timedOutStartTurnId = turn.turnId;
        dependenciesRef.current.setTimeline((current) =>
          addSystemMessage(
            current,
            `send-timeout:${turn.turnId}`,
            isRequestTimeout(reason)
              ? "Turn start timed out"
              : "Turn start unconfirmed",
            "The server did not acknowledge the turn. It may still be running — do not resubmit; check its status after reconnecting.",
            "error",
          ),
        );
        return;
      }
      const message = reason instanceof Error ? reason.message : String(reason);
      if (
        turn.kind === "review" &&
        reviewSent &&
        !reviewRejected &&
        !(reason instanceof OctosUiProtocolError)
      ) {
        // A timeout/invalid ACK does not prove rejection. Keep the actual queue
        // head and attempted UUID until canonical hydrate or a terminal settles
        // it; advancing here could run ordinary prompts over an active review.
        dependenciesRef.current.setTimeline((current) =>
          addSystemMessage(
            current,
            `review-uncertain:${turn.turnId}`,
            "Native review outcome unknown",
            `The request may have started. Wait for Session recovery; it will not be sent again. ${message}`,
            "error",
          ),
        );
        sync();
        return;
      }
      const collision =
        turn.kind === "review" ? null : turnCollisionFrom(reason);
      if (collision) {
        // Another attached client (a terminal, a second tab) holds the
        // session's only turn slot. That is an ordinary busy signal, not a
        // rejected turn: the prompt goes back to the composer instead of being
        // reported as failed and discarded.
        retireLocalDispatch(turn.turnId, "rejected");
        startRequests.invalidate();
        const transition = queueOf().settle(turn.turnId);
        // Core can send the occupier's terminal before replying to our start.
        // Never re-adopt that completed turn or wait for its terminal twice.
        const occupied = !terminalReceipts.has(collision.turnId);
        if (occupied) {
          attemptedTurns.add(collision.turnId);
          queueOf().restoreActive(
            { turnId: collision.turnId, text: "", origin: "adopted" },
            true,
          );
        }
        dependenciesRef.current.onTurnNotSentRestore?.(turn, sessionId);
        dependenciesRef.current.setTimeline((current) =>
          addSystemMessage(
            current,
            `send-busy:${turn.turnId}`,
            "Session busy",
            "Another client was working in this session, so this message was not sent. It was kept for retry and will return when the composer is empty. Send it again when the running turn finishes, or Stop that turn to take over.",
            "info",
          ),
        );
        sync();
        if (!occupied && transition.next) void startTurn(transition.next);
        return;
      }
      retireLocalDispatch(turn.turnId, "rejected");
      if (turn.kind !== "review")
        dependenciesRef.current.onTurnNotSentRestore?.(turn, sessionId);
      dependenciesRef.current.setTimeline((current) =>
        addSystemMessage(
          current,
          `send-error:${turn.turnId}`,
          turn.kind === "review" ? "Native review rejected" : "Turn rejected",
          message,
          "error",
        ),
      );
      settleTurn(turn.turnId, "failed");
    } finally {
      startRequests.finish(request);
    }

    function requestIsCurrent(): boolean {
      const latest = dependenciesRef.current;
      return (
        startRequests.isCurrent(request, latest.client(), latest.sessionId()) &&
        queueOf().snapshot().active?.turnId === turn.turnId
      );
    }
  };

  const settleTurn = (
    turnId: string,
    outcome: "completed" | "failed" = "completed",
  ) => {
    if (recovery?.turnId === turnId) clearRecovery();
    if (hydratedActiveTurn?.turnId === turnId) hydratedActiveTurn = null;
    if (timedOutStartTurnId === turnId) timedOutStartTurnId = null;
    terminalReceipts.add(turnId);
    if (terminalReceipts.size > 256)
      terminalReceipts.delete(terminalReceipts.values().next().value!);
    // Core returns undrained inputs BEFORE terminal. Remaining acknowledged
    // steers were consumed. An in-flight receipt is still needed for fallback.
    if (!steerInFlight) {
      for (let index = retainedSteers.length - 1; index >= 0; index--)
        if (retainedSteers[index]!.ownerTurnId === turnId)
          retainedSteers.splice(index, 1);
    }
    if (acceptedOwner?.turnId === turnId) {
      acceptedOwner = {
        ...acceptedOwner,
        state: outcome,
      };
    }
    if (locallyStartedTurn?.turnId === turnId) {
      retireLocalDispatch(turnId, "cancelled");
    }
    const otherActive = hydratedActiveTurn;
    if (
      otherActive &&
      otherActive.turnId !== turnId &&
      queueOf().snapshot().active?.turnId === turnId
    ) {
      // Both a lookup and a buffered terminal notification can settle the old
      // turn. Neither may advance local FIFO over another hydrated foreground.
      startRequests.invalidate();
      interruptRequests.invalidate();
      queueOf().settle(turnId);
      attemptedTurns.add(otherActive.turnId);
      queueOf().restoreActive(
        { turnId: otherActive.turnId, text: "", origin: "adopted" },
        true,
      );
      interruptingTurnId =
        otherActive.state === "interrupting" ? otherActive.turnId : null;
      setInterruptingTurnId(interruptingTurnId);
      const restore = queueOf().takeInterruptPrompt(turnId);
      if (restore)
        dependenciesRef.current.onInterruptPromptRestore?.(
          restore.prompt,
          restore.sessionId,
        );
      sync();
      return;
    }
    const transition = queueOf().settle(turnId);
    if (!transition.settled) return;
    startRequests.invalidate();
    interruptRequests.invalidate();
    if (interruptingTurnId === turnId) {
      interruptingTurnId = null;
      setInterruptingTurnId(null);
    }
    // This turn settled: if the user Esc/Ctrl+C'd it, give the prompt back —
    // into its OWNING session, even when another Session is now selected.
    const restore = queueOf().takeInterruptPrompt(turnId);
    if (restore)
      dependenciesRef.current.onInterruptPromptRestore?.(
        restore.prompt,
        restore.sessionId,
      );
    sync();
    if (transition.next) void startTurn(transition.next);
  };

  const enqueueTurn = (turn: PromptTurn): boolean => {
    if (
      recovery ||
      !dependenciesRef.current.canEnqueue() ||
      !turn.turnId.trim() ||
      (turn.kind !== "review" && !turn.text.trim() && !turn.media?.length)
    )
      return false;
    const snapshot = queueOf().snapshot();
    if (
      turn.kind === "review" &&
      (!dependenciesRef.current.startReview ||
        !dependenciesRef.current.canStart() ||
        !isProtocolUuid(turn.turnId) ||
        snapshot.active !== null ||
        snapshot.pending.length > 0 ||
        Boolean(turn.media?.length) ||
        turn.reasoningEffort !== undefined)
    )
      return false;
    if (
      attemptedTurns.has(turn.turnId) ||
      steerAdmittedIds.has(turn.turnId) ||
      snapshot.active?.turnId === turn.turnId ||
      snapshot.pending.some((pending) => pending.turnId === turn.turnId)
    )
      return false;
    const { startNow } = queueOf().enqueue({ ...turn, text: turn.text.trim() });
    sync();
    if (startNow) void startTurn(turn);
    return true;
  };

  const enqueuePrompt = (text: string): boolean => {
    if (recovery || !dependenciesRef.current.canEnqueue() || !text.trim())
      return false;
    // Capture the Session's reasoning selection NOW: rc11 clears the persisted
    // value when a turn omits it, and a queued prompt must keep the choice
    // made when it was typed, not a later re-selection.
    const reasoningEffort = dependenciesRef.current.reasoningEffort?.();
    const turn: PromptTurn = {
      turnId: crypto.randomUUID(),
      text: text.trim(),
      ...(reasoningEffort ? { reasoningEffort } : {}),
    };
    return enqueueTurn(turn);
  };

  function restageSteers(turns: readonly PromptTurn[]): void {
    if (!turns.length) return;
    const active = queue.snapshot().active;
    if (!active || !attemptedTurns.has(active.turnId)) {
      queue.restoreActive(turns[0]!, Boolean(active));
      queue.prependPending(turns.slice(1));
    } else queue.prependPending(turns);
    sync();
  }

  function reportSteer(turn: PromptTurn, title: string, body: string): void {
    dependenciesRef.current.setTimeline((current) =>
      addSystemMessage(
        current,
        `steer:${turn.turnId}`,
        title,
        body,
        title.includes("unknown") ? "error" : undefined,
      ),
    );
  }

  const submitTurn = (candidate: PromptTurn): boolean => {
    const current = dependenciesRef.current;
    const snapshot = queue.snapshot();
    const active = snapshot.active;
    const client = current.client();
    const sessionId = current.sessionId();
    if (
      !steeringEnabled ||
      recovery ||
      !current.steer ||
      !client ||
      !sessionId ||
      !active ||
      !attemptedTurns.has(active.turnId) ||
      dispatchingTurnId !== null ||
      !current.canStart() ||
      snapshot.pending.length ||
      interruptingTurnId ||
      steerInFlight ||
      steerUnknown ||
      candidate.kind ||
      candidate.media?.length ||
      candidate.reasoningEffort !== undefined
    )
      return enqueueTurn(candidate);
    if (
      !current.canEnqueue() ||
      !candidate.text.trim() ||
      !isProtocolUuid(active.turnId) ||
      !isProtocolUuid(candidate.turnId) ||
      attemptedTurns.has(candidate.turnId) ||
      steerAdmittedIds.has(candidate.turnId) ||
      retainedSteers.some((entry) => entry.turn.turnId === candidate.turnId)
    )
      return false;
    const turn = { ...candidate, text: candidate.text.trim() };
    steerAdmittedIds.add(turn.turnId);
    const entry = {
      turn,
      ownerTurnId: active.turnId,
      sent: false,
      returned: false,
    };
    retainedSteers.push(entry);
    steerInFlight = true;
    const epoch = steerEpoch;
    const isCurrent = () =>
      epoch === steerEpoch &&
      dependenciesRef.current.client() === client &&
      dependenciesRef.current.sessionId() === sessionId;
    sync();
    void (async () => {
      try {
        const result = await current.steer!({
          client,
          sessionId,
          expectedTurnId: active.turnId,
          text: turn.text,
          isCurrent,
          markSent() {
            if (
              entry.sent ||
              !isCurrent() ||
              !dependenciesRef.current.canStart() ||
              queue.snapshot().active?.turnId !== active.turnId ||
              interruptingTurnId
            )
              throw new Error(
                "Steering authority or active turn changed before dispatch",
              );
            entry.sent = true;
          },
        });
        if (!isCurrent()) return;
        if (
          !entry.sent ||
          !isProtocolUuid(result.turn_id) ||
          typeof result.steered !== "boolean" ||
          (result.steered && result.turn_id !== active.turnId)
        )
          throw new Error("Invalid native steering receipt");
        if (entry.returned) return;
        if (!result.steered) {
          // Core's atomic no-active fallback already STARTED this new UUID.
          // Adopt it without sending a second start or losing a waiting draft.
          const index = retainedSteers.indexOf(entry);
          if (index >= 0) retainedSteers.splice(index, 1);
          attemptedTurns.add(result.turn_id);
          if (!terminalReceipts.has(result.turn_id)) {
            const prior = queue.snapshot().active;
            if (
              prior &&
              prior.turnId !== active.turnId &&
              prior.turnId !== result.turn_id &&
              attemptedTurns.has(prior.turnId)
            )
              throw new Error(
                "Another confirmed turn superseded the steering receipt",
              );
            if (prior?.turnId === active.turnId) queue.settle(active.turnId);
            queue.restoreActive({ ...turn, turnId: result.turn_id }, true);
            acceptedOwner = {
              client,
              sessionId,
              turnId: result.turn_id,
              state: "running",
            };
          }
          reportSteer(
            turn,
            "Native steering started a new turn",
            "The prior turn ended before admission. Core started the submitted text as a new turn.",
          );
        } else reportSteer(turn, "Steering accepted", turn.text);
      } catch (reason) {
        if (!isCurrent() || entry.returned) return;
        if (!entry.sent || reason instanceof OctosUiProtocolError) {
          const index = retainedSteers.indexOf(entry);
          if (index >= 0) retainedSteers.splice(index, 1);
          restageSteers([turn]);
          reportSteer(
            turn,
            "Steering queued",
            "Steering was not admitted. The text remains ahead of later pending prompts.",
          );
        } else {
          steerUnknown = true;
          reportSteer(
            turn,
            "Steering outcome unknown",
            "The request may have been consumed or started a new turn. It will not be resent automatically. Recover the Session before continuing. Submitted text: " +
              turn.text,
          );
        }
      } finally {
        if (isCurrent()) {
          steerInFlight = false;
          if (!steerUnknown && terminalReceipts.has(entry.ownerTurnId)) {
            for (let index = retainedSteers.length - 1; index >= 0; index--)
              if (retainedSteers[index]!.ownerTurnId === entry.ownerTurnId)
                retainedSteers.splice(index, 1);
          }
          sync();
          const next = queue.snapshot().active;
          if (next) void startTurn(next);
        }
      }
    })();
    return true;
  };

  /**
   * A `turn/started` for a turn this app never queued means ANOTHER attached
   * client began a turn in this session: the server fans every session event
   * out to every connection that opened it, so a terminal typing into the same
   * session is visible here. Adopt it the way `reconcileFromHydrate` already
   * adopts a server-reported active turn — but marked "adopted", so the strip
   * and composer can name the other client instead of presenting the turn as
   * ours. Without this the adoption only happened at hydrate time, leaving a
   * live client idle-looking while someone else drove the session.
   *
   * Deliberately silent when we already own the foreground (our own turn, a
   * turn we dispatched, or anything already queued). Only one turn can be
   * active per session server-side, so a foreign start while we hold the
   * foreground means our own view is stale; hydrate reconciles that case with
   * the full ownership rules rather than this fast path guessing.
   */
  const adoptForeignTurn = (turnId: string): void => {
    if (attemptedTurns.has(turnId)) return;
    if (locallyStartedTurn?.turnId === turnId) return;
    const snapshot = queueOf().snapshot();
    if (snapshot.active) return;
    if (snapshot.pending.some((turn) => turn.turnId === turnId)) return;
    attemptedTurns.add(turnId);
    queueOf().restoreActive({ turnId, text: "", origin: "adopted" }, true);
    sync();
  };

  const observeSteerDropped = (notification: RpcNotification): void => {
    // Server-side activity for a turn proves acceptance even when its
    // turn/start RPC timed out locally.
    if (
      notificationMatchesSessionScope(
        notification,
        dependenciesRef.current.sessionId(),
      )
    ) {
      const activeTurnId = notificationTurnId(notification);
      if (activeTurnId) {
        confirmTurnAccepted(activeTurnId);
        if (notification.method === CORE_UI_METHODS.TURN_STARTED)
          adoptForeignTurn(activeTurnId);
      }
    }
    const params = notification.params;
    if (
      notification.method !== CORE_UI_METHODS.TURN_STEER_DROPPED ||
      !notificationMatchesSessionScope(
        notification,
        dependenciesRef.current.sessionId(),
      ) ||
      !params ||
      typeof params !== "object" ||
      Array.isArray(params)
    )
      return;
    const value = params as Record<string, unknown>;
    if (
      typeof value.session_id !== "string" ||
      !value.session_id ||
      !isProtocolUuid(value.turn_id) ||
      typeof value.reason !== "string" ||
      !Array.isArray(value.inputs) ||
      value.inputs.length > 10000 ||
      !value.inputs.every((text) => typeof text === "string")
    )
      return;
    const returned: PromptTurn[] = [];
    for (const text of value.inputs) {
      const index = retainedSteers.findIndex(
        (entry) =>
          entry.sent &&
          !entry.returned &&
          entry.ownerTurnId === value.turn_id &&
          entry.turn.text === text,
      );
      if (index < 0) continue;
      const entry = retainedSteers[index]!;
      entry.returned = true;
      retainedSteers.splice(index, 1);
      returned.push(entry.turn);
      reportSteer(entry.turn, "Steering returned to queue", entry.turn.text);
    }
    if (returned.length) steerUnknown = false;
    restageSteers(returned);
  };

  const interrupt = async () => {
    const currentDependencies = dependenciesRef.current;
    const client = currentDependencies.client();
    const sessionId = currentDependencies.sessionId();
    const activeTurn = queueOf().snapshot().active;
    if (recovery || !currentDependencies.canInterrupt()) return;
    if (!client || !sessionId || !activeTurn) {
      currentDependencies.setTimeline((current) =>
        addSystemMessage(
          current,
          `nothing-to-stop:${crypto.randomUUID()}`,
          "Nothing to stop",
          "There is no active foreground turn, so no server command was sent.",
        ),
      );
      return;
    }
    const activeTurnId = activeTurn.turnId;
    if (
      locallyStartedTurn?.client === client &&
      locallyStartedTurn.sessionId === sessionId &&
      locallyStartedTurn.turnId === activeTurnId
    ) {
      currentDependencies.setTimeline((current) =>
        addSystemMessage(
          current,
          `still-starting:${activeTurnId}`,
          "Turn is still starting",
          "Octos has not accepted this turn yet, so no interrupt was sent.",
        ),
      );
      return;
    }
    if (interruptingTurnId === activeTurnId) return;

    // Arm the per-session prompt restore (TUI parity, audit row 9): the prompt
    // returns only when THIS turn's own terminal lands. Keyed by the turn's
    // OWNING session inside the queue, so switching Sessions neither loses nor
    // misapplies a pending restore (one re-armable entry per session).
    if (activeTurn.text.trim())
      queueOf().stashInterruptPrompt(sessionId, activeTurnId, activeTurn.text);

    interruptingTurnId = activeTurnId;
    setInterruptingTurnId(activeTurnId);
    const request = interruptRequests.begin(client, sessionId);
    let accepted = false;
    try {
      await client.interruptTurn(sessionId, activeTurnId);
      accepted = requestIsCurrent();
    } catch (reason) {
      if (!requestIsCurrent()) return;
      dependenciesRef.current.setConnectionError(
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      const scopeIsCurrent = requestScopeIsCurrent();
      if (
        interruptRequests.finish(request) &&
        (!accepted || !scopeIsCurrent) &&
        interruptingTurnId === activeTurnId
      ) {
        interruptingTurnId = null;
        setInterruptingTurnId(null);
      }
    }

    function requestIsCurrent(): boolean {
      return interruptRequests.owns(request) && requestScopeIsCurrent();
    }

    function requestScopeIsCurrent(): boolean {
      const latest = dependenciesRef.current;
      return (
        interruptRequests.isCurrent(
          request,
          latest.client(),
          latest.sessionId(),
        ) && queueOf().snapshot().active?.turnId === activeTurnId
      );
    }
  };

  const retryTurnRecovery = async () => {
    const latest = dependenciesRef.current;
    const client = latest.client();
    const sessionId = latest.sessionId();
    const turnId = queueOf().snapshot().active?.turnId;
    if (!client || !sessionId || !turnId || recovery?.phase === "checking")
      return;
    if (!latest.canGetTurnState?.()) {
      publishRecovery({ turnId, phase: "unavailable" });
      return;
    }
    const request = recoveryRequests.begin(client, sessionId);
    publishRecovery({ turnId, phase: "checking" });
    try {
      const result = await client.getTurnState({
        session_id: sessionId,
        turn_id: turnId,
      });
      if (!requestIsCurrent()) return;
      if (
        result.session_id !== sessionId ||
        result.turn_id !== turnId ||
        !isTurnLifecycleState(result.state)
      ) {
        throw new Error(
          "The server returned status for a different or invalid turn.",
        );
      }
      if (result.state === "unknown") {
        publishRecovery({ turnId, phase: "unknown" });
        return;
      }
      applyRecoveredState(turnId, result.state);
    } catch (reason) {
      if (!requestIsCurrent()) return;
      publishRecovery({
        turnId,
        phase: "error",
        message: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      recoveryRequests.finish(request);
    }
    function requestIsCurrent(): boolean {
      const current = dependenciesRef.current;
      return (
        recoveryRequests.isCurrent(
          request,
          current.client(),
          current.sessionId(),
        ) && queueOf().snapshot().active?.turnId === turnId
      );
    }
  };

  function applyRecoveredState(
    turnId: string,
    state: Exclude<TurnLifecycleState, "unknown">,
  ): void {
    clearRecovery();
    startRequests.invalidate();
    acceptLocalDispatch(
      turnId,
      state === "completed"
        ? "completed"
        : state === "active" || state === "interrupting"
          ? "running"
          : "failed",
    );
    interruptRequests.invalidate();
    interruptingTurnId = state === "interrupting" ? turnId : null;
    setInterruptingTurnId(interruptingTurnId);
    if (state === "active" || state === "interrupting") {
      sync();
      return;
    }
    dependenciesRef.current.setTimeline((entries) =>
      settleTimelineTurn(entries, turnId, state),
    );
    dependenciesRef.current.onRecoveredTerminal?.(turnId);
    if (acceptedOwner?.turnId === turnId) {
      acceptedOwner = {
        ...acceptedOwner,
        state: state === "completed" ? "completed" : "failed",
      };
    }
    settleTurn(turnId, state === "completed" ? "completed" : "failed");
  }

  const reconcileFromHydrate = (
    hydrated: SessionHydrateResult,
    preserveTransportOwnership = false,
  ): PromptTurn | null => {
    if (hydrated.session_id !== dependenciesRef.current.sessionId())
      return null;
    // Canonical hydrate resolves whether Core's fallback owns a new active turn.
    steerUnknown = false;
    clearRecovery();
    if (!preserveTransportOwnership) {
      const localTurnId = locallyStartedTurn?.turnId;
      if (localTurnId) retireLocalDispatch(localTurnId, "cancelled");
      acceptedOwner = null;
    } else {
      if (!leaseMatchesCurrent(locallyStartedTurn)) {
        const localTurnId = locallyStartedTurn?.turnId;
        if (localTurnId) retireLocalDispatch(localTurnId, "cancelled");
      }
      if (!leaseMatchesCurrent(acceptedOwner)) {
        acceptedOwner = null;
      }
    }
    const snapshot = queueOf().snapshot();
    const serverActive = hydrated.turns?.find(
      (turn) => turn.state === "active" || turn.state === "interrupting",
    );
    hydratedActiveTurn = serverActive
      ? {
          turnId: serverActive.turn_id,
          state: serverActive.state as "active" | "interrupting",
        }
      : null;
    // Hydrate is authoritative for interrupt state. A server-confirmed
    // interrupt must keep Stop de-duplicated even though the original request
    // belongs to an older transport generation.
    interruptRequests.invalidate();
    const hydratedInterruptingTurnId =
      serverActive?.state === "interrupting" ? serverActive.turn_id : null;
    interruptingTurnId = hydratedInterruptingTurnId;
    setInterruptingTurnId(hydratedInterruptingTurnId);
    if (
      serverActive &&
      snapshot.active?.turnId !== serverActive.turn_id &&
      (!snapshot.active || !attemptedTurns.has(snapshot.active.turnId))
    ) {
      attemptedTurns.add(serverActive.turn_id);
      startRequests.invalidate();
      queueOf().restoreActive(
        {
          turnId: serverActive.turn_id,
          text: "",
          origin: "adopted",
        },
        true,
      );
      sync();
      return null;
    }
    if (!snapshot.active) return null;
    // A queue head that never reached Core (admission or recovery held its
    // dispatch) cannot appear in hydrate. Let the ready drain send it once.
    if (!attemptedTurns.has(snapshot.active.turnId)) return snapshot.active;
    const serverTurn = hydrated.turns?.find(
      (turn) => turn.turn_id === snapshot.active?.turnId,
    );
    // Absence is not proof that a just-dispatched start was rejected: hydrate
    // and the RPC can cross in flight. Preserve its authority so a later
    // rejection can still settle the local queue. Any explicit server state
    // supersedes that request completion.
    if (
      serverTurn &&
      isTurnLifecycleState(serverTurn.state) &&
      serverTurn.state !== "unknown"
    ) {
      attemptedTurns.add(serverTurn.turn_id);
      startRequests.invalidate();
      if (locallyStartedTurn?.turnId === snapshot.active.turnId) {
        acceptLocalDispatch(
          snapshot.active.turnId,
          serverTurn.state === "completed"
            ? "completed"
            : serverTurn.state === "active" ||
                serverTurn.state === "interrupting"
              ? "running"
              : "failed",
        );
      }
    }
    if (
      serverTurn &&
      isTurnLifecycleState(serverTurn.state) &&
      serverTurn.state !== "active" &&
      serverTurn.state !== "interrupting" &&
      serverTurn.state !== "unknown"
    ) {
      if (acceptedOwner?.turnId === snapshot.active.turnId) {
        acceptedOwner = {
          ...acceptedOwner,
          state: serverTurn.state === "completed" ? "completed" : "failed",
        };
      }
      const transition = queueOf().settle(snapshot.active.turnId);
      if (serverActive && serverActive.turn_id !== snapshot.active.turnId) {
        // Another server turn owns the foreground: pending prompts wait
        // behind it instead of dispatching over it.
        attemptedTurns.add(serverActive.turn_id);
        queueOf().restoreActive(
          { turnId: serverActive.turn_id, text: "", origin: "adopted" },
          true,
        );
        sync();
        return null;
      }
      sync();
      return transition.next;
    }
    // Hydrate can omit a received turn after registry/ledger loss. A later
    // snapshot is not proof it never ran, even when the start ACK timed out.
    if (
      !serverTurn ||
      serverTurn.state === "unknown" ||
      !isTurnLifecycleState(serverTurn.state)
    ) {
      void retryTurnRecovery();
    }
    return null;
  };

  const confirmTurnAccepted = (turnId: string): boolean => {
    const wasTimedOut = timedOutStartTurnId === turnId;
    const accepted = acceptLocalDispatch(turnId, "running");
    if (accepted && wasTimedOut) {
      dependenciesRef.current.setTimeline((current) =>
        addSystemMessage(
          current,
          `send-timeout:${turnId}`,
          "Turn start timed out",
          "The server had accepted the turn after all — no resubmission needed.",
          "info",
        ),
      );
    }
    return accepted;
  };

  return {
    queueSnapshot: () => queueOf().snapshot(),
    get turnRecovery() {
      return recovery;
    },
    turnRecoveryNow: () => recovery,
    retryTurnRecovery,
    dispatchingTurnIdNow: () => dispatchingTurnId,
    interruptingTurnIdNow: () => interruptingTurnId,
    interruptibleNow: () =>
      Boolean(
        queueOf().snapshot().active &&
        !recovery &&
        dispatchingTurnId !== queueOf().snapshot().active?.turnId &&
        dependenciesRef.current.canInterrupt(),
      ),
    snapshot: () => queueOf().snapshot(),
    backgroundHandoffTurn: () => {
      const owner = acceptedOwner;
      return owner && leaseMatchesCurrent(owner)
        ? { turnId: owner.turnId, state: owner.state }
        : null;
    },
    activeTurnOwnership: () => {
      const active = queueOf().snapshot().active;
      if (leaseMatchesCurrent(locallyStartedTurn)) {
        return "dispatching";
      }
      if (leaseMatchesCurrent(acceptedOwner)) return "local-owner";
      return active ? "observed" : "none";
    },
    clearTransportOwnership: () => {
      locallyStartedTurn = null;
      acceptedOwner = null;
      dispatchingTurnId = null;
      setDispatchingTurnId(null);
    },
    setAcceptedOwnerInteraction: (waiting, turnId) => {
      const owner = acceptedOwner;
      if (
        !owner ||
        !leaseMatchesCurrent(owner) ||
        (turnId !== undefined && owner.turnId !== turnId) ||
        owner.state === "completed" ||
        owner.state === "failed"
      ) {
        return false;
      }
      acceptedOwner = {
        ...owner,
        state: waiting ? "waiting" : "running",
      };
      return true;
    },
    restoreTransportOwnership: (turn) => {
      const current = dependenciesRef.current;
      const client = current.client();
      const sessionId = current.sessionId();
      if (!client || !sessionId || !turn.turnId) return false;
      locallyStartedTurn = null;
      dispatchingTurnId = null;
      setDispatchingTurnId(null);
      acceptedOwner = { client, sessionId, ...turn };
      return true;
    },
    confirmTurnAccepted,
    reset,
    enqueuePrompt,
    cancelQueuedPrompt: (turnId) => {
      if (!queueOf().removePending(turnId)) return false;
      sync();
      return true;
    },
    enqueueTurn,
    submitTurn,
    setSteeringEnabled: (enabled) => {
      steeringEnabled = enabled;
      sync();
    },
    steeringEnabled: () => steeringEnabled,
    observeSteerDropped,
    resumePendingTurn: () => {
      const active = queueOf().snapshot().active;
      if (active) void startTurn(active);
    },
    suspendTransport: () => {
      steerEpoch++;
      const unsent = retainedSteers
        .filter((entry) => !entry.sent)
        .map((entry) => entry.turn);
      for (const entry of retainedSteers)
        if (entry.sent && !entry.returned)
          reportSteer(
            entry.turn,
            "Steering outcome unknown",
            "Transport changed before consumption could be confirmed. This text will not be resent automatically: " +
              entry.turn.text,
          );
      retainedSteers.length = 0;
      steerInFlight = false;
      steerUnknown = false;
      restageSteers(unsent);
      // An interrupted lazy factory can resume on the same queue and UUID;
      // an ambiguous sent request cannot.
      if (preflightTurnId) attemptedTurns.delete(preflightTurnId);
      preflightTurnId = null;
      startRequests.invalidate();
      interruptRequests.invalidate();
      locallyStartedTurn = null;
      acceptedOwner = null;
      dispatchingTurnId = null;
      interruptingTurnId = null;
      setDispatchingTurnId(null);
      setInterruptingTurnId(null);
      sync();
    },
    interrupt,
    reconcileFromHydrate,
    startTurn,
    settleTurn,
  };

  function leaseMatchesCurrent(
    lease: { client: OctosUiClient; sessionId: string } | null,
  ): boolean {
    const current = dependenciesRef.current;
    return Boolean(
      lease &&
      lease.client === current.client() &&
      lease.sessionId === current.sessionId(),
    );
  }

  function clearDispatchingTurn(turnId: string): void {
    if (dispatchingTurnId !== turnId) return;
    dispatchingTurnId = null;
    setDispatchingTurnId(null);
  }

  function acceptLocalDispatch(
    turnId: string,
    state: "running" | "completed" | "failed",
  ): boolean {
    const dispatch = locallyStartedTurn;
    if (
      !dispatch ||
      dispatch.turnId !== turnId ||
      !leaseMatchesCurrent(dispatch)
    ) {
      return false;
    }
    // Background tool activity can outlive foreground completion. Only an
    // exact local dispatch acceptance supersedes lifecycle recovery; an
    // observer notification cannot cancel the authoritative status lookup.
    if (recovery?.turnId === turnId) clearRecovery();
    if (timedOutStartTurnId === turnId) timedOutStartTurnId = null;
    acceptedOwner = { ...dispatch, state };
    if (preflightTurnId === turnId) preflightTurnId = null;
    locallyStartedTurn = null;
    clearDispatchingTurn(turnId);
    dependenciesRef.current.onDispatchState?.({
      state: "accepted",
      client: dispatch.client,
      sessionId: dispatch.sessionId,
      turnId,
    });
    return true;
  }

  function retireLocalDispatch(
    turnId: string,
    state: "rejected" | "cancelled",
  ): boolean {
    const dispatch = locallyStartedTurn;
    if (!dispatch || dispatch.turnId !== turnId) return false;
    if (preflightTurnId === turnId) preflightTurnId = null;
    locallyStartedTurn = null;
    clearDispatchingTurn(turnId);
    dependenciesRef.current.onDispatchState?.({
      state,
      client: dispatch.client,
      sessionId: dispatch.sessionId,
      turnId,
    });
    return true;
  }
}

const TURN_LIFECYCLE_STATES: ReadonlySet<string> = new Set([
  "active",
  "interrupting",
  "completed",
  "errored",
  "interrupted",
  "unknown",
]);

// Mirrors the client's isTurnLifecycleState without importing the transport-
// bearing package root into this render-time controller.
function isTurnLifecycleState(value: unknown): value is TurnLifecycleState {
  return typeof value === "string" && TURN_LIFECYCLE_STATES.has(value);
}

// OctosUiRequestTimeoutError lives in the lazily loaded transport; match its
// stable error name instead of importing the class for instanceof.
function isRequestTimeout(reason: unknown): boolean {
  return (
    reason instanceof Error && reason.name === "OctosUiRequestTimeoutError"
  );
}
