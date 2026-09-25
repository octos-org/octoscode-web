import { describe, expect, it } from "vitest";
import {
  parseConfigCapabilitiesListResult,
  parseLaunchResolveResult,
  parseSessionDeleteResult,
  parseSessionFilesListResult,
  parseSessionListResult,
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

  it("keeps a session's live-turn flag distinguishable from an older server's silence", () => {
    // The flag is how this client learns that ANOTHER client attached to the
    // same server is mid-turn in a session it has not opened. A server that
    // does not report it must not be read as reporting "idle".
    const parsed = parseSessionListResult({
      sessions: [
        { id: "busy", message_count: 1, active_turn: true },
        { id: "idle", message_count: 1, active_turn: false },
        { id: "unknown", message_count: 1 },
      ],
    });
    expect(parsed?.sessions[0]?.active_turn).toBe(true);
    expect(parsed?.sessions[1]?.active_turn).toBe(false);
    expect(parsed?.sessions[2]).not.toHaveProperty("active_turn");
  });

  it("keeps a listing's scope attestation, and reads its absence as unscoped", () => {
    // Only a listing the server attests as scoped to one project store may be
    // placed under a workspace; the same `{cwd}` request to an older or
    // flag-off server returns the legacy global list with no attestation.
    expect(
      parseSessionListResult({
        sessions: [],
        workspace_root: "/srv/project",
        profile_id: "dev",
      }),
    ).toEqual({
      sessions: [],
      workspace_root: "/srv/project",
      profile_id: "dev",
    });
    const legacy = parseSessionListResult({ sessions: [] });
    expect(legacy).toEqual({ sessions: [] });
    expect(legacy).not.toHaveProperty("workspace_root");
    // Half an attestation (or a malformed one) attests nothing.
    for (const partial of [
      { sessions: [], workspace_root: "/srv/project" },
      { sessions: [], profile_id: "dev" },
      { sessions: [], workspace_root: "", profile_id: "dev" },
      { sessions: [], workspace_root: 7, profile_id: "dev" },
    ]) {
      expect(parseSessionListResult(partial)).toEqual({ sessions: [] });
    }
  });

  it("rejects a live-turn flag that is not a boolean", () => {
    expect(
      parseSessionListResult({
        sessions: [{ id: "busy", message_count: 1, active_turn: "yes" }],
      }),
    ).toBeNull();
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

  it("decodes live token cost and context-window updates", () => {
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
