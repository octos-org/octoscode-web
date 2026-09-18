import { describe, expect, it, vi } from "vitest";
import {
  OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import {
  createBtwCommands,
  type BtwCommands,
  type SessionBtwResult,
} from "@octos-org/octoscode-client/btw";
import type { ActiveSessionAuthority } from "../session/active-session-runtime.ts";
import { LazyBtwController, type BtwRecord } from "./lazy-btw-controller.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
function setup(sessionId = "dev:api:A") {
  const client = new OctosUiClient({ endpoint: "ws://127.0.0.1:1" });
  const status = vi.spyOn(client, "status", "get").mockReturnValue("connected");
  const caps: UiProtocolCapabilities = {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: ["session/btw"],
    supported_notifications: [],
  };
  const scope = {
    endpoint: "ws://127.0.0.1:1",
    workspaceRoot: "/repo",
    profileId: "dev",
    sessionId,
    authorityEpoch: 1,
  };
  let authority: ActiveSessionAuthority<OctosUiClient> = {
    generation: 1,
    client,
    sessionId,
    profileId: "dev",
    cwd: "/repo",
    capabilities: caps,
    opened: null,
    config: {
      endpoint: scope.endpoint,
      cwd: scope.workspaceRoot,
      profileId: scope.profileId,
      sessionId,
      token: "",
    },
  };
  let retained = true;
  let pooled: OctosUiClient | null = client;
  let phase = "ready";
  const listeners = new Set<() => void>();
  const record: BtwRecord & { closed: boolean } = {
    scope,
    closed: false,
    runtime: {
      currentAuthority: () => authority,
      isCurrent: (candidate) => candidate === authority,
      getSnapshot: () => ({
        phase,
        recovery: { phase: phase === "ready" ? "healthy" : "hydrating" },
      }),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
  const response = deferred<SessionBtwResult>();
  const rpc = vi.fn().mockReturnValue(response.promise);
  const commands = createBtwCommands({ request: rpc }, sessionId, caps);
  const factory = vi
    .fn<() => Promise<BtwCommands>>()
    .mockResolvedValue(commands);
  const controller = new LazyBtwController({
    record,
    isRetained: (candidate) => retained && candidate === record,
    pooledClient: () => pooled,
    loadCommands: factory,
  });
  const answer = (text = "An **ephemeral** answer") => ({
    session_id: sessionId,
    answer: text,
  });
  return {
    client,
    status,
    caps,
    scope,
    record,
    controller,
    response,
    rpc,
    factory,
    commands,
    answer,
    listeners,
    generation() {
      authority = { ...authority, generation: authority.generation + 1 };
    },
    replaceCaps() {
      authority = { ...authority, capabilities: { ...caps } };
    },
    remove() {
      retained = false;
    },
    unpool() {
      pooled = null;
    },
    recovering() {
      phase = "recovering";
    },
    emit() {
      for (const listener of listeners) listener();
    },
  };
}

describe("record-owned ephemeral /btw", () => {
  it("publishes stable answering immediately, bypasses ordinary turn capabilities, and keeps the answer off the transcript", async () => {
    const h = setup();
    const changed = vi.fn();
    h.controller.subscribe(changed);
    expect(h.controller.ask("  What is happening?\n")).toBe("accepted");
    const answering = h.controller.getSnapshot();
    expect(answering).toMatchObject({
      question: "What is happening?",
      state: "answering",
    });
    expect(h.controller.getSnapshot()).toBe(answering);
    expect(Object.isFrozen(answering)).toBe(true);
    expect(h.controller.ask("Second")).toBe("busy");
    await flush();
    expect(h.factory).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("session/btw", {
      session_id: h.scope.sessionId,
      question: "What is happening?",
    });
    h.response.resolve(h.answer());
    await flush();
    expect(h.controller.getSnapshot()).toMatchObject({
      state: "answered",
      answer: "An **ephemeral** answer",
      error: null,
    });
    expect(changed).toHaveBeenCalledTimes(2);
    expect(h.rpc.mock.calls.every(([method]) => method === "session/btw")).toBe(
      true,
    );
  });
  it("rejects empty/unavailable commands without factory work or visible state", () => {
    const h = setup();
    expect(h.controller.ask(" \n")).toBe("empty");
    h.caps.supported_methods = ["turn/start"];
    expect(h.controller.ask("Question")).toBe("unavailable");
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot()).toBeNull();
  });
  it("uses the real lazy client factory when no test seam is provided", async () => {
    const h = setup();
    const factory = vi
      .spyOn(h.client, "btwCommands")
      .mockResolvedValue(h.commands);
    const controller = new LazyBtwController({
      record: h.record,
      isRetained: (record) => record === h.record,
      pooledClient: () => h.client,
    });
    expect(controller.ask("Question")).toBe("accepted");
    await flush();
    expect(factory).toHaveBeenCalledExactlyOnceWith(h.scope.sessionId, h.caps);
    controller.dispose();
    h.response.resolve(h.answer());
    await flush();
    expect(controller.getSnapshot()).toBeNull();
  });
  it.each([
    "generation",
    "replaceCaps",
    "remove",
    "unpool",
    "recovering",
  ] as const)("fences %s between lazy load and the RPC", async (invalidate) => {
    const h = setup();
    const loader = deferred<BtwCommands>();
    h.factory.mockReturnValue(loader.promise);
    expect(h.controller.ask("Question")).toBe("accepted");
    h[invalidate]();
    loader.resolve(h.commands);
    await flush();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot()).toMatchObject({
      state: "failed",
      answer: null,
    });
  });
  it.each([
    "endpoint",
    "workspaceRoot",
    "profileId",
    "sessionId",
    "authorityEpoch",
  ] as const)(
    "captures full scope %s before asynchronous work",
    async (field) => {
      const h = setup();
      const loader = deferred<BtwCommands>();
      h.factory.mockReturnValue(loader.promise);
      h.controller.ask("Question");
      Object.assign(h.scope, {
        [field]: field === "authorityEpoch" ? 2 : "different",
      });
      loader.resolve(h.commands);
      await flush();
      expect(h.rpc).not.toHaveBeenCalled();
      expect(h.controller.getSnapshot()?.state).toBe("failed");
    },
  );
  it("fails the owning aside immediately on recovery and never replays it", async () => {
    const h = setup();
    h.controller.ask("Question");
    await flush();
    h.recovering();
    h.emit();
    expect(h.controller.getSnapshot()?.state).toBe("failed");
    h.response.resolve(h.answer("stale success"));
    await flush();
    expect(h.controller.getSnapshot()?.answer).toBeNull();
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not publish a late RPC answer after generation changes", async () => {
    const h = setup();
    h.controller.ask("Question");
    await flush();
    h.generation();
    h.response.resolve(h.answer());
    await flush();
    expect(h.controller.getSnapshot()?.state).toBe("failed");
  });
  it("does not send or answer on a closed retained peer", async () => {
    const h = setup("dev:local:tui#peer-review");
    h.controller.ask("Question");
    await flush();
    h.record.closed = true;
    h.emit();
    h.response.resolve(h.answer());
    await flush();
    expect(h.controller.getSnapshot()?.state).toBe("failed");
    expect(h.controller.ask("Another")).toBe("stale");
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });
  it("revoked method and disconnected pool reject late results", async () => {
    const h = setup();
    h.controller.ask("Question");
    await flush();
    h.caps.supported_methods = [];
    h.status.mockReturnValue("disconnected");
    h.response.resolve(h.answer());
    await flush();
    expect(h.controller.getSnapshot()?.state).toBe("failed");
  });
  it("background A settles independently while B is displayed or answering", async () => {
    const a = setup("dev:api:A");
    const b = setup("dev:api:B");
    a.controller.ask("A?");
    b.controller.ask("B?");
    await flush();
    const bSnapshot = b.controller.getSnapshot();
    a.response.resolve(a.answer("Answer A"));
    await flush();
    expect(a.controller.getSnapshot()?.answer).toBe("Answer A");
    expect(b.controller.getSnapshot()).toBe(bSnapshot);
    b.response.reject(new Error("private provider token"));
    await flush();
    expect(b.controller.getSnapshot()?.state).toBe("failed");
    expect(JSON.stringify(b.controller.getSnapshot())).not.toContain(
      "private provider token",
    );
    expect(a.controller.getSnapshot()?.answer).toBe("Answer A");
  });
  it("does not resurrect an explicitly dismissed answering aside", async () => {
    const h = setup();
    h.controller.ask("Question");
    await flush();
    expect(h.controller.dismiss()).toBe(true);
    h.response.resolve(h.answer());
    await flush();
    expect(h.controller.getSnapshot()).toBeNull();
    expect(h.controller.dismiss()).toBe(false);
  });
  it("an older dismissed answer cannot replace a newer question", async () => {
    const h = setup();
    const newer = deferred<SessionBtwResult>();
    h.rpc
      .mockReturnValueOnce(h.response.promise)
      .mockReturnValueOnce(newer.promise);
    h.controller.ask("Old");
    await flush();
    h.controller.dismiss();
    h.controller.ask("New");
    await flush();
    h.response.resolve(h.answer("Old answer"));
    await flush();
    expect(h.controller.getSnapshot()).toMatchObject({
      question: "New",
      state: "answering",
    });
    newer.resolve(h.answer("New answer"));
    await flush();
    expect(h.controller.getSnapshot()?.answer).toBe("New answer");
  });
  it("ordinary prompt admission clears only settled asides", async () => {
    const h = setup();
    h.controller.ask("Question");
    expect(h.controller.clearSettled()).toBe(false);
    await flush();
    h.response.resolve(h.answer());
    await flush();
    expect(h.controller.clearSettled()).toBe(true);
    expect(h.controller.getSnapshot()).toBeNull();
  });
  it("drops a dismissed pending lazy load without sending a provider request", async () => {
    const h = setup();
    const loader = deferred<BtwCommands>();
    h.factory.mockReturnValue(loader.promise);
    h.controller.ask("Question");
    h.controller.dismiss();
    loader.resolve(h.commands);
    await flush();
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("a wrong bound command scope fails before issuing RPC", async () => {
    const h = setup();
    h.factory.mockResolvedValue({ sessionId: "foreign", ask: vi.fn() });
    h.controller.ask("Question");
    await flush();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot()?.state).toBe("failed");
  });
  it("wrong-owner results and lazy failures are visible only as safe owning failures", async () => {
    const h = setup();
    h.controller.ask("Question");
    await flush();
    h.response.resolve({
      session_id: "foreign",
      answer: "Secret foreign text",
    });
    await flush();
    expect(h.controller.getSnapshot()).toMatchObject({
      state: "failed",
      answer: null,
    });
    expect(JSON.stringify(h.controller.getSnapshot())).not.toContain(
      "Secret foreign",
    );
    h.factory.mockRejectedValue(new Error("private chunk URL"));
    expect(h.controller.ask("Retry")).toBe("accepted");
    await flush();
    expect(h.controller.getSnapshot()).toMatchObject({
      question: "Retry",
      state: "failed",
    });
    expect(JSON.stringify(h.controller.getSnapshot())).not.toContain(
      "private chunk",
    );
  });
  it("dispose detaches listeners, clears state, and rejects future work", async () => {
    const h = setup();
    h.controller.ask("Question");
    await flush();
    h.controller.dispose();
    h.controller.dispose();
    expect(h.listeners.size).toBe(0);
    expect(h.controller.ask("Another")).toBe("stale");
    h.response.resolve(h.answer());
    await flush();
    expect(h.controller.getSnapshot()).toBeNull();
  });
});
