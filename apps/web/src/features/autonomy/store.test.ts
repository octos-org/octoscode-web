import { describe, expect, it, vi } from "vitest";
import { AutonomyStore } from "./store.ts";
import {
  createSessionAutonomyCommands,
  type SessionAutonomyCommands,
} from "./client-contract.ts";
import type { AutonomyRpc, UiProtocolCapabilities } from "./client-contract.ts";

const GOAL = {
  profile_id: "dev",
  goal_id: "goal_01",
  objective: "Ship the parity slice",
  status: "active",
  token_budget: 300_000,
  tokens_used: 1_200,
  time_used_seconds: 45,
  created_at_ms: 1_700_000_000_000,
  updated_at_ms: 1_700_000_000_000,
};

const MONITOR = {
  monitor_id: "monitor_01",
  session_id: "s1",
  profile_id: "dev",
  name: "watch-build",
  argv: ["./scripts/watch.sh"],
  mode: "poll",
  interval_seconds: 30,
  batch_ms: 500,
  max_events_per_hour: 60,
  persistent: false,
  status: "active",
  fires_used: 0,
  created_at_ms: 1_700_000_000_000,
  updated_at_ms: 1_700_000_000_000,
};

const LOOP = {
  loop_id: "loop_01",
  session_id: "s1",
  prompt: "Check the deploy",
  mode: "fixed_interval",
  interval_seconds: 60,
  status: "active",
  expires_at_ms: 1_700_086_400_000,
  created_at_ms: 1_700_000_000_000,
  updated_at_ms: 1_700_000_000_000,
};

function caps(methods: string[], features: string[]): UiProtocolCapabilities {
  return {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: methods,
    supported_notifications: [],
    supported_features: features,
  };
}

const GOAL_ALL = caps(
  ["session/goal/get", "session/goal/set", "session/goal/clear"],
  ["coding.goal_runtime.v1"],
);
const MONITOR_ALL = caps(
  ["monitor/list", "monitor/pause", "monitor/resume", "monitor/delete"],
  ["coding.monitor_runtime.v1"],
);
const MONITOR_CREATE = caps(["monitor/create"], ["coding.monitor_runtime.v1"]);
const AGENT_OUTPUT = caps(["agent/output/read"], ["coding.agent_control.v1"]);
const GOAL_AND_MONITOR = caps(
  [
    "session/goal/get",
    "session/goal/set",
    "session/goal/clear",
    "monitor/list",
  ],
  ["coding.goal_runtime.v1", "coding.monitor_runtime.v1"],
);
const LOOP_LIST_ONLY = caps(["loop/list"], ["coding.loop_runtime.v1"]);

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/**
 * Real session-scoped commands (gates + validation) over a scripted RPC.
 * `script[method]` returns a promise the test controls.
 */
function scriptedCommands(
  sessionId: string,
  capabilities: UiProtocolCapabilities,
) {
  const script = new Map<
    string,
    { promise: Promise<unknown>; resolve: (value: unknown) => void }
  >();
  const seen: Array<{ method: string; params: unknown }> = [];
  const rpc: AutonomyRpc = {
    request: (method, params) => {
      seen.push({ method, params });
      const entry = script.get(method);
      if (!entry) return Promise.reject(new Error(`unscripted ${method}`));
      return entry.promise;
    },
  };
  const commands = createSessionAutonomyCommands(rpc, sessionId, capabilities);
  return {
    commands,
    script,
    seen,
    stage(method: string) {
      const deferredEntry = deferred<unknown>();
      script.set(method, deferredEntry);
      return deferredEntry;
    },
  };
}

function makeStore(sessionId = "s1") {
  let current: SessionAutonomyCommands | null = null;
  let currentSessionId: string | null = sessionId;
  const deps = {
    commands: () => current,
    sessionId: () => currentSessionId,
  };
  const store = new AutonomyStore(deps);
  return {
    store,
    deps,
    setCommands(next: SessionAutonomyCommands | null) {
      current = next;
      // Emulate the render root performs after the identity changes: the
      // store's authority fence runs at render time (setDeps), not lazily.
      store.setDeps(deps);
    },
    setSessionId(next: string | null) {
      currentSessionId = next;
    },
  };
}

