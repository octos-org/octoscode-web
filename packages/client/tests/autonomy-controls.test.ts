import { describe, expect, it } from "vitest";
import {
  createSessionAutonomyCommands,
  parseAgentArtifactReadResult,
  parseAgentControlResult,
  parseAutonomyCapabilities,
  type AgentArtifactSelector,
} from "../src/autonomy.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

const AGENT = {
  agent_id: "a1",
  session_id: "dev:local:room#agent",
  path: "master/a1",
  role: "implementer",
  nickname: "Ada",
  backend_kind: "native",
  status: "running",
  profile_id: "dev",
  created_at_ms: 1,
  updated_at_ms: 2,
  artifact_count: 1,
  artifacts: [],
};
const ARTIFACT = {
  id: "artifact-1",
  title: "Result",
  kind: "text",
  status: "ready",
};
const GOAL = {
  goal_id: "g1",
  objective: "Fresh objective",
  status: "active",
  token_budget: 100,
  tokens_used: 10,
  time_used_seconds: 1,
  created_at_ms: 1,
  updated_at_ms: 2,
};
const METHODS = [
  "session/goal/get",
  "session/goal/set",
  "agent/status/read",
  "agent/artifact/list",
  "agent/artifact/read",
  "agent/interrupt",
  "agent/close",
];
function caps(
  methods = METHODS,
  features = ["coding.agent_control.v1", "coding.goal_runtime.v1"],
): UiProtocolCapabilities {
  return {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: methods,
    supported_features: features,
    supported_notifications: [],
  };
}
function harness(result: unknown, capabilities = caps()) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const commands = createSessionAutonomyCommands(
    {
      request: async (method, params) => {
        calls.push({ method, params });
        return result;
      },
    },
    "dev:local:room#request",
    capabilities,
  );
  return { calls, commands };
}
const control = (status: "interrupted" | "closed") => ({
  agent_id: "a1",
  session_id: AGENT.session_id,
  status,
  ok: true,
  interrupted: status === "interrupted",
  closed: status === "closed",
  already_terminal: false,
});

describe("native goal transition contract", () => {
  it.each(["paused", "active", "complete"] as const)(
    "writes exact %s user transition without a new budget",
    async (status) => {
      const h = harness({
        session_id: "dev:local:room#request",
        profile_id: "dev",
        goal: { ...GOAL, status },
        generation: 2,
        transition_actor: "user",
      });
      await h.commands.goal.transition(" Fresh objective ", status);
      expect(h.calls).toEqual([
        {
          method: "session/goal/set",
          params: {
            session_id: "dev:local:room#request",
            objective: "Fresh objective",
            status,
            transition_actor: "user",
          },
        },
      ]);
    },
  );
  it("ordinary goal set explicitly activates as user and preserves only an explicit budget", async () => {
    const h = harness({
      session_id: "dev:local:room#request",
      profile_id: "dev",
      goal: GOAL,
      generation: 2,
      transition_actor: "user",
    });
    await h.commands.goal.set("Fresh objective", 500);
    expect(h.calls[0]?.params).toEqual({
      session_id: "dev:local:room#request",
      objective: "Fresh objective",
      status: "active",
      transition_actor: "user",
      token_budget: 500,
    });
  });
  it.each([
    { methods: ["session/goal/get"] },
    { methods: ["session/goal/set"] },
  ])(
    "requires both native goal methods before transitioning",
    async ({ methods }) => {
      const h = harness(null, caps(methods));
      await expect(h.commands.goal.transition("x", "paused")).rejects.toThrow(
        /not advertised/,
      );
      expect(h.calls).toHaveLength(0);
    },
  );
});

