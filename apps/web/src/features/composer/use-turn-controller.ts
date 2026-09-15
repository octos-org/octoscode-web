import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  OctosUiProtocolError,
  OctosUiRequestTimeoutError,
  isTurnLifecycleState,
} from "@octos-org/octoscode-client";
import type {
  OctosUiClient,
  SessionHydrateResult,
  TurnLifecycleState,
} from "@octos-org/octoscode-client";
import {
  addOptimisticUser,
  addSystemMessage,
  settleTimelineTurn,
  type TimelineEntry,
} from "../timeline/model.ts";
import {
  PromptTurnQueue,
  type PromptTurn,
  type PromptTurnQueueSnapshot,
} from "./turn-queue.ts";
import { RequestAuthorityGate } from "../async/request-authority.ts";

interface TurnControllerDependencies {
  client: () => OctosUiClient | null;
  sessionId: () => string;
  canEnqueue: () => boolean;
  canStart: () => boolean;
  canInterrupt: () => boolean;
  canGetTurnState: () => boolean;
  onRecoveredTerminal?: (turnId: string) => void;
  setTimeline: Dispatch<SetStateAction<TimelineEntry[]>>;
  setConnectionError: (message: string) => void;
  onDispatchState?: (event: TurnDispatchStateEvent) => void;
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

export interface TurnController {
  queue: PromptTurnQueueSnapshot;
  turnRecovery: TurnRecoveryState | null;
  retryTurnRecovery: () => Promise<void>;
  /** The optimistic start request that has not yet been accepted by Core. */
  dispatchingTurnId: string | null;
  /** True only when the active turn is server-owned and interrupt is advertised. */
  interruptible: boolean;
  interruptingTurnId: string | null;
  snapshot: () => PromptTurnQueueSnapshot;
  /**
   * The active turn only after `turn/start` has been accepted by Core.
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
  enqueuePrompt: (text: string) => void;
  cancelQueuedPrompt: (turnId: string) => boolean;
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

export function useTurnController(
  dependencies: TurnControllerDependencies,
): TurnController {
  const recoveryRequestsRef = useRef(new RequestAuthorityGate<OctosUiClient>());
  const recoveryRef = useRef<TurnRecoveryState | null>(null);
  const [, setTurnRecovery] = useState<TurnRecoveryState | null>(null);
  const startRequestsRef = useRef(new RequestAuthorityGate<OctosUiClient>());
  const interruptRequestsRef = useRef(
    new RequestAuthorityGate<OctosUiClient>(),
  );
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const queueRef = useRef(new PromptTurnQueue());
  const hydratedActiveTurnRef = useRef<{
    turnId: string;
    state: "active" | "interrupting";
  } | null>(null);
  const locallyStartedTurnRef = useRef<{
    client: OctosUiClient;
    sessionId: string;
    turnId: string;
  } | null>(null);
  const acceptedOwnerRef = useRef<{
    client: OctosUiClient;
    sessionId: string;
    turnId: string;
    state: "running" | "waiting" | "completed" | "failed";
  } | null>(null);
  const interruptingTurnIdRef = useRef<string | null>(null);
  /** The start whose RPC timed out: unknown outcome until evidence arrives. */
  const timedOutStartTurnIdRef = useRef<string | null>(null);
  /** A queued prompt promoted while transport recovery still blocks dispatch. */
  const deferredStartTurnIdRef = useRef<string | null>(null);
  const dispatchingTurnIdRef = useRef<string | null>(null);
  const [queue, setQueue] = useState<PromptTurnQueueSnapshot>(() =>
    queueRef.current.snapshot(),
  );
  const [dispatchingTurnId, setDispatchingTurnId] = useState<string | null>(
    null,
  );
  const [interruptingTurnId, setInterruptingTurnId] = useState<string | null>(
    null,
  );

  const sync = () => setQueue(queueRef.current.snapshot());

