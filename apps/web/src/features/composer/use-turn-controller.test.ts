import { createElement, type Dispatch, type SetStateAction } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OctosUiClient } from "@octos-org/octoscode-client";
import type { TimelineEntry } from "../timeline/model.ts";
import {
  useTurnController,
  type TurnController,
} from "./use-turn-controller.ts";

describe("useTurnController async authority", () => {
  it("keeps a server-confirmed interrupt de-duplicated after hydrate", async () => {
    const interrupt = deferred<void>();
    const client = fakeClient({ interrupt: () => interrupt.promise });
    const harness = renderController(client);

    harness.controller.enqueuePrompt("ship it");
    const first = harness.controller.interrupt();
    expect(client.interruptTurn).toHaveBeenCalledTimes(1);

    harness.controller.reconcileFromHydrate({
      session_id: "session-a",
      cursor: { stream: "session-a", seq: 2 },
      turns: [{ turn_id: harness.activeTurnId(), state: "interrupting" }],
    });
    await harness.controller.interrupt();

    expect(client.interruptTurn).toHaveBeenCalledTimes(1);
    interrupt.resolve(undefined);
    await first;
  });

  it("preserves a pending start rejection when hydrate has no turn evidence", async () => {
    const start = deferred<void>();
    const client = fakeClient({ start: () => start.promise });
    const harness = renderController(client);

    harness.controller.enqueuePrompt("ship it");
    harness.controller.reconcileFromHydrate({
      session_id: "session-a",
      cursor: { stream: "session-a", seq: 2 },
      turns: [],
    });
    start.reject(new Error("start was rejected"));

    await vi.waitFor(() => {
      expect(harness.controller.snapshot().active).toBeNull();
    });
    expect(harness.timeline.some((entry) => entry.kind === "system")).toBe(
      true,
    );
  });

  it("does not let an old interrupt failure pollute a replacement client", async () => {
    const staleInterrupt = deferred<void>();
    const older = fakeClient({ interrupt: () => staleInterrupt.promise });
    const newer = fakeClient();
    const harness = renderController(older);

    harness.controller.enqueuePrompt("ship it");
    const pending = harness.controller.interrupt();
    harness.setClient(newer);
    staleInterrupt.reject(new Error("old socket closed"));
    await pending;

    expect(harness.connectionErrors).toEqual([]);
    await harness.controller.interrupt();
    expect(newer.interruptTurn).toHaveBeenCalledTimes(1);
  });
});

function renderController(initialClient: FakeTurnClient): {
  controller: TurnController;
  timeline: TimelineEntry[];
  connectionErrors: string[];
  setClient(client: FakeTurnClient): void;
  activeTurnId(): string;
} {
  let controller: TurnController | null = null;
  let client: FakeTurnClient = initialClient;
  const timeline: TimelineEntry[] = [];
  const connectionErrors: string[] = [];
  const setTimeline: Dispatch<SetStateAction<TimelineEntry[]>> = (action) => {
    const next = typeof action === "function" ? action([...timeline]) : action;
    timeline.splice(0, timeline.length, ...next);
  };

  function Probe() {
    controller = useTurnController({
      client: () => client as unknown as OctosUiClient,
      sessionId: () => "session-a",
      canEnqueue: () => true,
      canStart: () => true,
      canInterrupt: () => true,
      setTimeline,
      setConnectionError: (message) => connectionErrors.push(message),
    });
    return null;
  }

  renderToStaticMarkup(createElement(Probe));
  if (!controller) throw new Error("Turn controller probe did not render");
  const renderedController: TurnController = controller;
  return {
    controller: renderedController,
    timeline,
    connectionErrors,
    setClient(next) {
      client = next;
    },
    activeTurnId() {
      const turnId = renderedController.snapshot().active?.turnId;
      if (!turnId) throw new Error("Expected an active turn");
      return turnId;
    },
  };
}

interface FakeTurnClient {
  startTurn: ReturnType<typeof vi.fn>;
  interruptTurn: ReturnType<typeof vi.fn>;
}

function fakeClient(options?: {
  start?: () => Promise<void>;
  interrupt?: () => Promise<void>;
}): FakeTurnClient {
  return {
    startTurn: vi.fn(options?.start ?? (async () => undefined)),
    interruptTurn: vi.fn(options?.interrupt ?? (async () => undefined)),
  };
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
} {
  let resolve: ((value: Value) => void) | undefined;
  let reject: ((reason: unknown) => void) | undefined;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return {
    promise,
    resolve(value) {
      if (!resolve) throw new Error("Deferred promise is not initialized");
      resolve(value);
    },
    reject(reason) {
      if (!reject) throw new Error("Deferred promise is not initialized");
      reject(reason);
    },
  };
}
