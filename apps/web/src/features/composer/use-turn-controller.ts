import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type {
  OctosUiClient,
  SessionHydrateResult,
} from "@octos-org/octoscode-client";
import {
  addOptimisticUser,
  addSystemMessage,
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

export interface TurnController {
  queue: PromptTurnQueueSnapshot;
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
  interrupt: () => Promise<void>;
  reconcileFromHydrate: (
    hydrated: SessionHydrateResult,
    preserveTransportOwnership?: boolean,
  ) => PromptTurn | null;
  clearTransportOwnership: () => void;
  /** Keep an accepted local owner's handoff state aligned with interactions. */
  setAcceptedOwnerInteraction: (waiting: boolean) => boolean;
  restoreTransportOwnership: (turn: {
    turnId: string;
    state: "running" | "waiting" | "completed" | "failed";
  }) => boolean;
  startTurn: (turn: PromptTurn) => Promise<void>;
  settleTurn: (turnId: string, outcome?: "completed" | "failed") => void;
}

export function useTurnController(
  dependencies: TurnControllerDependencies,
): TurnController {
  const startRequestsRef = useRef(new RequestAuthorityGate<OctosUiClient>());
  const interruptRequestsRef = useRef(
    new RequestAuthorityGate<OctosUiClient>(),
  );
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const queueRef = useRef(new PromptTurnQueue());
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

  const reset = () => {
    startRequestsRef.current.invalidate();
    interruptRequestsRef.current.invalidate();
    queueRef.current.clear();
    locallyStartedTurnRef.current = null;
    acceptedOwnerRef.current = null;
    dispatchingTurnIdRef.current = null;
    setDispatchingTurnId(null);
    interruptingTurnIdRef.current = null;
    setInterruptingTurnId(null);
    sync();
  };

  const startTurn = async (turn: PromptTurn) => {
    const currentDependencies = dependenciesRef.current;
    const client = currentDependencies.client();
    const sessionId = currentDependencies.sessionId();
    if (!client || !sessionId || !currentDependencies.canStart()) return;
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
    if (acceptedOwnerRef.current?.turnId === turnId) {
      acceptedOwnerRef.current = {
        ...acceptedOwnerRef.current,
        state: outcome,
      };
    }
    if (locallyStartedTurnRef.current?.turnId === turnId) {
      retireLocalDispatch(turnId, "cancelled");
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
    if (!dependenciesRef.current.canEnqueue() || !text.trim()) return;
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
    if (!currentDependencies.canInterrupt()) return;
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

  const reconcileFromHydrate = (
    hydrated: SessionHydrateResult,
    preserveTransportOwnership = false,
  ): PromptTurn | null => {
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
    // Hydrate is authoritative for interrupt state. A server-confirmed
    // interrupt must keep Stop de-duplicated even though the original request
    // belongs to an older transport generation.
    interruptRequestsRef.current.invalidate();
    const hydratedInterruptingTurnId =
      serverActive?.state === "interrupting" ? serverActive.turn_id : null;
    interruptingTurnIdRef.current = hydratedInterruptingTurnId;
    setInterruptingTurnId(hydratedInterruptingTurnId);
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
    if (serverTurn && serverTurn.state !== "unknown") {
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
      serverTurn.state !== "active" &&
      serverTurn.state !== "interrupting" &&
      serverTurn.state !== "unknown"
    ) {
      const transition = queueRef.current.settle(snapshot.active.turnId);
      if (acceptedOwnerRef.current?.turnId === snapshot.active.turnId) {
        acceptedOwnerRef.current = {
          ...acceptedOwnerRef.current,
          state: serverTurn.state === "completed" ? "completed" : "failed",
        };
      }
      sync();
      return transition.next;
    }
    return null;
  };

  return {
    queue,
    dispatchingTurnId,
    interruptible: Boolean(
      queue.active &&
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
    setAcceptedOwnerInteraction: (waiting) => {
      const owner = acceptedOwnerRef.current;
      if (
        !owner ||
        !leaseMatchesCurrent(owner) ||
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
    reset,
    enqueuePrompt,
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