describe("native goal transition authority", () => {
  function prepare() {
    const scripted = scriptedCommands("s1", GOAL_ALL);
    const h = makeStore();
    h.setCommands(scripted.commands);
    h.store.observeNotification({
      jsonrpc: "2.0",
      method: "session/goal/updated",
      params: {
        session_id: "s1",
        goal: GOAL,
        transition_actor: "user",
        generation: 1,
      },
    });
    return { ...h, ...scripted };
  }
  it.each([
    ["pause", "paused"],
    ["resume", "active"],
    ["stop", "complete"],
  ] as const)(
    "%s reads the fresh objective then sets %s with no budget change",
    async (action, status) => {
      const h = prepare();
      const read = h.stage("session/goal/get");
      const write = h.stage("session/goal/set");
      const pending = h.store.transitionGoal(action);
      expect(h.store.isMutationPending()).toBe(true);
      expect(h.seen).toEqual([
        { method: "session/goal/get", params: { session_id: "s1" } },
      ]);
      read.resolve({
        session_id: "s1",
        profile_id: "dev",
        goal: {
          ...GOAL,
          objective: "Fresh server objective",
          tokens_used: 400_000,
        },
      });
      await vi.waitFor(() => expect(h.seen).toHaveLength(2));
      expect(h.seen[1]).toEqual({
        method: "session/goal/set",
        params: {
          session_id: "s1",
          objective: "Fresh server objective",
          status,
          transition_actor: "user",
        },
      });
      write.resolve({
        session_id: "s1",
        profile_id: "dev",
        goal: { ...GOAL, status, objective: "Fresh server objective" },
        generation: 2,
        transition_actor: "user",
      });
      expect(await pending).toBe(true);
      expect(h.store.getState().goal?.status).toBe(status);
      expect(h.store.isMutationPending()).toBe(false);
    },
  );
  it.each(["new-command", "new-session", "unmount", "generation", "clear"])(
    "never sends follow-up set after %s invalidates its read",
    async (invalidation) => {
      const h = prepare();
      const read = h.stage("session/goal/get");
      h.stage("session/goal/set");
      const pending = h.store.transitionGoal("pause");
      if (invalidation === "new-command")
        h.setCommands(scriptedCommands("s1", GOAL_ALL).commands);
      if (invalidation === "new-session") h.setSessionId("s2");
      if (invalidation === "unmount") {
        h.store.suspend();
        h.store.resume();
      }
      if (invalidation === "generation")
        h.store.observeNotification({
          jsonrpc: "2.0",
          method: "session/goal/updated",
          params: {
            session_id: "s1",
            goal: { ...GOAL, objective: "Newer goal" },
            transition_actor: "backend",
            generation: 2,
          },
        });
      if (invalidation === "clear")
        h.store.observeNotification({
          jsonrpc: "2.0",
          method: "session/goal/cleared",
          params: {
            session_id: "s1",
            goal: null,
            cleared: true,
            transition_actor: "user",
            generation: 2,
          },
        });
      read.resolve({ session_id: "s1", profile_id: "dev", goal: GOAL });
      expect(await pending).toBe(false);
      expect(h.seen.map((entry) => entry.method)).toEqual(["session/goal/get"]);
    },
  );
  it("checks captured runtime authority immediately before dispatch and again before a follow-up", async () => {
    const h = prepare();
    let current = false;
    h.store.setDeps({ ...h.deps, isCurrent: () => current });
    expect(await h.store.transitionGoal("pause")).toBe(false);
    expect(h.seen).toHaveLength(0);
    current = true;
    const read = h.stage("session/goal/get");
    h.stage("session/goal/set");
    const pending = h.store.transitionGoal("pause");
    current = false; // loss before the next React render
    read.resolve({ session_id: "s1", profile_id: "dev", goal: GOAL });
    expect(await pending).toBe(false);
    expect(h.seen).toHaveLength(1);
  });
  it.each([null, { ...GOAL, status: "complete" }])(
    "does not revive a missing or completed fresh goal",
    async (goal) => {
      const h = prepare();
      const read = h.stage("session/goal/get");
      const pending = h.store.transitionGoal("resume");
      read.resolve({ session_id: "s1", profile_id: "dev", goal });
      expect(await pending).toBe(false);
      expect(h.seen).toHaveLength(1);
      expect(h.store.getState().goalError).toMatch(/unfinished goal/);
    },
  );
  it("prevents double-click transition reads", async () => {
    const h = prepare();
    const read = h.stage("session/goal/get");
    const pending = h.store.transitionGoal("pause");
    expect(await h.store.transitionGoal("stop")).toBe(false);
    read.resolve({ session_id: "s1", profile_id: "dev", goal: null });
    await pending;
    expect(h.seen).toHaveLength(1);
  });
});

