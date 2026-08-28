import { describe, expect, it } from "vitest";
import {
  parseConfigCapabilitiesListResult,
  parseLaunchResolveResult,
  parseSessionDeleteResult,
  parseSessionFilesListResult,
  parseSessionListResult,
  parseSessionStatusReadResult,
  parseTokenCostUpdate,
} from "../src/index.ts";
import type { RpcNotification } from "../src/index.ts";
import fixture from "./fixtures/ui-protocol-v1.json";

describe("workspace product contract", () => {
  it("decodes pre-session capabilities and every launch decision", () => {
    expect(
      parseConfigCapabilitiesListResult(
        fixture.config_capabilities_list.result,
      ),
    ).toEqual(fixture.config_capabilities_list.result);
    expect(
      parseLaunchResolveResult(fixture.launch_resolve.results.resume),
    ).toEqual({
      ...fixture.launch_resolve.results.resume,
      existing_profiles: [],
    });
    expect(
      parseLaunchResolveResult(fixture.launch_resolve.results.activate),
    ).toEqual({
      ...fixture.launch_resolve.results.activate,
      existing_profiles: [],
    });
    expect(
      parseLaunchResolveResult(fixture.launch_resolve.results.cross_profile),
    ).toEqual(fixture.launch_resolve.results.cross_profile);
    expect(
      parseLaunchResolveResult(fixture.launch_resolve.results.no_profile),
    ).toEqual({ decision: "no_profile", existing_profiles: [] });
  });

  it("rejects contradictory launch decisions", () => {
    expect(parseLaunchResolveResult({ decision: "resume" })).toBeNull();
    for (const decision of ["resume", "activate"] as const) {
      expect(
        parseLaunchResolveResult({
          decision,
          resolved_profile: "deepseek",
          existing_profiles: ["glm"],
        }),
      ).toBeNull();
    }
    expect(
      parseLaunchResolveResult({
        decision: "cross_profile",
        resolved_profile: "deepseek",
      }),
    ).toBeNull();
    expect(
      parseLaunchResolveResult({
        decision: "no_profile",
        resolved_profile: "deepseek",
      }),
    ).toBeNull();
    expect(
      parseLaunchResolveResult({
        decision: "no_profile",
        existing_profiles: ["deepseek"],
      }),
    ).toBeNull();
  });

  it("rejects ambiguous or unbounded launch profile identities", () => {
    expect(
      parseLaunchResolveResult({
        decision: "cross_profile",
        resolved_profile: "deepseek",
        existing_profiles: ["glm", "glm"],
      }),
    ).toBeNull();
    expect(
      parseLaunchResolveResult({
        decision: "cross_profile",
        resolved_profile: "deepseek",
        existing_profiles: ["glm", "deepseek"],
      }),
    ).toBeNull();

    const oversizedProfileId = "p".repeat(65);
    expect(
      parseLaunchResolveResult({
        decision: "activate",
        resolved_profile: oversizedProfileId,
      }),
    ).toBeNull();
    expect(
      parseLaunchResolveResult({
        decision: "cross_profile",
        resolved_profile: "deepseek",
        existing_profiles: [oversizedProfileId],
      }),
    ).toBeNull();

    expect(
      parseLaunchResolveResult({
        decision: "cross_profile",
        resolved_profile: "deepseek",
        existing_profiles: Array.from(
          { length: 257 },
          (_, index) => `profile-${index}`,
        ),
      }),
    ).toBeNull();
  });

  it("decodes session rows and file handles without exposing host paths", () => {
    expect(parseSessionListResult(fixture.session_list.result)).toMatchObject({
      sessions: [{ message_count: 12 }],
    });
    expect(
      parseSessionFilesListResult(fixture.session_files_list.result),
    ).toMatchObject({ files: [{ filename: "check.txt", size_bytes: 42 }] });
    expect(parseSessionDeleteResult(fixture.session_delete.result)).toEqual({});
  });

  it("rejects malformed session metadata and file sizes", () => {
    expect(
      parseSessionListResult({ sessions: [{ id: "", message_count: -1 }] }),
    ).toBeNull();
    expect(
      parseSessionFilesListResult({
        files: [
          { filename: "x", path: "x", size_bytes: -1, modified_at: "now" },
        ],
      }),
    ).toBeNull();
  });

  it("decodes status cost totals and live context-window updates", () => {
    expect(
      parseSessionStatusReadResult(fixture.session_status_read.result),
    ).toMatchObject({
      usage: { input_tokens: 1200, estimated_cost_micros_usd: 2500 },
      health: { status: "ok" },
    });
    expect(
      parseTokenCostUpdate(
        fixture.token_cost_update as unknown as RpcNotification,
      ),
    ).toMatchObject({
      sessionId: "coding:local:main",
      inputTokens: 128_000,
      sessionCost: 0.12,
      contextWindow: 1_000_000,
    });
  });
});
