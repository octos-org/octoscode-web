import { describe, expect, it } from "vitest";
import {
  DRIVER_OPERATIONS_LIMITS,
  buildDriverOperationsRequest,
  parseDriverOperationsPageResult,
} from "../src/external-driver-operations.ts";
import type {
  DriverOperationsPageRequestInit,
  DriverOperationsCapturedScope,
  OperationRecoveryRow,
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

function firstRow(
  parsed: ReturnType<typeof parseDriverOperationsPageResult>,
): OperationRecoveryRow {
  if (parsed === null || parsed.items.length === 0) {
    throw new Error("expected a non-empty parsed page");
  }
  return parsed.items[0] as OperationRecoveryRow;
}

describe("parseDriverOperationsPageResult", () => {
  it("keeps observed_revision a string; rejects number/float/leading-zero/overflow", () => {
    for (const bad of [
      123,
      1.5,
      " 1",
      "",
      "01",
      "+1",
      "18446744073709551616",
      "1e3",
      "-1",
    ]) {
      expect(
        parseDriverOperationsPageResult(
          page({ observed_revision: bad }),
          SCOPE,
        ),
      ).toBeNull();
    }
  });

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

  it("freezes and detaches nested rows/acceptance/scoped_goal", () => {
    const payload = page();
    const parsed = parseDriverOperationsPageResult(payload, SCOPE)!;
    (payload.items as Array<Record<string, unknown>>)[0]!.operation_id =
      "op-MUTATED";
    expect(firstRow(parsed).operationId).toBe("op-41");
    expect(() => {
      (firstRow(parsed) as { operationId?: string }).operationId = "evil";
    }).toThrow();
    expect(() => {
      (firstRow(parsed).acceptance as { slug?: string }).slug = "evil";
    }).toThrow();
    expect(() => {
      (firstRow(parsed).acceptance.scopedGoal as { goalId?: string }).goalId =
        "evil";
    }).toThrow();
  });

  it("exposes no proof/prompt/answer anywhere in a parsed view", () => {
    const parsed = parseDriverOperationsPageResult(page(), SCOPE)!;
    const encoded = JSON.stringify(parsed);
    expect(encoded).not.toContain("prompt");
    expect(encoded).not.toContain("control_token");
    expect(encoded).not.toContain("payload_digest");
  });
});

// Deliberate cross-system pin: these numbers are the Core handler's wire
// ceilings (ui_protocol.rs DRIVER_OPERATIONS_*); a silent drift would let the
// client accept pages the server considers out of contract.
describe("DRIVER_OPERATIONS_LIMITS", () => {
  it("pins Core wire constants", () => {
    expect(DRIVER_OPERATIONS_LIMITS).toEqual({
      defaultLimit: 50,
      minLimit: 1,
      maxLimit: 100,
      maxCursorBytes: 4096,
      maxPageRows: 100,
      maxPageBytes: 256 * 1024,
    });
  });
});

describe("parseDriverOperationsPageResult — captured scope fences", () => {
  it("rejects a valid-native row on a FOREIGN master base (page-level)", () => {
    // Perfectly native identity — but built on another master's base.
    const foreign = page({
      items: [
        row({
          acceptance: {
            ...row().acceptance,
            adopted_session_id: "other:local:tui#peer-glm-worker-1",
          },
        }),
      ],
    });
    expect(parseDriverOperationsPageResult(foreign, SCOPE)).toBeNull();
  });
});

// Deliberate fail-closed design: scope validation must fire even when the
// page carries NO rows — a fence implemented as a row-only loop would accept
// an empty page on a foreign/malformed captured scope (the "syntax hole").