describe("agent detail and mutation ownership", () => {
  const AGENT = {
    agent_id: "a1",
    session_id: "s1",
    path: "master/a1",
    role: "worker",
    nickname: "Ada",
    backend_kind: "native",
    status: "running",
    profile_id: "dev",
    created_at_ms: 1,
    updated_at_ms: 2,
    artifact_count: 0,
    artifacts: [],
  };
  const ARTIFACT = {
    id: "artifact-1",
    title: "Result",
    kind: "text",
    status: "ready",
  };
  function prepare() {
    const scripted = scriptedCommands(
      "s1",
      caps(
        [
          "agent/status/read",
          "agent/artifact/list",
          "agent/artifact/read",
          "agent/interrupt",
          "agent/close",
        ],
        ["coding.agent_control.v1"],
      ),
    );
    const h = makeStore();
    h.setCommands(scripted.commands);
    h.store.observeNotification({
      jsonrpc: "2.0",
      method: "agent/updated",
      params: { session_id: "s1", agent: AGENT },
    });
    return { ...h, ...scripted };
  }
  it("one viewer rejects a late A status after B artifacts are selected", async () => {
    const h = prepare();
    const status = h.stage("agent/status/read");
    const artifacts = h.stage("agent/artifact/list");
    const a = h.store.readAgentStatus("a1");
    const b = h.store.listAgentArtifacts("a2");
    expect(h.store.isMutationPending()).toBe(false);
    artifacts.resolve({
      session_id: "s1",
      agent_id: "a2",
      artifacts: [ARTIFACT],
    });
    expect(await b).toBe(true);
    status.resolve({ session_id: "s1", agent: AGENT });
    expect(await a).toBe(false);
    expect(h.store.getState().agentStatus).toBeNull();
    expect(h.store.getState().agentArtifacts?.agent_id).toBe("a2");
  });
  it("artifact reads use only the requested ID and cannot repaint after authority loss", async () => {
    const h = prepare();
    const read = h.stage("agent/artifact/read");
    const selector = { artifactId: "artifact-1" };
    const pending = h.store.readAgentArtifact("a1", selector);
    selector.artifactId = "mutated";
    expect(h.seen[0]?.params).toEqual({
      session_id: "s1",
      agent_id: "a1",
      artifact_id: "artifact-1",
    });
    h.store.setDeps({ ...h.deps, isCurrent: () => false });
    read.resolve({
      session_id: "s1",
      agent_id: "a1",
      artifact: ARTIFACT,
      content: "answer",
    });
    expect(await pending).toBe(false);
    expect(h.store.getState().agentArtifact).toBeNull();
  });
  it.each(["interrupt", "close"] as const)(
    "%s updates only the actual agent after receipt and guards double submission",
    async (action) => {
      const h = prepare();
      const write = h.stage(`agent/${action}`);
      const pending = h.store.controlAgent("a1", action);
      expect(h.store.isMutationPending()).toBe(true);
      expect(h.store.getState().agents[0]?.status).toBe("running");
      expect(
        await h.store.controlAgent(
          "a1",
          action === "interrupt" ? "close" : "interrupt",
        ),
      ).toBe(false);
      const status = action === "interrupt" ? "interrupted" : "closed";
      write.resolve({
        session_id: "s1",
        agent_id: "a1",
        status,
        ok: true,
        interrupted: action === "interrupt",
        closed: action === "close",
        already_terminal: false,
      });
      expect(await pending).toBe(true);
      expect(h.seen).toHaveLength(1);
      expect(h.store.getState().agents[0]?.status).toBe(status);
      expect(h.store.getState().pendingAgentIds.size).toBe(0);
      expect(h.store.isMutationPending()).toBe(false);
    },
  );
  it("a foreign control receipt fails without optimistically closing the local agent", async () => {
    const h = prepare();
    const write = h.stage("agent/close");
    const pending = h.store.controlAgent("a1", "close");
    write.resolve({
      session_id: "foreign",
      agent_id: "a1",
      status: "closed",
      ok: true,
      interrupted: false,
      closed: true,
      already_terminal: false,
    });
    expect(await pending).toBe(false);
    expect(h.store.getState().agents[0]?.status).toBe("running");
  });
  it("a status read captured before an acknowledged close cannot restore running details", async () => {
    const h = prepare();
    const read = h.stage("agent/status/read");
    const write = h.stage("agent/close");
    const details = h.store.readAgentStatus("a1");
    const closing = h.store.controlAgent("a1", "close");
    write.resolve({
      session_id: "s1",
      agent_id: "a1",
      status: "closed",
      ok: true,
      interrupted: false,
      closed: true,
      already_terminal: false,
    });
    expect(await closing).toBe(true);
    read.resolve({ session_id: "s1", agent: AGENT });
    expect(await details).toBe(false);
    expect(h.store.getState().agentStatus).toBeNull();
    expect(h.store.getState().agents[0]?.status).toBe("closed");
  });
});

describe("AutonomyStore per-operation gates", () => {
  it("concurrent families never invalidate each other; each clears only its own marker", async () => {
    const goalCommands = scriptedCommands("s1", GOAL_ALL);
    const monitorCommands = scriptedCommands("s1", MONITOR_ALL);
    const harness = makeStore("s1");
    // One factory result carrying both families: merge via a facade.
    const goalSet = goalCommands.stage("session/goal/set");
    const monitorPause = monitorCommands.stage("monitor/pause");
    const merged: SessionAutonomyCommands = {
      sessionId: "s1",
      capabilities: {
        ...goalCommands.commands.capabilities,
        ...monitorCommands.commands.capabilities,
      },
      goal: goalCommands.commands.goal,
      loop: goalCommands.commands.loop,
      monitor: monitorCommands.commands.monitor,
      agent: goalCommands.commands.agent,
    };
    harness.setCommands(merged);

    const setPromise = harness.store.setGoal("Ship it");
    const pausePromise = harness.store.controlMonitor("monitor_01", "pause");
    expect(harness.store.getState().goalBusy).toBe(true);
    expect(harness.store.getState().pendingMonitorIds.has("monitor_01")).toBe(
      true,
    );

    // Monitor completes first: goal's busy flag must survive.
    monitorPause.resolve({
      session_id: "s1",
      profile_id: "dev",
      monitor_id: "monitor_01",
      monitor: { ...MONITOR, status: "paused" },
      ok: true,
      status: "paused",
      deleted: false,
    });
    await pausePromise;
    expect(harness.store.getState().pendingMonitorIds.has("monitor_01")).toBe(
      false,
    );
    expect(harness.store.getState().goalBusy).toBe(true);

    goalSet.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: GOAL,
      generation: 1,
      transition_actor: "user",
    });
    await expect(setPromise).resolves.toBe(true);
    expect(harness.store.getState().goalBusy).toBe(false);
    expect(harness.store.getState().goal?.goal_id).toBe("goal_01");
  });

  it("a superseded op on the same id must not clear the newer op's pending marker", async () => {
    const scripted = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore("s1");
    harness.setCommands(scripted.commands);

    const first = scripted.stage("session/goal/set");
    const firstPromise = harness.store.setGoal("first");
    // A newer goal op begins before the first resolves.
    const second = scripted.stage("session/goal/set");
    const secondPromise = harness.store.setGoal("second");
    expect(harness.store.getState().goalBusy).toBe(true);

    // The OLD request completes late — its finally must not clear busy
    // because the newer op owns the id now.
    first.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: GOAL,
      generation: 1,
      transition_actor: "user",
    });
    await firstPromise;
    expect(harness.store.getState().goalBusy).toBe(true);

    second.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: { ...GOAL, objective: "second", goal_id: "goal_02" },
      generation: 2,
      transition_actor: "user",
    });
    await expect(secondPromise).resolves.toBe(true);
    expect(harness.store.getState().goalBusy).toBe(false);
    expect(harness.store.getState().goal?.objective).toBe("second");
  });
});