  const publishRecovery = (value: TurnRecoveryState | null) => {
    recoveryRef.current = value;
    setTurnRecovery(value);
  };
  const clearRecovery = () => {
    recoveryRequestsRef.current.invalidate();
    publishRecovery(null);
  };

  const reset = () => {
    clearRecovery();
    startRequestsRef.current.invalidate();
    interruptRequestsRef.current.invalidate();
    queueRef.current.clear();
    hydratedActiveTurnRef.current = null;
    locallyStartedTurnRef.current = null;
    acceptedOwnerRef.current = null;
    dispatchingTurnIdRef.current = null;
    timedOutStartTurnIdRef.current = null;
    deferredStartTurnIdRef.current = null;
    setDispatchingTurnId(null);
    interruptingTurnIdRef.current = null;
    setInterruptingTurnId(null);
    sync();
  };

  const startTurn = async (turn: PromptTurn) => {
    const currentDependencies = dependenciesRef.current;
    const client = currentDependencies.client();
    const sessionId = currentDependencies.sessionId();
    if (!client || !sessionId) return;
    if (recoveryRef.current || !currentDependencies.canStart()) {
      deferredStartTurnIdRef.current = turn.turnId;
      return;
    }
    deferredStartTurnIdRef.current = null;
    locallyStartedTurnRef.current = { client, sessionId, turnId: turn.turnId };
    dispatchingTurnIdRef.current = turn.turnId;
    setDispatchingTurnId(turn.turnId);
    currentDependencies.onDispatchState?.({
      state: "dispatching",
      client,
      sessionId,
      turnId: turn.turnId,
    });
    const request = startRequestsRef.current.begin(client, sessionId);

    currentDependencies.setTimeline((current) =>
      addOptimisticUser(current, turn.turnId, turn.text),
    );
    try {
      await client.startTurn({
        session_id: sessionId,
        turn_id: turn.turnId,
        input: [{ kind: "text", text: turn.text }],
      });
      if (requestIsCurrent()) {
        acceptLocalDispatch(turn.turnId, "running");
      }
    } catch (reason) {
      if (!requestIsCurrent()) return;
      if (!(reason instanceof OctosUiProtocolError)) {
        // Server-side activity may already have promoted the dispatch while
        // the ACK was still missing; then the timeout says nothing new.
        if (locallyStartedTurnRef.current?.turnId !== turn.turnId) return;
        // Missing ACKs and transport failures cannot prove rejection. Keep
        // the turn and FIFO until explicit lifecycle evidence arrives.
        timedOutStartTurnIdRef.current = turn.turnId;
        dependenciesRef.current.setTimeline((current) =>
          addSystemMessage(
            current,
            `send-timeout:${turn.turnId}`,
            reason instanceof OctosUiRequestTimeoutError
              ? "Turn start timed out"
              : "Turn start unconfirmed",
            "The server did not acknowledge the turn. It may still be running — do not resubmit; check its status after reconnecting.",
            "error",
          ),
        );
        return;
      }
      retireLocalDispatch(turn.turnId, "rejected");
      const message = reason instanceof Error ? reason.message : String(reason);
      dependenciesRef.current.setTimeline((current) =>
        addSystemMessage(
          current,
          `send-error:${turn.turnId}`,
          "Turn rejected",
          message,
          "error",
        ),
      );
      settleTurn(turn.turnId);
    } finally {
      startRequestsRef.current.finish(request);
    }

    function requestIsCurrent(): boolean {
      const latest = dependenciesRef.current;
      return (
        startRequestsRef.current.isCurrent(
          request,
          latest.client(),
          latest.sessionId(),
        ) && queueRef.current.snapshot().active?.turnId === turn.turnId
      );
    }
  };

