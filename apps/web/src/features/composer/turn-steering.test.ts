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
function fixture(options: { preflight?: boolean; start?: Promise<void> } = {}) {
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
  controller.enqueueTurn({ turnId: A, text: "original" });
  controller.setSteeringEnabled(true);
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
describe("record-owned native steering", () => {
  it("queues by default and never changes explicit enqueueTurn semantics", async () => {
    const h = fixture();
    await tick();
    h.controller.setSteeringEnabled(false);
    h.submit();
    expect(h.dependencies.steer).not.toHaveBeenCalled();
    expect(h.controller.snapshot().pending[0]?.turnId).toBe(S);
    const other = fixture();
    await tick();
    other.controller.enqueueTurn({ turnId: S, text: "native peer kickoff" });
    expect(other.dependencies.steer).not.toHaveBeenCalled();
  });
  it("queues before ACK instead of racing a second Core turn", () => {
    const start = deferred<void>();
    const h = fixture({ start: start.promise });
    h.submit();
    expect(h.dependencies.steer).not.toHaveBeenCalled();
    expect(h.controller.snapshot().pending[0]?.turnId).toBe(S);
  });
  it.each(["pending", "interrupt", "media", "reasoning", "unavailable"])(
    "keeps the FIFO for %s",
    async (mode) => {
      const h = fixture();
      await tick();
      const steer = h.dependencies.steer;
      if (mode === "pending")
        h.controller.enqueueTurn({ turnId: B, text: "earlier" });
      if (mode === "interrupt") await h.controller.interrupt();
      if (mode === "unavailable") delete h.dependencies.steer;
      const media = [
        { path: "up/handle/photo.png", mime: "image/png", size_bytes: 7 },
      ];
      h.controller.submitTurn({
        turnId: S,
        text: "correction",
        ...(mode === "media" ? { media } : {}),
        ...(mode === "reasoning" ? { reasoningEffort: "high" } : {}),
      });
      expect(steer).not.toHaveBeenCalled();
      expect(h.controller.snapshot().pending.at(-1)).toMatchObject({
        turnId: S,
        ...(mode === "media" ? { media } : {}),
        ...(mode === "reasoning" ? { reasoningEffort: "high" } : {}),
      });
    },
  );
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
  it("does not replay ambiguous sends and only resumes unrelated queue after canonical recovery", async () => {
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
    h.controller.reconcileFromHydrate({
      session_id: "master#peer",
      turns: [],
    } as unknown as SessionHydrateResult);
    h.controller.resumePendingTurn();
    expect(h.client.startTurn.mock.calls.at(-1)?.[0].turn_id).toBe(B);
  });
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