describe("AutonomyStore authority epoch", () => {
  it("drops a late result after the commands identity changed (same session id)", async () => {
    const first = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore("s1");
    harness.setCommands(first.commands);

    const setGoal = first.stage("session/goal/set");
    const promise = harness.store.setGoal("stale attempt");
    // Same session id, NEW commands object (re-auth / reconnect).
    const second = scriptedCommands("s1", GOAL_ALL);
    harness.setCommands(second.commands);

    setGoal.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: GOAL,
      generation: 1,
      transition_actor: "user",
    });
    await expect(promise).resolves.toBe(false);
    const state = harness.store.getState();
    expect(state.goal).toBeNull();
    expect(state.goalBusy).toBe(false);
  });

  it("clears all busy/pending markers when the authority changes", async () => {
    const goalCommands = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore("s1");
    harness.setCommands(goalCommands.commands);
    goalCommands.stage("session/goal/set");
    void harness.store.setGoal("in flight");

    const replacement = scriptedCommands("s1", GOAL_ALL);
    const replacementRead = replacement.stage("session/goal/get");
    harness.setCommands(replacement.commands);
    const refreshPromise = harness.store.refresh();
    replacementRead.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: null,
    });
    await refreshPromise;
    const state = harness.store.getState();
    expect(state.goalBusy).toBe(false);
  });
});

describe("AutonomyStore session binding", () => {
  it("a late result cannot change a newly selected session", async () => {
    const scripted = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore("s1");
    harness.setCommands(scripted.commands);
    const setGoal = scripted.stage("session/goal/set");
    const promise = harness.store.setGoal("old session work");

    harness.setSessionId("s2");
    setGoal.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: GOAL,
      generation: 1,
      transition_actor: "user",
    });
    await expect(promise).resolves.toBe(false);
    expect(harness.store.getState().goal).toBeNull();
  });
});

describe("AutonomyStore refresh revision guard", () => {
  it("a notification landing mid-refresh supersedes the stale snapshot", async () => {
    const scripted = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore("s1");
    harness.setCommands(scripted.commands);
    const goalRead = scripted.stage("session/goal/get");

    const refreshPromise = harness.store.refresh();
    expect(harness.store.getState().goalBusy).toBe(true);

    // Newer truth arrives while the GET is in flight.
    harness.store.observeNotification({
      jsonrpc: "2.0",
      method: "session/goal/updated",
      params: {
        session_id: "s1",
        goal: { ...GOAL, tokens_used: 9_999 },
        transition_actor: "backend",
        generation: 4,
      },
    });
    expect(harness.store.getState().goal?.tokens_used).toBe(9_999);

    // The older GET result resolves late — it must NOT overwrite.
    goalRead.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: { ...GOAL, tokens_used: 1 },
    });
    await refreshPromise;
    const state = harness.store.getState();
    expect(state.goal?.tokens_used).toBe(9_999);
    expect(state.goalGeneration).toBe(4);
    expect(state.goalBusy).toBe(false);
  });
});

describe("AutonomyStore goal generation admission", () => {
  it("a stale setGoal result cannot resurrect a newer clear", async () => {
    const scripted = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore("s1");
    harness.setCommands(scripted.commands);

    harness.store.observeNotification({
      jsonrpc: "2.0",
      method: "session/goal/updated",
      params: {
        session_id: "s1",
        goal: GOAL,
        transition_actor: "user",
        generation: 2,
      },
    });
    harness.store.observeNotification({
      jsonrpc: "2.0",
      method: "session/goal/cleared",
      params: {
        session_id: "s1",
        cleared: true,
        goal: null,
        transition_actor: "user",
        generation: 6,
      },
    });
    expect(harness.store.getState().goal).toBeNull();
    expect(harness.store.getState().goalGeneration).toBe(6);

    const setGoal = scripted.stage("session/goal/set");
    const promise = harness.store.setGoal("racing set");
    setGoal.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: GOAL,
      generation: 5, // older than the clear's watermark 6
      transition_actor: "user",
    });
    await expect(promise).resolves.toBe(false);
    expect(harness.store.getState().goal).toBeNull();
    expect(harness.store.getState().goalGeneration).toBe(6);
  });
});

