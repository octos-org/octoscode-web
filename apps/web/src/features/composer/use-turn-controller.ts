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

interface TurnControllerDependencies {
  client: () => OctosUiClient | null;
  sessionId: () => string;
  canEnqueue: () => boolean;
  canStart: () => boolean;
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
    queueRef.current.clear();
    interruptingTurnIdRef.current = null;
    setInterruptingTurnId(null);
    sync();
  };

  const startTurn = async (turn: PromptTurn) => {
    const client = dependencies.client();
    const sessionId = dependencies.sessionId();
    if (!client || !sessionId || !dependencies.canStart()) return;

    dependencies.setTimeline((current) =>
      addOptimisticUser(current, turn.turnId, turn.text),
    );
    try {
      await client.startTurn({
        session_id: sessionId,
        turn_id: turn.turnId,
        input: [{ kind: "text", text: turn.text }],
      });
    } catch (reason) {
      if (dependencies.client() !== client) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      dependencies.setTimeline((current) =>
        addSystemMessage(
          current,
          `send-error:${turn.turnId}`,
          "Turn rejected",
          message,
          "error",
        ),
      );
      settleTurn(turn.turnId);
    }
  };

  const settleTurn = (turnId: string) => {
    const transition = queueRef.current.settle(turnId);
    if (!transition.settled) return;
    if (interruptingTurnIdRef.current === turnId) {
      interruptingTurnIdRef.current = null;
      setInterruptingTurnId(null);
    }
    sync();
    if (transition.next) void startTurn(transition.next);
  };

  const enqueuePrompt = (text: string) => {
    if (!dependencies.canEnqueue() || !text.trim()) return;
    const turn: PromptTurn = { turnId: crypto.randomUUID(), text: text.trim() };
    const { startNow } = queueRef.current.enqueue(turn);
    sync();
    if (startNow) void startTurn(turn);
  };

  const interrupt = async () => {
    const client = dependencies.client();
    const activeTurn = queueRef.current.snapshot().active;
    if (!client || !activeTurn) {
      dependencies.setTimeline((current) =>
        addSystemMessage(
          current,
          `nothing-to-stop:${crypto.randomUUID()}`,
          "Nothing to stop",
          "There is no active foreground turn, so no server command was sent.",
        ),
      );
      return;
    }
    if (interruptingTurnIdRef.current === activeTurn.turnId) return;

    interruptingTurnIdRef.current = activeTurn.turnId;
    setInterruptingTurnId(activeTurn.turnId);
    try {
      await client.interruptTurn(dependencies.sessionId(), activeTurn.turnId);
    } catch (reason) {
      interruptingTurnIdRef.current = null;
      setInterruptingTurnId(null);
      dependencies.setConnectionError(
        reason instanceof Error ? reason.message : String(reason),
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
    if (!snapshot.active && serverActive) {
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
