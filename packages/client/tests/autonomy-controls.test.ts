import { describe, expect, it } from "vitest";
import {
  createSessionAutonomyCommands,
  parseAgentArtifactReadResult,
  parseAgentControlResult,
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

describe("native agent inspection/control contracts", () => {
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
});