describe("AutonomyStore error handling", () => {
  it("records the error only while the op stays authorized", async () => {
    const scripted = scriptedCommands("s1", MONITOR_ALL);
    const harness = makeStore("s1");
    harness.setCommands(scripted.commands);
    const pause = scripted.stage("monitor/pause");
    const promise = harness.store.controlMonitor("monitor_01", "pause");
    pause.reject(new Error("monitor_policy_denied"));
    await expect(promise).resolves.toBe(false);
    expect(harness.store.getState().monitorsError).toBe(
      "monitor_policy_denied",
    );
    expect(harness.store.getState().pendingMonitorIds.has("monitor_01")).toBe(
      false,
    );
  });

  it("drops the error when a newer epoch superseded the request", async () => {
    const scripted = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore("s1");
    harness.setCommands(scripted.commands);
    const setGoal = scripted.stage("session/goal/set");
    const promise = harness.store.setGoal("doomed");
    harness.setCommands(scriptedCommands("s1", GOAL_ALL).commands);
    setGoal.reject(new Error("late failure"));
    await expect(promise).resolves.toBe(false);
    expect(harness.store.getState().goalError).toBeNull();
  });
});

describe("AutonomyStore notification foreign-session isolation", () => {
  it("foreign autonomy stays visible as activity but never mutates state", () => {
    const scripted = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore("s1");
    harness.setCommands(scripted.commands);
    harness.store.observeNotification({
      jsonrpc: "2.0",
      method: "session/goal/updated",
      params: {
        session_id: "s2",
        goal: { ...GOAL, objective: "someone else's goal" },
        transition_actor: "backend",
        generation: 99,
      },
    });
    const state = harness.store.getState();
    expect(state.goal).toBeNull();
    expect(state.activity).toContain("s2");
  });
});

describe("useAutonomy thin hook wiring", () => {
  it("exposes the store surface through the controller", async () => {
    const { useAutonomy } = await import("./use-autonomy.ts");
    type Controller = ReturnType<typeof useAutonomy>;
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const scripted = scriptedCommands("s1", GOAL_ALL);
    let controller: Controller | null = null;
    function Probe() {
      controller = useAutonomy({
        commands: () => scripted.commands,
        sessionId: () => "s1",
      });
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    if (!controller) throw new Error("controller did not render");
    const rendered: Controller = controller;
    expect(rendered.sessionId).toBe("s1");
    expect(rendered.capabilities.goalSet).toBe(true);
    expect(typeof rendered.refresh).toBe("function");
    expect(typeof rendered.observeNotification).toBe("function");
  });
});

describe("review round-2 regressions: busy ownership", () => {
  it("R1/R2 reversal: a superseded refresh never unlocks the newer refresh's busy flags", async () => {
    const first = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore("s1");
    harness.setCommands(first.commands);
    const r1 = first.stage("session/goal/get");
    const refresh1 = harness.store.refresh();
    expect(harness.store.getState().goalBusy).toBe(true);

    // R2 supersedes R1 at the refresh gate.
    const r2 = first.stage("session/goal/get");
    const refresh2 = harness.store.refresh();

    // R1 resolves LATE — it must not release the busy holds R2 owns.
    r1.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: { ...GOAL, tokens_used: 1 },
    });
    await refresh1;
    expect(harness.store.getState().goalBusy).toBe(true);

    r2.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: { ...GOAL, tokens_used: 2 },
    });
    await refresh2;
    expect(harness.store.getState().goalBusy).toBe(false);
    expect(harness.store.getState().goal?.tokens_used).toBe(2);
  });

  it("refresh completion must not clear a pending mutation's busy flag", async () => {
    const scripted = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore("s1");
    harness.setCommands(scripted.commands);

    const read = scripted.stage("session/goal/get");
    const refreshPromise = harness.store.refresh();
    const set = scripted.stage("session/goal/set");
    const mutationPromise = harness.store.setGoal("mid-flight mutation");
    expect(harness.store.getState().goalBusy).toBe(true);

    // Refresh resolves first: mutation still owns a busy hold.
    read.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: null,
    });
    await refreshPromise;
    expect(harness.store.getState().goalBusy).toBe(true);

    set.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: GOAL,
      generation: 1,
      transition_actor: "user",
    });
    await mutationPromise;
    expect(harness.store.getState().goalBusy).toBe(false);
    expect(harness.store.getState().goal?.goal_id).toBe("goal_01");
  });
});

