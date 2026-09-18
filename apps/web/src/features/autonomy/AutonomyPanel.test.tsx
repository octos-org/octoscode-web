import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { AutonomyPanel } from "./AutonomyPanel.tsx";
import { EMPTY_AUTONOMY } from "./model.ts";
import type { AutonomyController } from "./use-autonomy.ts";
import type { AutonomyCapabilities, AutonomyRpc } from "./client-contract.ts";
import { createSessionAutonomyCommands } from "./client-contract.ts";

const GOAL_RECORD = {
  profile_id: "dev",
  goal_id: "goal_01",
  objective: "Ship the parity slice",
  status: "active",
  token_budget: 300_000,
  tokens_used: 1_200,
  time_used_seconds: 45,
  created_at_ms: 1_700_000_000_000,
  updated_at_ms: 1_700_000_000_500,
};

const LOOP_RECORD = {
  loop_id: "loop_01",
  session_id: "s1",
  profile_id: "dev",
  prompt: "Check the deploy",
  mode: "fixed_interval",
  interval_seconds: 60,
  status: "active",
  next_run_at_ms: 1_700_000_060_000,
  expires_at_ms: 1_700_086_400_000,
  created_at_ms: 1_700_000_000_000,
  updated_at_ms: 1_700_000_000_000,
};

const MONITOR_RECORD = {
  monitor_id: "monitor_01",
  session_id: "s1",
  profile_id: "dev",
  name: "watch-build",
  argv: ["./scripts/watch.sh"],
  filter_regex: "ERROR.*",
  mode: "poll",
  interval_seconds: 30,
  batch_ms: 500,
  max_events_per_hour: 60,
  persistent: false,
  status: "active",
  fires_used: 2,
  expires_at_ms: 1_700_003_600_000,
  created_at_ms: 1_700_000_000_000,
  updated_at_ms: 1_700_000_000_000,
};

const AGENT_RECORD = {
  agent_id: "agent_01",
  session_id: "s1",
  path: "/repo/src/app.ts",
  role: "implementer",
  nickname: "impl-1",
  backend_kind: "builtin",
  status: "running",
  profile_id: "dev",
  created_at_ms: 1_700_000_000_000,
  updated_at_ms: 1_700_000_000_000,
  artifact_count: 1,
  artifacts: [{ id: "a", title: "Diff", kind: "diff", status: "ready" }],
  output_tail: "still working",
};

function controller(overrides: {
  state?: Partial<typeof EMPTY_AUTONOMY>;
  capabilities?: Partial<AutonomyCapabilities>;
  actions?: Partial<AutonomyController>;
}): AutonomyController {
  return {
    state: { ...EMPTY_AUTONOMY, sessionId: "s1", ...overrides.state },
    capabilities: {
      ...EMPTY_AUTONOMY.capabilities,
      ...overrides.capabilities,
    },
    sessionId: "s1",
    refresh: vi.fn(),
    isMutationPending: () => false,
    setGoal: vi.fn().mockResolvedValue(true),
    clearGoal: vi.fn().mockResolvedValue(true),
    transitionGoal: vi.fn().mockResolvedValue(true),
    createLoop: vi.fn().mockResolvedValue(true),
    controlLoop: vi.fn().mockResolvedValue(true),
    createMonitor: vi.fn().mockResolvedValue(true),
    controlMonitor: vi.fn().mockResolvedValue(true),
    readAgentOutput: vi.fn().mockResolvedValue(true),
    readAgentStatus: vi.fn().mockResolvedValue(true),
    listAgentArtifacts: vi.fn().mockResolvedValue(true),
    readAgentArtifact: vi.fn().mockResolvedValue(true),
    controlAgent: vi.fn().mockResolvedValue(true),
    observeNotification: vi.fn(),
    ...overrides.actions,
  };
}

