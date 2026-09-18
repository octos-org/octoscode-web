import { describe, expect, it, vi } from "vitest";
import { AutonomyStore } from "./store.ts";
import {
  createSessionAutonomyCommands,
  type AutonomyRpc,
  type UiProtocolCapabilities,
} from "./client-contract.ts";
import {
  buildLoopCreationInput,
  createLoopCreationSubmission,
  type LoopCreationDraft,
  type LoopCreationInput,
} from "./loop-creation.ts";
const sessionId = "coding:local:owner";
const capabilities: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: ["loop/create"],
  supported_features: ["coding.loop_runtime.v1"],
  supported_notifications: ["loop/updated"],
};
function receipt(input: LoopCreationInput) {
  return {
    session_id: sessionId,
    profile_id: "coding",
    loop_id: "loop_01",
    ok: true,
    status: "active",
    created: true,
    loop: {
      loop_id: "loop_01",
      session_id: sessionId,
      profile_id: "coding",
      prompt: input.prompt || "run maintenance checks",
      mode: input.mode,
      ...(input.mode === "fixed_interval"
        ? { interval_seconds: input.interval_seconds }
        : {}),
      status: "active",
      next_run_at_ms: 1700000060000,
      expires_at_ms: 1700604800000,
      created_at_ms: 1700000000000,
      updated_at_ms: 1700000000000,
    },
    fire: {
      queued: false,
      reason: "waiting_for_schedule",
      message: "loop created; it will queue a master continuation when due",
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function harness(caps = capabilities) {
  const response = deferred<unknown>();
  const request = vi.fn<AutonomyRpc["request"]>(() => response.promise);
  let commands = createSessionAutonomyCommands({ request }, sessionId, caps);
  const deps = { commands: () => commands, sessionId: () => sessionId };
  const store = new AutonomyStore(deps);
  return {
    store,
    response,
    request,
    rotate() {
      commands = createSessionAutonomyCommands({ request }, sessionId, caps);
      store.setDeps(deps);
    },
  };
}
const drafts: LoopCreationDraft[] = [
  { mode: "maintenance", prompt: "", interval: "" },
  { mode: "maintenance", prompt: "Prune old artifacts", interval: "" },
  { mode: "self_paced", prompt: "Check health", interval: "" },
  { mode: "fixed_interval", prompt: "Check health", interval: "5m" },
];
describe("loop creation form through actual autonomy store and typed commands", () => {
  it.each(drafts)(
    "preserves $mode native fields and creates once without a browser fire",
    async (draft) => {
      const h = harness();
      const submission = createLoopCreationSubmission();
      const parsed = buildLoopCreationInput(draft);
      if (!parsed.ok) throw new Error(parsed.reason);
      const pending = submission.submit(draft, (input) =>
        h.store.createLoop(input),
      );
      expect(
        submission.submit(draft, (input) => h.store.createLoop(input)),
      ).toBe(pending);
      await Promise.resolve();
      expect(h.request.mock.calls).toEqual([
        ["loop/create", { ...parsed.input, session_id: sessionId }],
      ]);
      expect(h.store.getState().loopsBusy).toBe(true);
      h.response.resolve(receipt(parsed.input));
      expect(await pending).toMatchObject({ kind: "confirmed" });
      expect(h.store.getState().loops).toHaveLength(1);
      expect(h.store.getState().loops[0]).toMatchObject({
        mode: draft.mode,
        prompt: draft.prompt || "run maintenance checks",
      });
      expect(h.store.getState().loopsBusy).toBe(false);
      expect(h.request).toHaveBeenCalledTimes(1);
    },
  );
  it("upserts a matching notification before the fixed-interval create receipt", async () => {
    const h = harness();
    const input: LoopCreationInput = {
      mode: "fixed_interval",
      prompt: "Check health",
      interval_seconds: 60,
    };
    const pending = h.store.createLoop(input);
    const value = receipt(input);
    h.store.observeNotification({
      jsonrpc: "2.0",
      method: "loop/updated",
      params: {
        session_id: sessionId,
        loop_id: value.loop_id,
        loop: value.loop,
      },
    });
    expect(h.store.getState().loops).toHaveLength(1);
    h.response.resolve(value);
    expect(await pending).toBe(true);
    expect(h.store.getState().loops).toHaveLength(1);
  });
  it("discards an old maintenance result on command-authority rotation", async () => {
    const h = harness();
    const input: LoopCreationInput = { mode: "maintenance", prompt: "" };
    const pending = h.store.createLoop(input);
    expect(h.request).toHaveBeenCalledTimes(1);
    h.rotate();
    h.response.resolve(receipt(input));
    expect(await pending).toBe(false);
    expect(h.store.getState().loops).toEqual([]);
    expect(h.store.getState().loopsBusy).toBe(false);
  });
  it("fails closed at the real capability boundary with no wire mutation", async () => {
    const h = harness({ ...capabilities, supported_methods: [] });
    expect(await h.store.createLoop({ mode: "maintenance", prompt: "" })).toBe(
      false,
    );
    expect(h.request).not.toHaveBeenCalled();
    expect(h.store.getState().loops).toEqual([]);
  });
});