describe("review round-2 regressions: authority reset", () => {
  it("same-ID identity change resets data and the goal watermark, admitting a lower new generation", async () => {
    const first = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore("s1");
    harness.setCommands(first.commands);

    // Old Core lifetime stamped the watermark at 9.
    harness.store.observeNotification({
      jsonrpc: "2.0",
      method: "session/goal/updated",
      params: {
        session_id: "s1",
        goal: GOAL,
        transition_actor: "user",
        generation: 9,
      },
    });
    expect(harness.store.getState().goalGeneration).toBe(9);

    // Daemon restart: new commands object, SAME session id.
    const second = scriptedCommands("s1", GOAL_ALL);
    harness.setCommands(second.commands);

    const set = second.stage("session/goal/set");
    const promise = harness.store.setGoal("fresh lifetime goal");
    // The restarted Core stamps a LOWER generation than the dead one's 9 —
    // it must be admitted because the watermark was reset with the epoch.
    set.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: { ...GOAL, goal_id: "goal_new", objective: "fresh lifetime goal" },
      generation: 3,
      transition_actor: "user",
    });
    await expect(promise).resolves.toBe(true);
    const state = harness.store.getState();
    expect(state.goal?.goal_id).toBe("goal_new");
    expect(state.goalGeneration).toBe(3);
  });

  it("an identity change drops carried-over data under the same session id", () => {
    const first = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore("s1");
    harness.setCommands(first.commands);
    harness.store.observeNotification({
      jsonrpc: "2.0",
      method: "session/goal/updated",
      params: {
        session_id: "s1",
        goal: GOAL,
        transition_actor: "user",
        generation: 4,
      },
    });
    expect(harness.store.getState().goal).not.toBeNull();

    harness.setCommands(scriptedCommands("s1", GOAL_ALL).commands);
    // The render fence (setDeps inside setCommands) reset immediately.
    const state = harness.store.getState();
    expect(state.goal).toBeNull();
    expect(state.goalGeneration).toBe(0);
    expect(state.activity).toBeNull();
  });
});

describe("review round-2 regressions: agent output selection", () => {
  it("A/B reversal: a late agent A result can never revert agent B's output", async () => {
    const scripted = scriptedCommands("s1", AGENT_OUTPUT);
    const harness = makeStore("s1");
    harness.setCommands(scripted.commands);

    const readA = scripted.stage("agent/output/read");
    const promiseA = harness.store.readAgentOutput("agent_a");
    // B supersedes A at the single output-selection gate.
    const readB = scripted.stage("agent/output/read");
    const promiseB = harness.store.readAgentOutput("agent_b");

    readA.resolve({
      agent_id: "agent_a",
      session_id: "s1",
      source: "runtime",
      text: "A output",
      cursor: { offset: 0 },
      next_cursor: { offset: 8 },
      has_more: false,
      complete: true,
    });
    await promiseA;
    // A was superseded — its late result must not appear at all.
    expect(harness.store.getState().agentOutput).toBeNull();

    readB.resolve({
      agent_id: "agent_b",
      session_id: "s1",
      source: "runtime",
      text: "B output",
      cursor: { offset: 0 },
      next_cursor: { offset: 8 },
      has_more: false,
      complete: true,
    });
    await promiseB;
    expect(harness.store.getState().agentOutput?.agent_id).toBe("agent_b");
    expect(harness.store.getState().agentOutput?.text).toBe("B output");
  });
});

describe("review round-2 regressions: revision ownership", () => {
  it("a foreign background event during refresh does not discard the selected refresh results", async () => {
    const scripted = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore("s1");
    harness.setCommands(scripted.commands);
    const read = scripted.stage("session/goal/get");
    const refreshPromise = harness.store.refresh();

    // Foreign autonomy event: activity line only — it must NOT bump the
    // goal revision, so the in-flight refresh snapshot still applies.
    harness.store.observeNotification({
      jsonrpc: "2.0",
      method: "session/goal/updated",
      params: {
        session_id: "s2",
        goal: { ...GOAL, objective: "someone else's goal" },
        transition_actor: "backend",
        generation: 99,
      },
    });
    expect(harness.store.getState().activity).toContain("s2");

    read.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: { ...GOAL, tokens_used: 42 },
    });
    await refreshPromise;
    const state = harness.store.getState();
    expect(state.goal?.tokens_used).toBe(42);
    expect(state.goalBusy).toBe(false);
  });

  it("an unrelated-family owning event does not discard another family's refresh snapshot", async () => {
    // Monitor families mutate while the goal read is in flight; the goal
    // snapshot must still apply because revisions are per resource.
    const scripted = scriptedCommands("s1", GOAL_AND_MONITOR);
    const harness = makeStore("s1");
    harness.setCommands(scripted.commands);
    const goalRead = scripted.stage("session/goal/get");
    const refreshPromise = harness.store.refresh();

    harness.store.observeNotification({
      jsonrpc: "2.0",
      method: "monitor/fired",
      params: {
        session_id: "s1",
        monitor_id: "monitor_01",
        line_count: 1,
        fired_at_ms: 1_700_000_001_000,
      },
    });

    goalRead.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: { ...GOAL, tokens_used: 7 },
    });
    await refreshPromise;
    expect(harness.store.getState().goal?.tokens_used).toBe(7);
  });
});

describe("review round-2 regressions: create upsert", () => {
  it("a create notification landing before the response does not duplicate the row", async () => {
    const scripted = scriptedCommands("s1", MONITOR_CREATE);
    const harness = makeStore("s1");
    harness.setCommands(scripted.commands);

    const create = scripted.stage("monitor/create");
    const promise = harness.store.createMonitor({
      name: "watch-build",
      argv: ["./scripts/watch.sh"],
      mode: "poll",
    });

    // monitor/updated for the new id arrives BEFORE the RPC response.
    harness.store.observeNotification({
      jsonrpc: "2.0",
      method: "monitor/updated",
      params: {
        session_id: "s1",
        monitor: { ...MONITOR, monitor_id: "monitor_01" },
      },
    });
    expect(harness.store.getState().monitors).toHaveLength(1);

    create.resolve({
      session_id: "s1",
      profile_id: "dev",
      monitor_id: "monitor_01",
      monitor: { ...MONITOR, monitor_id: "monitor_01", fires_used: 1 },
      ok: true,
      status: "active",
      created: true,
    });
    await expect(promise).resolves.toBe(true);
    const monitors = harness.store.getState().monitors;
    expect(monitors).toHaveLength(1);
    expect(monitors[0]?.monitor_id).toBe("monitor_01");
    // Response data won by upsert.
    expect(monitors[0]?.fires_used).toBe(1);
  });
});

