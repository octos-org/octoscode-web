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
}

export interface TurnController {
  queue: PromptTurnQueueSnapshot;
  interruptingTurnId: string | null;
  snapshot: () => PromptTurnQueueSnapshot;
  reset: () => void;
  enqueuePrompt: (text: string) => void;
  interrupt: () => Promise<void>;
  reconcileFromHydrate: (hydrated: SessionHydrateResult) => PromptTurn | null;
  startTurn: (turn: PromptTurn) => Promise<void>;
  settleTurn: (turnId: string) => void;
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
  const interruptingTurnIdRef = useRef<string | null>(null);
  const [queue, setQueue] = useState<PromptTurnQueueSnapshot>(() =>
    queueRef.current.snapshot(),
  );
  const [interruptingTurnId, setInterruptingTurnId] = useState<string | null>(
    null,
  );

  const sync = () => setQueue(queueRef.current.snapshot());

  const reset = () => {
    startRequestsRef.current.invalidate();
    interruptRequestsRef.current.invalidate();
    queueRef.current.clear();
    interruptingTurnIdRef.current = null;
    setInterruptingTurnId(null);
    sync();
  };

  const startTurn = async (turn: PromptTurn) => {
    const currentDependencies = dependenciesRef.current;
    const client = currentDependencies.client();
    const sessionId = currentDependencies.sessionId();
    if (!client || !sessionId || !currentDependencies.canStart()) return;
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
    } catch (reason) {
      if (!requestIsCurrent()) return;
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

  const settleTurn = (turnId: string) => {
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
  ): PromptTurn | null => {
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
    }
    if (
      serverTurn &&
      serverTurn.state !== "active" &&
      serverTurn.state !== "interrupting" &&
      serverTurn.state !== "unknown"
    ) {
      const transition = queueRef.current.settle(snapshot.active.turnId);
      sync();
      return transition.next;
    }
    return null;
  };

  return {
    queue,
    interruptingTurnId,
    snapshot: () => queueRef.current.snapshot(),
    reset,
    enqueuePrompt,
    interrupt,
    reconcileFromHydrate,
    startTurn,
    settleTurn,
  };
}
