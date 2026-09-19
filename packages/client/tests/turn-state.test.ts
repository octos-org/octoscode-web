import { describe, expect, it } from "vitest";
import { parseTurnStateGetResult } from "../src/turn-state.ts";
import { supportsTurnStateGet } from "../src/interaction.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

const base = {
  session_id: "coding:local:main",
  turn_id: "turn-1",
  state: "unknown",
};

describe("Core rc.9 turn/state/get narrow contract", () => {
  it.each([
    "active",
    "interrupting",
    "completed",
    "errored",
    "interrupted",
    "unknown",
  ])("accepts explicit %s and omitted empty metadata", (state) => {
    expect(parseTurnStateGetResult({ ...base, state })).toEqual({
      ...base,
      state,
      committed_seqs: [],
    });
  });

  it("keeps the server's certainty that an unknown turn is not running (UPCR-2026-031)", () => {
    expect(
      parseTurnStateGetResult({ ...base, state: "unknown", running: false }),
    ).toEqual({
      ...base,
      state: "unknown",
      committed_seqs: [],
      running: false,
    });
  });

  it.each([
    [{ state: "active", running: false }],
    [{ state: "unknown", running: true }],
    [{ state: "unknown", running: "false" }],
  ])("drops a running flag outside the UPCR-2026-031 contract: %j", (extra) => {
    expect(parseTurnStateGetResult({ ...base, ...extra })).not.toHaveProperty(
      "running",
    );
  });

  it("accepts lifecycle metadata and ignores unrelated context extensions", () => {
    expect(
      parseTurnStateGetResult({
        ...base,
        state: "completed",
        started_at: "2026-09-14T00:00:00Z",
        completed_at: "2026-09-14T00:00:01Z",
        thread_id: "thread-1",
        committed_seqs: [0, 1],
        context: { future: true },
      }),
    ).toEqual({
      ...base,
      state: "completed",
      started_at: "2026-09-14T00:00:00Z",
      completed_at: "2026-09-14T00:00:01Z",
      thread_id: "thread-1",
      committed_seqs: [0, 1],
    });
  });

  it.each([
    { state: "future" },
    { state: null },
    { session_id: "" },
    { turn_id: 1 },
    { started_at: 123 },
    { thread_id: null },
    { committed_seqs: [-1] },
    { committed_seqs: [1.1] },
    { committed_seqs: [Number.MAX_SAFE_INTEGER + 1] },
    { committed_seqs: ["1"] },
    { committed_seqs: null },
  ])("rejects malformed lifecycle data %j", (invalid) => {
    expect(parseTurnStateGetResult({ ...base, ...invalid })).toBeNull();
  });

  it("requires both negotiated feature and an advertised method without a denial", () => {
    const capabilities: UiProtocolCapabilities = {
      version: { protocol: "octos-ui", schema_version: 1, jsonrpc: "2.0" },
      capabilities_schema_version: 2,
      supported_methods: ["turn/state/get"],
      supported_notifications: [],
      supported_features: ["state.turn_state_get.v1"],
    };
    expect(supportsTurnStateGet(capabilities)).toBe(true);
    expect(supportsTurnStateGet(undefined)).toBe(false);
    expect(
      supportsTurnStateGet({ ...capabilities, supported_features: [] }),
    ).toBe(false);
    expect(
      supportsTurnStateGet({ ...capabilities, supported_methods: [] }),
    ).toBe(false);
    expect(
      supportsTurnStateGet({
        ...capabilities,
        unsupported: [
          { method: "turn/state/get", reason: "feature_not_negotiated" },
        ],
      }),
    ).toBe(false);
  });
});
