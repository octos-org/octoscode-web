import { describe, expect, it, vi } from "vitest";
import {
  OctosUiProtocolError,
  type OctosUiClient,
  type RpcNotification,
  type SessionHydrateResult,
} from "@octos-org/octoscode-client";
import type { TurnSteerResult } from "@octos-org/octoscode-client/steer";
import {
  createQueueBackedTurnController,
  type NativeSteerRequest,
  type TurnControllerDependencies,
} from "./use-turn-controller.ts";
import { PromptTurnQueue } from "./turn-queue.ts";
import type { TimelineEntry } from "../timeline/model.ts";

const A = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";
const F = "44444444-4444-4444-8444-444444444444";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(
  options: { preflight?: boolean; start?: Promise<void>; effort?: "high" } = {},
) {
  const receipt = deferred<TurnSteerResult>();
  let latest: NativeSteerRequest | null = null;
  const client = {
    startTurn: vi
      .fn()
      .mockImplementation(() => options.start ?? Promise.resolve()),
    interruptTurn: vi.fn().mockResolvedValue(undefined),
  };
  let connection = client as unknown as OctosUiClient;
  let timeline: TimelineEntry[] = [];
  const dependencies: TurnControllerDependencies = {
    client: () => connection,
    sessionId: () => "master#peer",
    canEnqueue: () => true,
    canStart: () => true,
    canInterrupt: () => true,
    setTimeline: (action) => {
      timeline = typeof action === "function" ? action(timeline) : action;
    },
    setConnectionError: vi.fn(),
    steer: vi.fn((request) => {
      latest = request;
      if (!options.preflight) request.markSent();
      return receipt.promise;
    }),
  };
  const controller = createQueueBackedTurnController({
    queueRef: { current: new PromptTurnQueue() },
    dependenciesRef: { current: dependencies },
  });
  controller.enqueueTurn({
    turnId: A,
    text: "original",
    ...(options.effort ? { reasoningEffort: options.effort } : {}),
  });
  return {
    controller,
    client,
    receipt,
    dependencies,
    request: () => latest!,
    timeline: () => timeline,
    reauth: () => {
      connection = { ...client } as unknown as OctosUiClient;
      controller.suspendTransport();
    },
    submit: () => controller.submitTurn({ turnId: S, text: "correction" }),
    drop: (overrides: Record<string, unknown> = {}) =>
      controller.observeSteerDropped({
        jsonrpc: "2.0",
        method: "turn/steer_dropped",
        params: {
          session_id: "master",
          topic: "peer",
          turn_id: A,
          inputs: ["correction"],
          reason: "interrupted",
          ...overrides,
        },
      } as RpcNotification),
  };
}
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
// Steering puts a correction INTO the turn Core is running instead of queueing
// a new one (docs/tui-command-coverage.md `/steer`, docs/protocol.md
// turn/steer_dropped). It is only safe against an ACCEPTED owner, so anything
// uncertain falls back to the FIFO, text Core hands back returns exactly once
// ahead of later drafts, an ambiguous send is never replayed, and a suspended
// transport's late answers cannot touch the new one. Before changing it, expect
// these to fail if a correction could be sent twice, lost, or reordered.
describe("record-owned native steering", () => {
  it("send now interrupts once, preserves drafts, and waits for terminal before dispatch", async () => {
    const h = fixture();
    const restore = vi.fn();
    h.dependencies.onInterruptPromptRestore = restore;
    await tick();
    h.controller.enqueueTurn({
      turnId: B,
      text: "next",
      media: [{ path: "upload/image.png", mime: "image/png", size_bytes: 7 }],
    });
    expect(h.controller.canSendPendingNow()).toBe(true);
    await h.controller.sendPendingNow();
    await h.controller.sendPendingNow();
    expect(h.client.interruptTurn).toHaveBeenCalledExactlyOnceWith(
      "master#peer",
      A,
    );
    expect(h.client.startTurn).toHaveBeenCalledTimes(1);
    h.controller.settleTurn(A);
    await tick();
    expect(h.client.startTurn).toHaveBeenCalledTimes(2);
    expect(h.controller.snapshot().active?.turnId).toBe(B);
    expect(restore).not.toHaveBeenCalled();
  });
  it("send now supersedes a failed stop's pending prompt restore", async () => {
    const h = fixture();
    const restore = vi.fn();
    h.dependencies.onInterruptPromptRestore = restore;
    await tick();
    h.controller.enqueueTurn({ turnId: B, text: "next" });
    h.client.interruptTurn.mockRejectedValueOnce(new Error("stop rejected"));
    await h.controller.interrupt();
    await h.controller.sendPendingNow();
    h.controller.settleTurn(A);
    await tick();
    expect(restore).not.toHaveBeenCalled();
    expect(h.controller.snapshot().active?.turnId).toBe(B);
  });
  it.each([true, false])(
    "send now replays only server-returned steering (returned=%s)",
    async (returned) => {
      const h = fixture();
      await tick();
      expect(h.controller.steeringEnabled()).toBe(true);
      h.submit();
      expect(h.controller.canSendPendingNow()).toBe(false);
      h.receipt.resolve({ turn_id: A, steered: true });
      await tick();
      expect(h.controller.canSendPendingNow()).toBe(true);
      await h.controller.sendPendingNow();
      if (returned) {
        h.drop();
        h.drop();
      }
      h.controller.settleTurn(A);
      await tick();
      expect(h.client.startTurn).toHaveBeenCalledTimes(returned ? 2 : 1);
      expect(h.controller.snapshot().active?.turnId ?? null).toBe(
        returned ? S : null,
      );
    },
  );
  it("send now cannot interrupt an unaccepted start or an unknown steer", async () => {
    const pending = deferred<void>();
    const h = fixture({ start: pending.promise });
    h.controller.enqueueTurn({ turnId: B, text: "next" });
    await h.controller.sendPendingNow();
    expect(h.client.interruptTurn).not.toHaveBeenCalled();
    pending.resolve();
    await tick();
    const unknown = fixture();
    await tick();
    unknown.submit();
    unknown.receipt.reject(new Error("connection lost after write"));
    await tick();
    await unknown.controller.sendPendingNow();
    expect(unknown.client.interruptTurn).not.toHaveBeenCalled();
  });

  it("a persistent thinking preference does not force all new input into the queue", async () => {
    const h = fixture({ effort: "high" });
    await tick();
    h.controller.submitTurn({
      turnId: S,
      text: "correction",
      reasoningEffort: "high",
    });
    expect(h.dependencies.steer).toHaveBeenCalledTimes(1);
    h.receipt.resolve({ turn_id: A, steered: true });
    await tick();
    expect(h.controller.snapshot().pending).toEqual([]);
  });
  it("never steers an explicit enqueueTurn (a native peer kickoff stays a turn)", async () => {
    const h = fixture();
    await tick();
    h.controller.enqueueTurn({ turnId: S, text: "native peer kickoff" });
    expect(h.dependencies.steer).not.toHaveBeenCalled();
  });
  it.each([
    "pending",
    "interrupt",
    "media",
    "reasoning",
    "unavailable",
    "server cannot steer",
    "steering off",
    // No accepted owner yet: steering would race a second Core turn.
    "unacknowledged start",
  ])("keeps the FIFO for %s", async (mode) => {
    const h = fixture(
      mode === "unacknowledged start"
        ? { start: deferred<void>().promise }
        : {},
    );
    if (mode !== "unacknowledged start") await tick();
    const steer = h.dependencies.steer;
    if (mode === "pending")
      h.controller.enqueueTurn({ turnId: B, text: "earlier" });
    if (mode === "interrupt") await h.controller.interrupt();
    if (mode === "unavailable") delete h.dependencies.steer;
    if (mode === "server cannot steer") {
      h.dependencies.canSteer = () => false;
      expect(h.controller.canSteerText(undefined)).toBe(false);
    }
    if (mode === "steering off") h.controller.setSteeringEnabled(false);
    const media = [
      { path: "up/handle/photo.png", mime: "image/png", size_bytes: 7 },
    ];
    expect(
      h.controller.submitTurn({
        turnId: S,
        text: "correction",
        ...(mode === "media" ? { media } : {}),
        ...(mode === "reasoning" ? { reasoningEffort: "high" } : {}),
      }),
    ).toBe(true);
    expect(steer).not.toHaveBeenCalled();
    expect(h.timeline().some((item) => item.kind === "system")).toBe(false);
    expect(h.controller.snapshot().pending.at(-1)).toMatchObject({
      turnId: S,
      ...(mode === "media" ? { media } : {}),
      ...(mode === "reasoning" ? { reasoningEffort: "high" } : {}),
    });
  });
  it("steers into the captured accepted owner without interrupt or another start", async () => {
    const h = fixture();
    await tick();
    expect(h.submit()).toBe(true);
    expect(h.request()).toMatchObject({
      expectedTurnId: A,
      sessionId: "master#peer",
      text: "correction",
    });
    h.receipt.resolve({ turn_id: A, steered: true });
    await tick();
    expect(h.client.startTurn).toHaveBeenCalledTimes(1);
    expect(h.client.interruptTurn).not.toHaveBeenCalled();
    h.controller.settleTurn(A);
    expect(h.controller.snapshot().active).toBeNull();
    expect(h.timeline().some((row) => row.title === "Steering accepted")).toBe(
      true,
    );
    expect(
      h
        .timeline()
        .some((row) => row.title === "Steering delivery not confirmed"),
    ).toBe(false);
  });
  it("restages explicit rejection before later pending drafts", async () => {
    const h = fixture();
    await tick();
    h.submit();
    h.controller.enqueueTurn({ turnId: B, text: "later" });
    h.receipt.reject(
      new OctosUiProtocolError(-32602, "expected turn mismatch"),
    );
    await tick();
    expect(h.controller.snapshot().pending.map((turn) => turn.turnId)).toEqual([
      S,
      B,
    ]);
    h.controller.settleTurn(A);
    expect(h.client.startTurn.mock.calls.at(-1)?.[0].turn_id).toBe(S);
  });
  it("holds terminal drain until fallback receipt, then adopts the server UUID exactly once", async () => {
    const h = fixture();
    await tick();
    h.submit();
    h.controller.enqueueTurn({ turnId: B, text: "later" });
    h.controller.settleTurn(A);
    expect(h.client.startTurn).toHaveBeenCalledTimes(1);
    h.receipt.resolve({ turn_id: F, steered: false });
    await tick();
    expect(h.controller.snapshot().active?.turnId).toBe(F);
    expect(h.controller.snapshot().pending.map((turn) => turn.turnId)).toEqual([
      B,
    ]);
    expect(h.controller.activeTurnOwnership()).toBe("local-owner");
    expect(h.client.startTurn).toHaveBeenCalledTimes(1);
    h.controller.settleTurn(F);
    expect(h.client.startTurn.mock.calls.at(-1)?.[0].turn_id).toBe(B);
  });
  it("does not revive a fallback whose actual terminal beat its ACK", async () => {
    const h = fixture();
    await tick();
    h.submit();
    h.controller.settleTurn(A);
    h.controller.settleTurn(F);
    h.receipt.resolve({ turn_id: F, steered: false });
    await tick();
    expect(h.controller.snapshot().active).toBeNull();
    expect(h.client.startTurn).toHaveBeenCalledTimes(1);
  });
  it("returns undrained text once, before later drafts, even before ACK", async () => {
    const h = fixture();
    await tick();
    h.submit();
    h.controller.enqueueTurn({ turnId: B, text: "later" });
    h.drop();
    h.drop();
    expect(h.controller.snapshot().pending.map((turn) => turn.turnId)).toEqual([
      S,
      B,
    ]);
    h.controller.settleTurn(A);
    expect(h.client.startTurn).toHaveBeenCalledTimes(1);
    h.receipt.resolve({ turn_id: A, steered: true });
    await tick();
    expect(h.client.startTurn.mock.calls.at(-1)?.[0].turn_id).toBe(S);
    expect(h.controller.snapshot().pending.map((turn) => turn.turnId)).toEqual([
      B,
    ]);
  });
  it.each([
    { topic: "foreign" },
    { session_id: "foreign" },
    { session_id: undefined },
    { turn_id: F },
    { inputs: ["injected"] },
  ])("rejects unowned return %j", async (foreign) => {
    const h = fixture();
    await tick();
    h.submit();
    h.drop(foreign);
    expect(h.controller.snapshot().pending).toEqual([]);
    h.receipt.resolve({ turn_id: A, steered: true });
    await tick();
  });
  it.each(["canonical recovery", "a Retry click"] as const)(
    "does not replay an ambiguous steer and resumes the unrelated queue only after %s",
    async (path) => {
      const h = fixture();
      await tick();
      h.submit();
      h.controller.enqueueTurn({ turnId: B, text: "later" });
      h.receipt.reject(new Error("timeout"));
      await tick();
      h.controller.settleTurn(A);
      expect(h.client.startTurn).toHaveBeenCalledTimes(1);
      expect(
        h.timeline().some((row) => row.title === "Steering outcome unknown"),
      ).toBe(true);
      expect(
        h
          .timeline()
          .some((row) => row.title === "Steering delivery not confirmed"),
      ).toBe(false);
      if (path === "canonical recovery") {
        h.controller.reconcileFromHydrate({
          session_id: "master#peer",
          turns: [],
        } as unknown as SessionHydrateResult);
        h.controller.resumePendingTurn();
      } else {
        // Audit v10 P1: the latched-and-settled head was never attempted, and
        // Retry used to clear the latch while the queue stalled for good.
        expect(h.controller.retrySteerDelivery()).toBe(true);
        await tick();
      }
      expect(h.client.startTurn.mock.calls.at(-1)?.[0].turn_id).toBe(B);
      if (path === "a Retry click")
        expect(h.controller.retrySteerDelivery()).toBe(false);
    },
  );
  it("a late confirmed return can resolve a timeout without inventing or duplicating input", async () => {
    const h = fixture();
    await tick();
    h.submit();
    h.receipt.reject(new Error("timeout"));
    await tick();
    h.drop();
    h.controller.settleTurn(A);
    expect(h.client.startTurn.mock.calls.at(-1)?.[0].turn_id).toBe(S);
  });
  it("suspension invalidates same-session callbacks and preserves only never-sent preflight text", async () => {
    const h = fixture({ preflight: true });
    await tick();
    h.submit();
    h.reauth();
    expect(h.request().isCurrent()).toBe(false);
    expect(() => h.request().markSent()).toThrow();
    h.receipt.resolve({ turn_id: F, steered: false });
    await tick();
    expect(h.controller.snapshot().pending.map((turn) => turn.turnId)).toEqual([
      S,
    ]);
    expect(h.controller.snapshot().active?.turnId).toBe(A);
  });
  it("suspension never requeues a sent input or lets its late ACK mutate the new authority", async () => {
    const h = fixture();
    await tick();
    h.submit();
    h.reauth();
    h.receipt.resolve({ turn_id: F, steered: false });
    await tick();
    expect(h.controller.snapshot().pending).toEqual([]);
    expect(h.controller.snapshot().active?.turnId).toBe(A);
    expect(
      h.timeline().some((row) => row.title === "Steering outcome unknown"),
    ).toBe(true);
  });
});
