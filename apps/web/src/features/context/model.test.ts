import { describe, expect, it } from "vitest";
import type {
  ContextSnapshot,
  UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import { compactAvailable, contextUsage } from "./model.ts";

describe("authoritative context occupancy", () => {
  const snapshot = {
    state: {
      session_id: "s1",
      generation: 3,
      token_estimate: 200,
      item_count: 5,
      recovery_state: "exact",
    },
  };
  it("never treats cumulative provider input usage as occupied context", () => {
    expect(
      contextUsage(snapshot, {
        sessionId: "s1",
        inputTokens: 9000,
        contextWindow: 1000,
      }).percent,
    ).toBe(20);
    expect(
      contextUsage(null, {
        sessionId: "s1",
        inputTokens: 9000,
        contextWindow: 1000,
      }).percent,
    ).toBeNull();
  });
  it("rejects cross-session or absent model windows and preserves zero", () => {
    expect(
      contextUsage(snapshot, { sessionId: "s2", contextWindow: 1000 }).percent,
    ).toBeNull();
    expect(
      contextUsage(snapshot, { sessionId: "s1", contextWindow: 0 }).percent,
    ).toBeNull();
    expect(
      contextUsage(snapshot, { sessionId: "s1", contextWindow: Infinity })
        .percent,
    ).toBeNull();
    expect(
      contextUsage(
        { ...snapshot, state: { ...snapshot.state, token_estimate: 0 } },
        { sessionId: "s1", contextWindow: 1000 },
      ).percent,
    ).toBe(0);
  });
});

function capabilities(
  methods: string[],
  unsupported?: { method: string; reason: string }[],
): UiProtocolCapabilities {
  return {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: methods,
    supported_notifications: [],
    ...(unsupported ? { unsupported } : {}),
  };
}

const guardState = {
  session_id: "s1",
  generation: 3,
  token_estimate: 200,
  item_count: 5,
  recovery_state: "exact",
};
const guardWindow = { sessionId: "s1", contextWindow: 1000 };

describe("context occupancy fails closed on malformed server payloads", () => {
  const estimates: [string, number][] = [
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative", -5],
    ["fractional", 1.5],
  ];
  it.each(estimates)(
    "treats a %s estimate as unknown, never leaking it",
    (_label, value) => {
      const result = contextUsage(
        { state: { ...guardState, token_estimate: value } },
        guardWindow,
      );
      expect(result.tokens).toBeUndefined();
      expect(result.window).toBe(1000);
      expect(result.percent).toBeNull();
    },
  );
  it("treats a missing state or estimate as unknown", () => {
    const payloads: (ContextSnapshot | null | undefined)[] = [
      undefined,
      null,
      {} as ContextSnapshot,
      { state: undefined } as unknown as ContextSnapshot,
    ];
    for (const snapshot of payloads) {
      const result = contextUsage(snapshot, guardWindow);
      expect(result.tokens).toBeUndefined();
      expect(result.percent).toBeNull();
    }
  });
  it("returns only occupancy keys, never cumulative billing counts", () => {
    const result = contextUsage(
      { state: { ...guardState, token_estimate: 250 } },
      {
        sessionId: "s1",
        contextWindow: 1000,
        inputTokens: 9000,
        totalTokens: 12000,
        sessionCost: 4.5,
      },
    );
    expect(result).toEqual({ tokens: 250, window: 1000, percent: 25 });
    expect(Object.keys(result).sort()).toEqual(["percent", "tokens", "window"]);
  });
  it("clamps a full or over-full window at 100", () => {
    const full = contextUsage(
      { state: { ...guardState, token_estimate: 5000 } },
      guardWindow,
    );
    expect(full.percent).toBe(100);
  });
});

describe("compaction availability derives only from advertised capability", () => {
  const method = "session/compact";
  it("is available only when the server advertises the compact method", () => {
    expect(compactAvailable(capabilities([method]))).toBe(true);
    expect(compactAvailable(capabilities([]))).toBe(false);
    expect(compactAvailable(undefined)).toBe(false);
  });
  it("honours an explicit server 'unsupported' override", () => {
    const gated = capabilities([method], [{ method, reason: "off" }]);
    expect(compactAvailable(gated)).toBe(false);
  });
});