  const settleTurn = (
    turnId: string,
    outcome: "completed" | "failed" = "completed",
  ) => {
    if (recoveryRef.current?.turnId === turnId) clearRecovery();
    if (hydratedActiveTurnRef.current?.turnId === turnId)
      hydratedActiveTurnRef.current = null;
    if (deferredStartTurnIdRef.current === turnId) {
      deferredStartTurnIdRef.current = null;
    }
    if (timedOutStartTurnIdRef.current === turnId) {
      timedOutStartTurnIdRef.current = null;
    }
    if (acceptedOwnerRef.current?.turnId === turnId) {
      acceptedOwnerRef.current = {
        ...acceptedOwnerRef.current,
        state: outcome,
      };
    }
    if (locallyStartedTurnRef.current?.turnId === turnId) {
      retireLocalDispatch(turnId, "cancelled");
    }
    const otherActive = hydratedActiveTurnRef.current;
    const snapshot = queueRef.current.snapshot();
    if (
      snapshot.active?.turnId === turnId &&
      otherActive &&
      otherActive.turnId !== turnId
    ) {
      // Both a lookup and a buffered terminal notification can settle the old
      // turn. Neither may advance local FIFO over another hydrated foreground.
      startRequestsRef.current.invalidate();
      interruptRequestsRef.current.invalidate();
      queueRef.current.clear();
      queueRef.current.restoreActive({ turnId: otherActive.turnId, text: "" });
      for (const prompt of snapshot.pending) queueRef.current.enqueue(prompt);
      interruptingTurnIdRef.current =
        otherActive.state === "interrupting" ? otherActive.turnId : null;
      setInterruptingTurnId(interruptingTurnIdRef.current);
      sync();
      return;
    }
    const transition = queueRef.current.settle(turnId);
    if (!transition.settled) return;
    startRequestsRef.current.invalidate();
    interruptRequestsRef.current.invalidate();
    if (interruptingTurnIdRef.current === turnId) {
      interruptingTurnIdRef.current = null;
      setInterruptingTurnId(null);
    }
    sync();
    if (transition.next) void startTurn(transition.next);
  };

  const enqueuePrompt = (text: string) => {
    if (
      recoveryRef.current ||
      !dependenciesRef.current.canEnqueue() ||
      !text.trim()
    )
      return;
    const turn: PromptTurn = { turnId: crypto.randomUUID(), text: text.trim() };
    const { startNow } = queueRef.current.enqueue(turn);
    sync();
    if (startNow) void startTurn(turn);
  };

  const interrupt = async () => {
    const currentDependencies = dependenciesRef.current;
    const client = currentDependencies.client();
    const sessionId = currentDependencies.sessionId();
    const activeTurn = queueRef.current.snapshot().active;
    if (recoveryRef.current || !currentDependencies.canInterrupt()) return;
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
      locallyStartedTurnRef.current?.client === client &&
      locallyStartedTurnRef.current.sessionId === sessionId &&
      locallyStartedTurnRef.current.turnId === activeTurnId
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
    if (interruptingTurnIdRef.current === activeTurnId) return;

    interruptingTurnIdRef.current = activeTurnId;
    setInterruptingTurnId(activeTurnId);
    const request = interruptRequestsRef.current.begin(client, sessionId);
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
        interruptRequestsRef.current.finish(request) &&
        (!accepted || !scopeIsCurrent) &&
        interruptingTurnIdRef.current === activeTurnId
      ) {
        interruptingTurnIdRef.current = null;
        setInterruptingTurnId(null);
      }
    }

    function requestIsCurrent(): boolean {
      return (
        interruptRequestsRef.current.owns(request) && requestScopeIsCurrent()
      );
    }