describe("review round-2 regressions: capability withdrawal", () => {
  it("null commands fail closed — no actionable capabilities, no fallback to old caps", async () => {
    const { useAutonomy } = await import("./use-autonomy.ts");
    type Controller = ReturnType<typeof useAutonomy>;
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");

    let withCommands: Controller | null = null;
    function ProbeWith() {
      withCommands = useAutonomy({
        commands: () => scriptedCommands("s1", GOAL_ALL).commands,
        sessionId: () => "s1",
      });
      return null;
    }
    renderToStaticMarkup(createElement(ProbeWith));
    if (!withCommands) throw new Error("controller did not render");
    const withCaps: Controller = withCommands;
    expect(withCaps.capabilities.goalSet).toBe(true);

    // Commands withdrawn (session closed / autonomy unnegotiated).
    let withoutCommands: Controller | null = null;
    function ProbeWithout() {
      withoutCommands = useAutonomy({
        commands: () => null,
        sessionId: () => "s1",
      });
      return null;
    }
    renderToStaticMarkup(createElement(ProbeWithout));
    if (!withoutCommands) throw new Error("controller did not render");
    const withdrawn: Controller = withoutCommands;
    expect(withdrawn.capabilities.goalSet).toBe(false);
    expect(withdrawn.capabilities.goalGet).toBe(false);
    expect(withdrawn.capabilities.monitorList).toBe(false);
    expect(withdrawn.capabilities.agentList).toBe(false);
  });
});

