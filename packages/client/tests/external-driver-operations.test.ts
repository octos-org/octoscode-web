import { describe, expect, it } from "vitest";
import {
  buildDriverOperationsRequest,
  parseDriverOperationsPageResult,
} from "../src/external-driver-operations.ts";
import type {
  DriverOperationsPageRequestInit,
  DriverOperationsCapturedScope,
} from "../src/external-driver-operations.ts";

const TURN = "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d01";
const MASTER_BASE = "dev:local:tui";
const SCOPE: DriverOperationsCapturedScope = Object.freeze({
  profileId: "dev",
  masterSessionId: "dev:local:tui#glm-oup-master-20260908",
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: "op-41",
    kind: "peer_dispatch",
    acceptance: {
      model: "glm-5.3",
      model_lane: "external-master",
      workspace_root: "/ws/root",
      scoped_goal: { goal_id: "g-1", task_id: "t-1", revision: 2 },
      adopted_turn_id: TURN,
      adopted_session_id: `${MASTER_BASE}#peer-glm-worker-1`,
      slug: "glm-worker-1",
      accepted_at_ms: 1_700_000_123_456,
      payload_digest: "a".repeat(64),
    },
    lifecycle: "started",
    created_at_ms: 1_700_000_123_000,
    started_at_ms: 1_700_000_124_000,
    ...overrides,
  };
}

function page(overrides: Record<string, unknown> = {}) {
  return {
    items: [row()],
    snapshot: "snapshot-opaque-1",
    observed_revision: "18446744073709551615",
    complete: true,
    next_cursor: null,
    ...overrides,
  };
}

describe("buildDriverOperationsRequest (page request adapter)", () => {
  it("clamps nothing: limit 0, 101, fractional, negative, or null is invalid", () => {
    for (const limit of [0, 101, 1.5, -1, null, "50", Number.NaN]) {
      expect(() =>
        buildDriverOperationsRequest({
          limit,
        } as DriverOperationsPageRequestInit),
      ).toThrow(/limit_out_of_range/);
    }
  });

  it("rejects empty or >4096-byte cursors", () => {
    expect(() => buildDriverOperationsRequest({ cursor: "" })).toThrow(
      /cursor_empty/,
    );
    expect(() =>
      buildDriverOperationsRequest({ cursor: "x".repeat(4097) }),
    ).toThrow(/cursor_too_large/);
    expect(() =>
      buildDriverOperationsRequest({ cursor: "x".repeat(4096) }),
    ).not.toThrow();
  });
});

describe("parseDriverOperationsPageResult", () => {
  it("enforces complete iff next_cursor null (both directions)", () => {
    expect(
      parseDriverOperationsPageResult(
        page({ complete: false, next_cursor: null }),
        SCOPE,
      ),
    ).toBeNull();
    expect(
      parseDriverOperationsPageResult(
        page({ complete: true, next_cursor: "next" }),
        SCOPE,
      ),
    ).toBeNull();
    expect(
      parseDriverOperationsPageResult(
        page({ complete: false, next_cursor: "next" }),
        SCOPE,
      ),
    ).not.toBeNull();
  });

  it("bounds the page on EXACT RAW snake_case serialization (256KiB)", () => {
    // Tune per-row digest so RAW JSON > 262144 bytes while the camelCase
    // view serialization stays under it — only a raw-serialization bound
    // can reject this page (a view-based bound would wrongly accept).
    const measureRow = (digestLen: number) => {
      const r = row({
        acceptance: {
          ...row().acceptance,
          payload_digest: "d".repeat(digestLen),
        },
      });
      return JSON.stringify(r).length;
    };
    const rowBase = measureRow(0);
    const perRowBudget = Math.floor((262_144 + 700) / 100) - rowBase;
    const overRaw = page({
      items: Array.from({ length: 100 }, () =>
        row({
          acceptance: {
            ...row().acceptance,
            payload_digest: "d".repeat(Math.max(perRowBudget, 1)),
          },
        }),
      ),
    });
    const rawLen = JSON.stringify(overRaw).length;
    expect(rawLen).toBeGreaterThan(256 * 1024);
    expect(parseDriverOperationsPageResult(overRaw, SCOPE)).toBeNull();
    // Control: comfortably under the raw bound still parses.
    const underRaw = page({
      items: Array.from({ length: 100 }, () =>
        row({
          acceptance: {
            ...row().acceptance,
            payload_digest: "d".repeat(Math.max(perRowBudget - 60, 1)),
          },
        }),
      ),
    });
    expect(JSON.stringify(underRaw).length).toBeLessThanOrEqual(256 * 1024);
    expect(parseDriverOperationsPageResult(underRaw, SCOPE)).not.toBeNull();
  });
});

// Deliberate fail-closed design: scope validation must fire even when the
// page carries NO rows — a fence implemented as a row-only loop would accept
// an empty page on a foreign/malformed captured scope (the "syntax hole").