    function requestScopeIsCurrent(): boolean {
      const latest = dependenciesRef.current;
      return (
        interruptRequestsRef.current.isCurrent(
          request,
          latest.client(),
          latest.sessionId(),
        ) && queueRef.current.snapshot().active?.turnId === activeTurnId
      );
    }
  };

  const retryTurnRecovery = async () => {
    const latest = dependenciesRef.current;
    const client = latest.client();
    const sessionId = latest.sessionId();
    const turnId = queueRef.current.snapshot().active?.turnId;
    if (
      !client ||
      !sessionId ||
      !turnId ||
      recoveryRef.current?.phase === "checking"
    )
      return;
    if (!latest.canGetTurnState()) {
      publishRecovery({ turnId, phase: "unavailable" });
      return;
    }
    const request = recoveryRequestsRef.current.begin(client, sessionId);
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
      recoveryRequestsRef.current.finish(request);
    }
    function requestIsCurrent() {
      const current = dependenciesRef.current;
      return (
        recoveryRequestsRef.current.isCurrent(
          request,
          current.client(),
          current.sessionId(),
        ) && queueRef.current.snapshot().active?.turnId === turnId
      );
    }
  };

  function applyRecoveredState(
    turnId: string,
    state: Exclude<TurnLifecycleState, "unknown">,
  ) {
    clearRecovery();
    startRequestsRef.current.invalidate();
    acceptLocalDispatch(
      turnId,
      state === "completed"
        ? "completed"
        : state === "active" || state === "interrupting"
          ? "running"
          : "failed",
    );
    interruptRequestsRef.current.invalidate();
    interruptingTurnIdRef.current = state === "interrupting" ? turnId : null;
    setInterruptingTurnId(interruptingTurnIdRef.current);
    if (state === "active" || state === "interrupting") return;
    dependenciesRef.current.setTimeline((entries) =>
      settleTimelineTurn(entries, turnId, state),
    );
    dependenciesRef.current.onRecoveredTerminal?.(turnId);
    if (acceptedOwnerRef.current?.turnId === turnId) {
      acceptedOwnerRef.current = {
        ...acceptedOwnerRef.current,
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
    clearRecovery();
    if (!preserveTransportOwnership) {
      const localTurnId = locallyStartedTurnRef.current?.turnId;
      if (localTurnId) retireLocalDispatch(localTurnId, "cancelled");
      acceptedOwnerRef.current = null;
    } else {
      if (!leaseMatchesCurrent(locallyStartedTurnRef.current)) {
        const localTurnId = locallyStartedTurnRef.current?.turnId;
        if (localTurnId) retireLocalDispatch(localTurnId, "cancelled");
      }
      if (!leaseMatchesCurrent(acceptedOwnerRef.current)) {
        acceptedOwnerRef.current = null;
      }
    }
    const snapshot = queueRef.current.snapshot();
    const serverActive = hydrated.turns?.find(
      (turn) => turn.state === "active" || turn.state === "interrupting",
    );
    hydratedActiveTurnRef.current = serverActive
      ? {
          turnId: serverActive.turn_id,
          state: serverActive.state as "active" | "interrupting",
        }
      : null;
    // Hydrate is authoritative for interrupt state. A server-confirmed
    // interrupt must keep Stop de-duplicated even though the original request
    // belongs to an older transport generation.
    interruptRequestsRef.current.invalidate();
    const hydratedInterruptingTurnId =
      serverActive?.state === "interrupting" ? serverActive.turn_id : null;
    interruptingTurnIdRef.current = hydratedInterruptingTurnId;
    setInterruptingTurnId(hydratedInterruptingTurnId);
    if (
      snapshot.active &&
      deferredStartTurnIdRef.current === snapshot.active.turnId
    ) {
      if (serverActive) {
        // A lost start ACK can promote the next local prompt just before
        // reconnect proves the previous server turn is still running. Put
        // the unsent prompt back at the front of the FIFO behind that turn.
        queueRef.current.clear();
        queueRef.current.restoreActive({
          turnId: serverActive.turn_id,
          text: "",
        });
        queueRef.current.enqueue(snapshot.active);
        for (const pending of snapshot.pending)
          queueRef.current.enqueue(pending);
        deferredStartTurnIdRef.current = null;
        sync();
        return null;
      }
      // This prompt has never reached Core, so hydrate cannot report it.
      // Let session-ready dispatch it once recovery has reopened admission.
      return snapshot.active;
    }
    if (!snapshot.active && serverActive) {
      startRequestsRef.current.invalidate();
      queueRef.current.restoreActive({
        turnId: serverActive.turn_id,
        text: "",
      });
      sync();
      return null;
    }
    if (!snapshot.active) return null;
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
      startRequestsRef.current.invalidate();
      if (locallyStartedTurnRef.current?.turnId === snapshot.active.turnId) {
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
      if (acceptedOwnerRef.current?.turnId === snapshot.active.turnId) {
        acceptedOwnerRef.current = {
          ...acceptedOwnerRef.current,
          state: serverTurn.state === "completed" ? "completed" : "failed",
        };
      }
      if (serverActive && serverActive.turn_id !== snapshot.active.turnId) {
        queueRef.current.clear();
        queueRef.current.restoreActive({
          turnId: serverActive.turn_id,
          text: "",
        });
        for (const prompt of snapshot.pending) queueRef.current.enqueue(prompt);
        sync();
        return null;
      }
      const transition = queueRef.current.settle(snapshot.active.turnId);
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

  return {
    queue,
    get turnRecovery() {
      return recoveryRef.current;
    },
    retryTurnRecovery,
    dispatchingTurnId,
    interruptible: Boolean(
      queue.active &&
      !recoveryRef.current &&
      dispatchingTurnId !== queue.active.turnId &&
      dependencies.canInterrupt(),
    ),
    interruptingTurnId,
    snapshot: () => queueRef.current.snapshot(),
    backgroundHandoffTurn: () => {
      const owner = acceptedOwnerRef.current;
      return owner && leaseMatchesCurrent(owner)
        ? { turnId: owner.turnId, state: owner.state }
        : null;
    },
    activeTurnOwnership: () => {
      const active = queueRef.current.snapshot().active;
      if (leaseMatchesCurrent(locallyStartedTurnRef.current)) {
        return "dispatching";
      }
      if (leaseMatchesCurrent(acceptedOwnerRef.current)) return "local-owner";
      return active ? "observed" : "none";
    },
    clearTransportOwnership: () => {
      locallyStartedTurnRef.current = null;
      acceptedOwnerRef.current = null;
      dispatchingTurnIdRef.current = null;
      setDispatchingTurnId(null);
    },
    setAcceptedOwnerInteraction: (waiting, turnId) => {
      const owner = acceptedOwnerRef.current;
      if (
        !owner ||
        !leaseMatchesCurrent(owner) ||
        (turnId !== undefined && owner.turnId !== turnId) ||
        owner.state === "completed" ||
        owner.state === "failed"
      ) {
        return false;
      }
      acceptedOwnerRef.current = {
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
      locallyStartedTurnRef.current = null;
      dispatchingTurnIdRef.current = null;
      setDispatchingTurnId(null);
      acceptedOwnerRef.current = { client, sessionId, ...turn };
      return true;
    },
    confirmTurnAccepted: (turnId) => {
      const wasTimedOut = timedOutStartTurnIdRef.current === turnId;
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
    },
    reset,
    enqueuePrompt,
    cancelQueuedPrompt: (turnId) => {
      if (!queueRef.current.removePending(turnId)) return false;
      sync();
      return true;
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
    if (dispatchingTurnIdRef.current !== turnId) return;
    dispatchingTurnIdRef.current = null;
    setDispatchingTurnId(null);
  }

  function acceptLocalDispatch(
    turnId: string,
    state: "running" | "completed" | "failed",
  ): boolean {
    const dispatch = locallyStartedTurnRef.current;
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
    if (recoveryRef.current?.turnId === turnId) clearRecovery();
    if (timedOutStartTurnIdRef.current === turnId) {
      timedOutStartTurnIdRef.current = null;
    }
    acceptedOwnerRef.current = { ...dispatch, state };
    locallyStartedTurnRef.current = null;
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
    const dispatch = locallyStartedTurnRef.current;
    if (!dispatch || dispatch.turnId !== turnId) return false;
    locallyStartedTurnRef.current = null;
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
