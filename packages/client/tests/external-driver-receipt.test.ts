import { describe, expect, it } from "vitest";
import {
  checkDispatchRetryIdentity,
  parsePeerDispatchReceipt,
  type DispatchReceiptExpectation,
} from "../src/external-driver.ts";

const PROFILE = "dev";
const TURN_ID = "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d01";
const TUI_MASTER = "dev:local:tui#glm-oup-master-20260908";
const TUI_BASE = "dev:local:tui";

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: "op-41",
    state: "accepted",
    model: "glm-5.3",
    model_lane: "external-master",
    workspace_root: "/ws/root",
    scoped_goal: { goal_id: "op-41", task_id: "op-41", revision: 3 },
    adopted_turn_id: TURN_ID,
    adopted_session_id: `${TUI_BASE}#peer-glm-worker-1`,
    slug: "glm-worker-1",
    duplicate: false,
    accepted_at_ms: 1_700_000_123_456,
    payload_digest: "a".repeat(64),
    ...overrides,
  };
}

function expectation(
  overrides: Record<string, unknown> = {},
): DispatchReceiptExpectation {
  return {
    operationId: "op-41",
    model: "glm-5.3",
    modelLane: "external-master",
    workspaceRoot: "/ws/root",
    profileId: PROFILE,
    scopedGoal: { goalId: "op-41", taskId: "op-41", revision: 3 },
    masterSessionId: TUI_MASTER,
    target: { kind: "new" },
    ...overrides,
  } as unknown as DispatchReceiptExpectation;
}

const TUI_EXPECT = expectation();

describe("parsePeerDispatchReceipt — master wire base alignment", () => {
  it("computes the worker session from captured master base + peer topic", () => {
    const parsed = parsePeerDispatchReceipt(receipt(), TUI_EXPECT);
    expect(parsed?.adoptedSessionId).toBe(`${TUI_BASE}#peer-glm-worker-1`);
    expect(parsed).not.toBeNull();
  });

  it("rejects a same-profile DIFFERENT master base reply", () => {
    expect(
      parsePeerDispatchReceipt(
        receipt({
          adopted_session_id: "dev:local:tui-other#peer-glm-worker-1",
        }),
        TUI_EXPECT,
      ),
    ).toBeNull();
  });
});

describe("parsePeerDispatchReceipt — preserved fences", () => {
  it("requires a real protocol UUID TurnId for first AND duplicate", () => {
    expect(
      parsePeerDispatchReceipt(
        receipt({ adopted_turn_id: "turn-77" }),
        TUI_EXPECT,
      ),
    ).toBeNull();
    expect(
      parsePeerDispatchReceipt(
        receipt({ duplicate: true, adopted_turn_id: "not-a-uuid" }),
        TUI_EXPECT,
      ),
    ).toBeNull();
    expect(
      parsePeerDispatchReceipt(receipt({ duplicate: true }), TUI_EXPECT),
    ).not.toBeNull();
  });
});

describe("checkDispatchRetryIdentity", () => {
  it("flags each changed immutable field with a constant field name", () => {
    const first = parsePeerDispatchReceipt(receipt(), TUI_EXPECT)!;
    const mutations: Array<[string, unknown]> = [
      ["model", "k3"],
      ["modelLane", "other-lane"],
      ["workspaceRoot", "/other/ws"],
      ["adoptedTurnId", "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d02"],
      ["adoptedSessionId", `${TUI_BASE}#peer-other`],
      ["slug", "other"],
      ["acceptedAtMs", 1_700_000_999_999],
      ["payloadDigest", "b".repeat(64)],
      ["scopedGoal", { goalId: "goal-OTHER", taskId: "op-41", revision: 3 }],
    ];
    for (const [field, value] of mutations) {
      const check = checkDispatchRetryIdentity(first, {
        ...first,
        [field]: value,
      });
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.field).toBe(field);
    }
  });
});
