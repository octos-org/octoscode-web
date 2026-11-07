import { describe, expect, it } from "vitest";
import { parseExecutionEnvironmentResult } from "../src/execution-environment.ts";

const complete = {
  backend: "docker",
  docker_image: "node:22-bookworm",
  tools: {
    node: "available",
    npm: "available",
    git: "available",
    python: "missing",
  },
  probe_status: "complete",
  probed_at: "2026-11-01T00:00:00Z",
};

describe("session execution environment result", () => {
  it("preserves a complete probe without guessing missing tools", () => {
    expect(parseExecutionEnvironmentResult(complete)).toEqual(complete);
  });

  it("rejects malformed tool states instead of presenting them as facts", () => {
    expect(
      parseExecutionEnvironmentResult({
        ...complete,
        tools: { ...complete.tools, node: "installed" },
      }),
    ).toBeNull();
  });
});
