import { describe, expect, it, vi } from "vitest";
import {
  createInspectionCommands,
  type InspectionCommands,
} from "@octos-org/octoscode-client/inspection";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import { createInspectionController } from "./inspection-controller.ts";
import type { InspectionBinding } from "./inspection-binding.ts";
const sessionId = "coding:local:main";
const turnId = "00000000-0000-4000-8000-000000000011";
const caps: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: ["thread/graph/get", "turn/state/get"],
  supported_features: ["state.thread_graph.v1", "state.turn_state_get.v1"],
  supported_notifications: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const graph = () => ({
  session_id: sessionId,
  cursor: { stream: sessionId, seq: 10 },
  threads: [],
  orphans: [],
});
function setup(capabilities = caps) {
  let current = true;
  const listeners = new Set<() => void>();
  const rpc = vi.fn(
    async (_method: string, _params: unknown): Promise<unknown> => graph(),
  );
  const commands = createInspectionCommands(
    { request: rpc },
    { sessionId, profileId: "coding", authority: {} },
    capabilities,
  );
  const factory = vi.fn(async () => commands);
  const binding: InspectionBinding = {
    scope: {
      sessionId,
      profileId: "coding",
      endpoint: "ws://server.test/ui",
      workspaceRoot: "/srv/project",
      authorityEpoch: 1,
    },
    authorityKey: "scope-generation-1",
    capabilities,
    isCurrent: () => current,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    commands: factory,
  };
  const controller = createInspectionController(binding);
  const off = controller.subscribe(() => undefined);
  return {
    controller,
    binding,
    rpc,
    commands,
    factory,
    off,
    retire() {
      current = false;
      for (const listener of listeners) listener();
    },
  };
}
describe("read-only captured inspection controller", () => {
  it("reads approval scopes without a feature grant and rejects a mixed foreign list", async () => {
    const h = setup({
      ...caps,
      supported_methods: ["approval/scopes/list"],
      supported_features: [],
    });
    h.rpc.mockResolvedValueOnce({ scopes: [] });
    await h.controller.load({ kind: "approval-scopes" });
    expect(h.controller.getSnapshot()).toMatchObject({
      phase: "ready",
      result: { kind: "approval-scopes", value: { scopes: [] } },
    });
    h.rpc.mockResolvedValueOnce({
      scopes: [
        {
          session_id: `${sessionId}#foreign`,
          scope: "session",
          scope_match: "*",
          decision: "approve",
        },
      ],
    });
    await h.controller.load({ kind: "approval-scopes" });
    expect(h.controller.getSnapshot()).toMatchObject({
      phase: "error",
      result: null,
    });
    h.off();
  });
  it("deduplicates concurrent refresh and caches a stable detached snapshot", async () => {
    const h = setup();
    const reply = deferred<unknown>();
    h.rpc.mockReturnValue(reply.promise);
    const first = h.controller.load({ kind: "threads" });
    expect(h.controller.load({ kind: "threads" })).toBe(first);
    await Promise.resolve();
    expect(h.rpc).toHaveBeenCalledTimes(1);
    reply.resolve(graph());
    await first;
    expect(h.controller.getSnapshot().phase).toBe("ready");
    expect(h.controller.getSnapshot()).toBe(h.controller.getSnapshot());
    h.off();
  });
  it("fences a lazy factory before any RPC when authority retires", async () => {
    const h = setup();
    const lazy = deferred<InspectionCommands>();
    h.factory.mockReturnValue(lazy.promise);
    const task = h.controller.load({ kind: "threads" });
    h.retire();
    lazy.resolve(h.commands);
    await task;
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot()).toMatchObject({
      phase: "retired",
      result: null,
    });
    h.off();
  });
  it("drops a delayed result and clears a visible snapshot on source withdrawal", async () => {
    const h = setup();
    await h.controller.load({ kind: "threads" });
    const reply = deferred<unknown>();
    h.rpc.mockReturnValue(reply.promise);
    const task = h.controller.load({ kind: "turn", turnId });
    await Promise.resolve();
    h.retire();
    reply.resolve({
      session_id: sessionId,
      turn_id: turnId,
      state: "completed",
    });
    await task;
    expect(h.controller.getSnapshot()).toMatchObject({
      phase: "retired",
      result: null,
    });
    h.off();
  });
  it("a newer target owns the view even if the old read settles last", async () => {
    const h = setup();
    const old = deferred<unknown>();
    h.rpc.mockReturnValueOnce(old.promise);
    const first = h.controller.load({ kind: "threads" });
    await Promise.resolve();
    h.rpc.mockResolvedValueOnce({
      session_id: sessionId,
      turn_id: turnId,
      state: "unknown",
    });
    await h.controller.load({ kind: "turn", turnId });
    old.resolve(graph());
    await first;
    expect(h.controller.getSnapshot().result).toMatchObject({
      kind: "turn",
      value: { turn_id: turnId },
    });
    h.off();
  });
  it("rejects foreign replies without exposing remote error details, and retries only on request", async () => {
    const h = setup();
    h.rpc.mockResolvedValueOnce({
      ...graph(),
      session_id: "coding:local:foreign",
    });
    await h.controller.load({ kind: "threads" });
    expect(h.controller.getSnapshot()).toMatchObject({
      phase: "error",
      result: null,
    });
    h.rpc.mockRejectedValueOnce(new Error("secret-remote-error"));
    await h.controller.load({ kind: "threads" });
    expect(JSON.stringify(h.controller.getSnapshot())).not.toContain(
      "secret-remote-error",
    );
    h.rpc.mockResolvedValueOnce(graph());
    await h.controller.load({ kind: "threads" });
    expect(h.controller.getSnapshot().phase).toBe("ready");
    expect(h.rpc).toHaveBeenCalledTimes(3);
    h.off();
  });
  it("capability withdrawal fails closed before resolving commands", async () => {
    const h = setup({ ...caps, supported_features: [] });
    await h.controller.load({ kind: "threads" });
    expect(h.factory).not.toHaveBeenCalled();
    h.off();
  });
  it("unmount cancellation discards a response and allows StrictMode read restart", async () => {
    const h = setup();
    const old = deferred<unknown>();
    h.rpc.mockReturnValueOnce(old.promise);
    const first = h.controller.load({ kind: "threads" });
    await Promise.resolve();
    h.controller.cancel();
    await h.controller.load({ kind: "threads" });
    const latest = h.controller.getSnapshot();
    old.resolve(graph());
    await first;
    expect(h.controller.getSnapshot()).toBe(latest);
    h.off();
  });
});