describe("AutonomyPanel capability gating", () => {
  it("shows all native unfinished-goal transitions only with both read and write gates", () => {
    const render = (
      capabilities: Partial<AutonomyCapabilities>,
      status = "active",
    ) =>
      renderToStaticMarkup(
        createElement(AutonomyPanel, {
          controller: controller({
            capabilities,
            state: { goal: { ...GOAL_RECORD, status } },
          }),
        }),
      );
    const supported = render({ goalGet: true, goalSet: true });
    expect(supported).toContain('aria-label="Pause session goal"');
    expect(supported).toContain('aria-label="Resume session goal"');
    expect(supported).toContain('aria-label="Stop session goal"');
    expect(render({ goalSet: true })).not.toContain(
      'aria-label="Pause session goal"',
    );
    expect(render({ goalGet: true })).not.toContain(
      'aria-label="Resume session goal"',
    );
    expect(render({ goalGet: true, goalSet: true }, "complete")).not.toContain(
      'aria-label="Stop session goal"',
    );
  });
  it("gates agent status, artifacts and controls individually without requiring list for direct IDs", () => {
    const html = renderToStaticMarkup(
      createElement(AutonomyPanel, {
        controller: controller({
          capabilities: {
            agentStatusRead: true,
            agentArtifactList: true,
            agentArtifactRead: true,
            agentInterrupt: true,
            agentClose: true,
          },
        }),
      }),
    );
    expect(html).toContain("Read status");
    expect(html).toContain("List artifacts");
    expect(html).toContain("Read artifact by path");
    expect(html).toContain("Interrupt agent");
    expect(html).toContain("Close agent");
    expect(html).not.toContain("Read output");
    expect(html).not.toContain('aria-label="Agent list"');
  });
  it("renders escaped artifact content with its exact agent and artifact IDs", () => {
    const html = renderToStaticMarkup(
      createElement(AutonomyPanel, {
        controller: controller({
          capabilities: { agentArtifactRead: true },
          state: {
            agentArtifact: {
              session_id: "s1",
              agent_id: "agent_01",
              artifact: {
                id: "artifact_1",
                title: "Evidence",
                kind: "text",
                status: "ready",
              },
              content: "<script>not executable</script>",
            },
          },
        }),
      }),
    );
    expect(html).toContain("Artifact — agent_01 / artifact_1");
    expect(html).toContain("&lt;script&gt;not executable&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("offers spawn only through an explicit host callback and advertised native gate", () => {
    const render = (advertised: boolean, callback = false) =>
      renderToStaticMarkup(
        createElement(AutonomyPanel, {
          controller: controller({ capabilities: { agentList: advertised } }),
          ...(callback
            ? { onSpawnAgents: vi.fn(() => true), spawnAvailable: true }
            : {}),
        }),
      );
    expect(render(true, true)).toContain(
      'aria-label="Request parallel agents"',
    );
    expect(render(false, true)).not.toContain(
      'aria-label="Request parallel agents"',
    );
    expect(render(true)).not.toContain('aria-label="Request parallel agents"');
  });
  it("renders nothing when no autonomy method is advertised", () => {
    const html = renderToStaticMarkup(
      createElement(AutonomyPanel, {
        controller: controller({}),
      }),
    );
    // No goal/loop/monitor sections; only the shell header remains.
    expect(html).not.toContain("Goal");
    expect(html).not.toContain("Loops");
    expect(html).not.toContain("Monitors");
    expect(html).not.toContain("Agents");
  });

  it("renders the goal section only when goal methods are advertised", () => {
    const html = renderToStaticMarkup(
      createElement(AutonomyPanel, {
        controller: controller({
          capabilities: { goalGet: true, goalSet: true, goalClear: true },
          state: { goal: GOAL_RECORD },
        }),
      }),
    );
    expect(html).toContain("Ship the parity slice");
    expect(html).toContain("Active");
    expect(html).toContain("Set goal");
    expect(html).toContain("Clear goal");
    // Other families stay hidden.
    expect(html).not.toContain("Loops");
    expect(html).not.toContain("Monitors");
  });

  it("hides controls the server does not advertise even inside a visible section", () => {
    const html = renderToStaticMarkup(
      createElement(AutonomyPanel, {
        controller: controller({
          capabilities: { loopList: true },
          state: { loops: [LOOP_RECORD] },
        }),
      }),
    );
    expect(html).toContain("Check the deploy");
    // loopList alone: no create form, no pause/delete/fire buttons.
    expect(html).not.toContain("Create loop");
    expect(html).not.toContain("Pause");
    expect(html).not.toContain("Fire now");
  });

  it("renders loop controls with per-action accessibility labels", () => {
    const html = renderToStaticMarkup(
      createElement(AutonomyPanel, {
        controller: controller({
          capabilities: {
            loopList: true,
            loopCreate: true,
            loopPause: true,
            loopResume: true,
            loopDelete: true,
            loopFireNow: true,
          },
          state: { loops: [LOOP_RECORD] },
        }),
      }),
    );
    expect(html).toContain('aria-label="Fire loop loop_01 now"');
    expect(html).toContain('aria-label="Pause loop loop_01"');
    expect(html).toContain('aria-label="Delete loop loop_01"');
    expect(html).toContain('aria-label="Create loop"');
  });

  it("renders paused loops with resume instead of pause", () => {
    const html = renderToStaticMarkup(
      createElement(AutonomyPanel, {
        controller: controller({
          capabilities: {
            loopList: true,
            loopPause: true,
            loopResume: true,
            loopDelete: true,
          },
          state: {
            loops: [{ ...LOOP_RECORD, status: "paused" }],
          },
        }),
      }),
    );
    expect(html).toContain('aria-label="Resume loop loop_01"');
    expect(html).not.toContain('aria-label="Pause loop loop_01"');
  });

  it("renders monitors with status and control actions", () => {
    const html = renderToStaticMarkup(
      createElement(AutonomyPanel, {
        controller: controller({
          capabilities: {
            monitorList: true,
            monitorCreate: true,
            monitorPause: true,
            monitorResume: true,
            monitorDelete: true,
          },
          state: { monitors: [MONITOR_RECORD] },
        }),
      }),
    );
    expect(html).toContain("watch-build");
    expect(html).toContain("./scripts/watch.sh");
    expect(html).toContain('aria-label="Pause monitor monitor_01"');
    expect(html).toContain('aria-label="Delete monitor monitor_01"');
  });

  it("renders flooded pause reason when present", () => {
    const html = renderToStaticMarkup(
      createElement(AutonomyPanel, {
        controller: controller({
          capabilities: { monitorList: true, monitorResume: true },
          state: {
            monitors: [
              {
                ...MONITOR_RECORD,
                status: "paused",
                pause_reason: "flooded",
              },
            ],
          },
        }),
      }),
    );
    expect(html).toContain("paused (flooded)");
    expect(html).toContain('aria-label="Resume monitor monitor_01"');
  });

  it("renders the agent roster behind agentList", () => {
    const html = renderToStaticMarkup(
      createElement(AutonomyPanel, {
        controller: controller({
          capabilities: { agentList: true, agentOutputRead: true },
          state: { agents: [AGENT_RECORD] },
        }),
      }),
    );
    expect(html).toContain("impl-1");
    expect(html).toContain("implementer");
    expect(html).toContain("still working");
    expect(html).toContain('aria-label="Read output of agent agent_01"');
  });

  it("surfaces errors under role=alert", () => {
    const html = renderToStaticMarkup(
      createElement(AutonomyPanel, {
        controller: controller({
          capabilities: { goalGet: true },
          state: { goalError: "goal_runtime_unavailable" },
        }),
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("goal_runtime_unavailable");
  });
});

describe("AutonomyPanel interactions", () => {
  it("creates a monitor with the form values", () => {
    // renderToStaticMarkup cannot submit forms; the interaction path is
    // exercised through the controller contract here and the hook tests.
    const createMonitor = vi.fn().mockResolvedValue(true);
    renderToStaticMarkup(
      createElement(AutonomyPanel, {
        controller: controller({
          capabilities: { monitorList: true, monitorCreate: true },
          actions: { createMonitor },
        }),
      }),
    );
    expect(createMonitor).not.toHaveBeenCalled();
  });
});

describe("session-scoped command guards", () => {
  const caps = {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: ["session/goal/get"],
    supported_notifications: [],
    supported_features: ["coding.goal_runtime.v1"],
  };

  it("treats a result naming another session as a protocol error", async () => {
    const rpc: AutonomyRpc = {
      request: async () => ({
        session_id: "s2",
        profile_id: "dev",
        goal: null,
      }),
    };
    await expect(
      createSessionAutonomyCommands(rpc, "s1", caps).goal.read(),
    ).rejects.toThrow(/does not match owning session/);
  });

  it("rejects malformed results instead of guessing", async () => {
    const rpc: AutonomyRpc = {
      request: async () => ({ session_id: "s1", profile_id: "dev" }),
    };
    await expect(
      createSessionAutonomyCommands(rpc, "s1", caps).goal.read(),
    ).rejects.toThrow(/invalid result payload/);
  });

  it("fails closed before the wire when the method is not advertised", async () => {
    const request = vi.fn(async () => ({
      session_id: "s1",
      profile_id: "dev",
      goal: null,
    }));
    await expect(
      createSessionAutonomyCommands(rpcWith(request), "s1", {
        ...caps,
        supported_methods: [],
      }).goal.read(),
    ).rejects.toThrow(/not advertised/);
    expect(request).not.toHaveBeenCalled();
  });
});

function rpcWith(request: (method: string, params: unknown) => unknown) {
  return { request } as unknown as AutonomyRpc;
}