describe("native agent inspection/control contracts", () => {
  it.each([
    ["agent/artifact/list", "agentArtifactList"],
    ["agent/artifact/read", "agentArtifactRead"],
    ["agent/interrupt", "agentInterrupt"],
    ["agent/close", "agentClose"],
  ] as const)("%s needs its own method and feature", (method, gate) => {
    expect(parseAutonomyCapabilities(caps([method]))[gate]).toBe(true);
    expect(parseAutonomyCapabilities(caps([method], []))[gate]).toBe(false);
    expect(parseAutonomyCapabilities(caps([]))[gate]).toBe(false);
  });
  it("uses full captured request scope and validates actual native child ownership", async () => {
    const h = harness({
      session_id: AGENT.session_id,
      agent_id: "a1",
      artifacts: [ARTIFACT],
    });
    const result = await h.commands.agent.listArtifacts("a1");
    expect(result.session_id).toBe(AGENT.session_id);
    expect(h.calls).toEqual([
      {
        method: "agent/artifact/list",
        params: { session_id: "dev:local:room#request", agent_id: "a1" },
      },
    ]);
  });
  it.each([
    { session_id: "dev:local:foreign", agent_id: "a1" },
    { session_id: AGENT.session_id, agent_id: "other" },
  ])("rejects foreign artifact ownership %j", async (owner) => {
    const h = harness({ ...owner, artifacts: [ARTIFACT] });
    await expect(h.commands.agent.listArtifacts("a1")).rejects.toThrow();
  });
  it("requires nested agent owner to agree exactly with the status envelope", async () => {
    const h = harness({
      session_id: AGENT.session_id,
      agent: { ...AGENT, session_id: "dev:local:room#other" },
    });
    await expect(h.commands.agent.readStatus("a1")).rejects.toThrow(
      /nested agent owner/,
    );
  });
  it.each([
    { artifactId: "artifact-1" },
    { path: "evidence/output.txt" },
  ] as const)("sends only native selector %j", async (selector) => {
    const h = harness({
      session_id: AGENT.session_id,
      agent_id: "a1",
      artifact: ARTIFACT,
      content: "redacted content",
    });
    expect((await h.commands.agent.readArtifact("a1", selector)).content).toBe(
      "redacted content",
    );
    expect(h.calls[0]?.params).toEqual({
      agent_id: "a1",
      session_id: "dev:local:room#request",
      ...("artifactId" in selector
        ? { artifact_id: selector.artifactId }
        : { path: selector.path }),
    });
  });
  it.each([
    {},
    { artifactId: "" },
    { path: " " },
    { artifactId: "id", path: "path" },
  ])("rejects invalid artifact selector %j before RPC", async (selector) => {
    const h = harness(null);
    await expect(
      h.commands.agent.readArtifact("a1", selector as AgentArtifactSelector),
    ).rejects.toThrow();
    expect(h.calls).toHaveLength(0);
  });
  it("rejects a different artifact ID even on the correct agent", async () => {
    const h = harness({
      session_id: AGENT.session_id,
      agent_id: "a1",
      artifact: { ...ARTIFACT, id: "foreign" },
      content: "wrong",
    });
    await expect(
      h.commands.agent.readArtifact("a1", { artifactId: "artifact-1" }),
    ).rejects.toThrow(/artifact id/);
  });
  it("never exposes unredacted nested artifact content or treats missing content as success", () => {
    const result = parseAgentArtifactReadResult({
      session_id: AGENT.session_id,
      agent_id: "a1",
      artifact: { ...ARTIFACT, content: "UNREDACTED" },
      content: "[REDACTED]",
    });
    expect(result).toEqual({
      session_id: AGENT.session_id,
      agent_id: "a1",
      artifact: ARTIFACT,
      content: "[REDACTED]",
    });
    expect(
      parseAgentArtifactReadResult({
        session_id: AGENT.session_id,
        agent_id: "a1",
        artifact: ARTIFACT,
      }),
    ).toBeNull();
  });
  it.each(["interrupt", "close"] as const)(
    "acknowledges exact native %s receipt without a fabricated agent",
    async (action) => {
      const result = control(action === "interrupt" ? "interrupted" : "closed");
      const h = harness(result);
      expect(await h.commands.agent[action]("a1")).toEqual(result);
      expect(h.calls).toEqual([
        {
          method: `agent/${action}`,
          params: { agent_id: "a1", session_id: "dev:local:room#request" },
        },
      ]);
    },
  );
  it("rejects opposite control transitions, false ok and contradictory terminal flags", async () => {
    await expect(
      harness(control("closed")).commands.agent.interrupt("a1"),
    ).rejects.toThrow(/different transition/);
    expect(
      parseAgentControlResult({ ...control("closed"), ok: false }),
    ).toBeNull();
    expect(
      parseAgentControlResult({ ...control("closed"), interrupted: true }),
    ).toBeNull();
  });
  it.each(["listArtifacts", "readArtifact", "interrupt", "close"] as const)(
    "%s fails closed when unadvertised",
    async (action) => {
      const h = harness(null, caps([]));
      const call =
        action === "readArtifact"
          ? h.commands.agent.readArtifact("a1", { artifactId: "artifact-1" })
          : h.commands.agent[action]("a1");
      await expect(call).rejects.toThrow(/not advertised/);
      expect(h.calls).toHaveLength(0);
    },
  );
});