describe("corrective third-turn regressions", () => {
  it("keeps close locked until a superseded same-resource write really settles", async () => {
    const scripted = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore();
    harness.setCommands(scripted.commands);
    const first = scripted.stage("session/goal/set");
    const firstWrite = harness.store.setGoal("first");
    const second = scripted.stage("session/goal/set");
    const secondWrite = harness.store.setGoal("second");
    second.reject(new Error("newer rejected"));
    await secondWrite;
    expect(harness.store.getState().goalBusy).toBe(false);
    expect(harness.store.isMutationPending()).toBe(true);
    const snapshot = harness.store.getState();
    first.reject(new Error("older rejected"));
    await firstWrite;
    expect(harness.store.isMutationPending()).toBe(false);
    expect(harness.store.getState()).not.toBe(snapshot);
  });
  it("locks close synchronously for writes, but not reads, and releases after rejection", async () => {
    const scripted = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore();
    harness.setCommands(scripted.commands);
    const get = scripted.stage("session/goal/get");
    const read = harness.store.refresh();
    expect(harness.store.isMutationPending()).toBe(false);
    const set = scripted.stage("session/goal/set");
    const write = harness.store.setGoal("explicit action");
    expect(harness.store.isMutationPending()).toBe(true);
    set.reject(new Error("failed"));
    await write;
    expect(harness.store.isMutationPending()).toBe(false);
    get.resolve({ session_id: "s1", profile_id: "dev", goal: null });
    await read;
  });
  it("synchronizes a pre-render authority change before admitting an old callback", () => {
    let commands = scriptedCommands("s1", GOAL_ALL).commands;
    const deps = { commands: () => commands, sessionId: () => "s1" };
    const store = new AutonomyStore(deps);
    store.setDeps(deps);
    const epoch = store.authorityEpoch;
    commands = scriptedCommands("s1", GOAL_ALL).commands;
    // Deliberately NO setDeps: socket callback wins the render race.
    store.observeNotification(
      {
        jsonrpc: "2.0",
        method: "session/goal/updated",
        params: {
          session_id: "s1",
          goal: GOAL,
          generation: 99,
          transition_actor: "user",
        },
      },
      epoch,
    );
    expect(store.authorityEpoch).toBeGreaterThan(epoch);
    expect(store.getState().goal).toBeNull();
    expect(store.getState().goalGeneration).toBe(0);
    expect(store.getState().activity).toBeNull();
  });

  it("rejects a foreign nested notification even from the current source", () => {
    const harness = makeStore();
    harness.setCommands(scriptedCommands("s1", LOOP_LIST_ONLY).commands);
    harness.store.observeNotification(
      {
        jsonrpc: "2.0",
        method: "loop/updated",
        params: {
          session_id: "s1",
          loop_id: "loop_01",
          loop: { ...LOOP, session_id: "foreign", loop_id: "foreign-loop" },
        },
      },
      harness.store.authorityEpoch,
    );
    expect(harness.store.getState().loops).toEqual([]);
    expect(harness.store.getState().activity).toBeNull();
  });

  it("keeps the accepted mutation when both RPC promises resolve before awaiting either", async () => {
    const scripted = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore();
    harness.setCommands(scripted.commands);
    const get = scripted.stage("session/goal/get");
    const set = scripted.stage("session/goal/set");
    const refresh = harness.store.refresh();
    const mutation = harness.store.setGoal("same tick");
    set.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: GOAL,
      generation: 1,
      transition_actor: "user",
    });
    get.resolve({ session_id: "s1", profile_id: "dev", goal: null });
    await Promise.all([refresh, mutation]);
    expect(harness.store.getState().goal?.goal_id).toBe(GOAL.goal_id);
    expect(harness.store.getState().goalBusy).toBe(false);
  });
  it("same-tick accepted set then pending refresh read cannot clobber the goal", async () => {
    const scripted = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore("s1");
    harness.setCommands(scripted.commands);

    // Refresh GET is staged FIRST (it holds the older goal revision).
    const pendingGet = scripted.stage("session/goal/get");
    const refreshPromise = harness.store.refresh();
    // ...and completes LAST, in the same tick as the accepted set below.

    const setGoal = scripted.stage("session/goal/set");
    const setPromise = harness.store.setGoal("must survive");

    // Same tick: set(gen 1) resolves, then the pending GET (goal: null).
    setGoal.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: { ...GOAL, objective: "must survive" },
      generation: 1,
      transition_actor: "user",
    });
    await setPromise;
    pendingGet.resolve({
      session_id: "s1",
      profile_id: "dev",
      goal: null,
    });
    await refreshPromise;

    const state = harness.store.getState();
    expect(state.goal?.objective).toBe("must survive");
    expect(state.goalGeneration).toBe(1);
    expect(state.goalError).toBeNull();
  });

  it("a disconnected old notification cannot repopulate state after commands withdrawn", () => {
    const scripted = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore("s1");
    harness.setCommands(scripted.commands);
    harness.store.observeNotification({
      jsonrpc: "2.0",
      method: "session/goal/updated",
      params: {
        session_id: "s1",
        goal: GOAL,
        transition_actor: "user",
        generation: 4,
      },
    });
    expect(harness.store.getState().goal).not.toBeNull();

    // Commands withdrawn (disconnect / close). The render fence resets.
    harness.setCommands(null);
    expect(harness.store.getState().goal).toBeNull();

    // A late same-session frame from the dead socket arrives afterwards.
    harness.store.observeNotification({
      jsonrpc: "2.0",
      method: "session/goal/updated",
      params: {
        session_id: "s1",
        goal: { ...GOAL, objective: "resurrected" },
        transition_actor: "user",
        generation: 99,
      },
    });
    const state = harness.store.getState();
    expect(state.goal).toBeNull();
    expect(state.goalGeneration).toBe(0);
    expect(state.activity).toBeNull();
  });

  it("an activity-only loop/fired does not discard a valid in-flight loops list", async () => {
    const scripted = scriptedCommands("s1", LOOP_LIST_ONLY);
    const harness = makeStore("s1");
    harness.setCommands(scripted.commands);

    const listRead = scripted.stage("loop/list");
    const refreshPromise = harness.store.refresh();

    // Core's scheduler emits `loop/fired` with `loop_state: None`
    // (ui_protocol_transport.rs:39492) — activity only, NO loop record.
    harness.store.observeNotification({
      jsonrpc: "2.0",
      method: "loop/fired",
      params: { session_id: "s1", loop_id: "loop_01" },
    });
    expect(harness.store.getState().activity).toContain("fired");

    listRead.resolve({
      session_id: "s1",
      profile_id: "dev",
      loops: [LOOP],
    });
    await refreshPromise;

    const state = harness.store.getState();
    // Previously stayed [] because the activity-only event bumped the loops
    // revision and discarded the valid in-flight snapshot.
    expect(state.loops).toHaveLength(1);
    expect(state.loops[0]?.loop_id).toBe("loop_01");
  });

  it("a late old-client notification captured under a previous epoch cannot poison the new store", () => {
    const first = scriptedCommands("s1", GOAL_ALL);
    const harness = makeStore("s1");
    harness.setCommands(first.commands);
    const staleEpoch = harness.store.authorityEpoch;

    // Same-session reauth: a NEW commands object starts a new authority
    // epoch (commands-existence alone would not fence this).
    const second = scriptedCommands("s1", GOAL_ALL);
    harness.setCommands(second.commands);
    const freshEpoch = harness.store.authorityEpoch;
    expect(freshEpoch).toBeGreaterThan(staleEpoch);

    // The old client's frame arrives late, tagged with ITS captured epoch.
    harness.store.observeNotification(
      {
        jsonrpc: "2.0",
        method: "session/goal/updated",
        params: {
          session_id: "s1",
          goal: { ...GOAL, objective: "stale frame" },
          transition_actor: "user",
          generation: 5,
        },
      },
      staleEpoch,
    );
    const afterStale = harness.store.getState();
    expect(afterStale.goal).toBeNull();
    expect(afterStale.activity).toBeNull();

    // A frame tagged with the CURRENT epoch still applies normally.
    harness.store.observeNotification(
      {
        jsonrpc: "2.0",
        method: "session/goal/updated",
        params: {
          session_id: "s1",
          goal: { ...GOAL, objective: "fresh frame" },
          transition_actor: "user",
          generation: 2,
        },
      },
      freshEpoch,
    );
    expect(harness.store.getState().goal?.objective).toBe("fresh frame");
  });
});
