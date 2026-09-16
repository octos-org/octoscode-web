import { describe, expect, it } from "vitest";
import {
  ExternalDriverProtocolError,
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

  it("strips the master topic: peer topic is the ONLY suffix", () => {
    const parsed = parsePeerDispatchReceipt(
      receipt({
        adopted_session_id: `${TUI_BASE}#glm-oup-master-20260908#peer-glm-worker-1`,
      }),
      TUI_EXPECT,
    );
    expect(parsed).toBeNull();
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

  it("rejects a foreign qualified profile base", () => {
    expect(
      parsePeerDispatchReceipt(
        receipt({ adopted_session_id: "other:local:tui#peer-glm-worker-1" }),
        TUI_EXPECT,
      ),
    ).toBeNull();
  });

  it("accepts an ordinary channel/chat base exactly", () => {
    const parsed = parsePeerDispatchReceipt(
      receipt({ adopted_session_id: "dev:telegram:12345#peer-glm-worker-1" }),
      expectation({ masterSessionId: "dev:telegram:12345" }),
    );
    expect(parsed).not.toBeNull();
  });

  it("accepts a dev-QUALIFIED Matrix base with a colon chat id", () => {
    const parsed = parsePeerDispatchReceipt(
      receipt({
        adopted_session_id: "dev:matrix:!room:localhost#peer-glm-worker-1",
      }),
      expectation({ masterSessionId: "dev:matrix:!room:localhost" }),
    );
    expect(parsed).not.toBeNull();
  });

  it("accepts an ordinary local:demo/api:session base (unqualified colon chat)", () => {
    const parsed = parsePeerDispatchReceipt(
      receipt({
        adopted_session_id: "local:demo/api:session#peer-glm-worker-1",
      }),
      expectation({ masterSessionId: "local:demo/api:session" }),
    );
    expect(parsed).not.toBeNull();
  });

  it("accepts an UNQUALIFIED matrix:!room:localhost base", () => {
    const parsed = parsePeerDispatchReceipt(
      receipt({
        adopted_session_id: "matrix:!room:localhost#peer-glm-worker-1",
      }),
      expectation({ masterSessionId: "matrix:!room:localhost" }),
    );
    expect(parsed).not.toBeNull();
  });

  it("accepts a legitimate _main profile base (no leading-alnum restriction)", () => {
    const parsed = parsePeerDispatchReceipt(
      receipt({
        adopted_session_id: "_main:local:tui#peer-glm-worker-1",
      }),
      expectation({
        masterSessionId: "_main:local:tui",
        profileId: "_main",
      }),
    );
    expect(parsed).not.toBeNull();
  });

  it("rejects whitespace/control bytes in the master base (receipt)", () => {
    expect(() =>
      parsePeerDispatchReceipt(
        receipt({ adopted_session_id: "api:bad\n#peer-glm-worker-1" }),
        expectation({ masterSessionId: "api:bad\n" }),
      ),
    ).toThrow(ExternalDriverProtocolError);
    expect(() =>
      parsePeerDispatchReceipt(
        receipt(),
        expectation({ masterSessionId: "dev:local:bad\n" }),
      ),
    ).toThrow(ExternalDriverProtocolError);
    expect(() =>
      parsePeerDispatchReceipt(
        receipt(),
        expectation({ masterSessionId: "dev:local: bad" }),
      ),
    ).toThrow(ExternalDriverProtocolError);
  });

  it("enforces the profile fence on reserved-channel `test` bases (receipt)", () => {
    // other:test:chat is QUALIFIED (test is reserved) → foreign profile.
    expect(
      parsePeerDispatchReceipt(
        receipt({
          adopted_session_id: "other:test:chat#peer-glm-worker-1",
        }),
        expectation({ masterSessionId: "dev:test:chat" }),
      ),
    ).toBeNull();
    expect(() =>
      parsePeerDispatchReceipt(
        receipt(),
        expectation({ masterSessionId: "other:test:chat" }),
      ),
    ).toThrow(ExternalDriverProtocolError);
    // Owned dev:test:chat passes and computes the base exactly.
    const parsed = parsePeerDispatchReceipt(
      receipt({
        adopted_session_id: "dev:test:chat#peer-glm-worker-1",
      }),
      expectation({ masterSessionId: "dev:test:chat" }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.adoptedSessionId).toBe("dev:test:chat#peer-glm-worker-1");
  });

  it("uses the SHARED native identity rule: '#'-bearing slug rejected", () => {
    // Core slug_is_native_safe excludes '#'; the receipt and discovery
    // decoders share ONE helper. A malformed RECEIPT parses to null
    // (only a malformed EXPECTATION throws).
    expect(
      parsePeerDispatchReceipt(
        receipt({
          slug: "evil#slug",
          adopted_session_id: `${TUI_BASE}#peer-evil#slug`,
        }),
        TUI_EXPECT,
      ),
    ).toBeNull();
  });

  it("rejects a NONMATCHING foreign qualified profile", () => {
    expect(
      parsePeerDispatchReceipt(
        receipt({
          adopted_session_id: "other:local:tui#peer-glm-worker-1",
        }),
        expectation({ masterSessionId: "dev:local:tui" }),
      ),
    ).toBeNull();
  });

  it("accepts an opaque web-N master byte-exactly with no manufactured prefix", () => {
    const parsed = parsePeerDispatchReceipt(
      receipt({ adopted_session_id: "web-4#peer-glm-worker-1" }),
      expectation({ masterSessionId: "web-4" }),
    );
    expect(parsed).not.toBeNull();
  });

  it("requires the mandatory captured masterSessionId (missing/malformed)", () => {
    const missing = { ...TUI_EXPECT };
    delete (missing as { masterSessionId?: string }).masterSessionId;
    expect(() => parsePeerDispatchReceipt(receipt(), missing)).toThrow(
      ExternalDriverProtocolError,
    );
    expect(() =>
      parsePeerDispatchReceipt(receipt(), {
        ...TUI_EXPECT,
        masterSessionId: "",
      }),
    ).toThrow(ExternalDriverProtocolError);
  });

  it("rejects an overlong slug (65 bytes) per native 64-byte cap", () => {
    expect(
      parsePeerDispatchReceipt(
        receipt({
          slug: "a".repeat(65),
          adopted_session_id: `${TUI_BASE}#peer-${"a".repeat(65)}`,
        }),
        TUI_EXPECT,
      ),
    ).toBeNull();
  });

  it("accepts a genuine legacy escaped slug (CJK FNV fallback shape)", () => {
    const slug = `peer-${"f".repeat(16)}`;
    const parsed = parsePeerDispatchReceipt(
      receipt({
        slug,
        adopted_session_id: `${TUI_BASE}#peer-${slug}`,
      }),
      TUI_EXPECT,
    );
    expect(parsed).not.toBeNull();
  });

  it("keeps an existing peer target on the same captured master base", () => {
    const parsed = parsePeerDispatchReceipt(
      receipt(),
      expectation({
        target: {
          kind: "existing",
          slug: "glm-worker-1",
          sessionId: `${TUI_BASE}#peer-glm-worker-1`,
        },
      }),
    );
    expect(parsed).not.toBeNull();
  });

  it("rejects an existing target on a DIFFERENT master base (expectation throws)", () => {
    expect(() =>
      parsePeerDispatchReceipt(
        receipt(),
        expectation({
          target: {
            kind: "existing",
            slug: "glm-worker-1",
            sessionId: `dev:local:tui-other#peer-glm-worker-1`,
          },
        }),
      ),
    ).toThrow(ExternalDriverProtocolError);
  });
});

describe("parsePeerDispatchReceipt — preserved fences", () => {
  it("rejects stale lifecycle states (immutable acceptance)", () => {
    for (const state of [
      "admitted",
      "started",
      "terminal",
      "recovery_required",
      "",
      1,
      undefined,
      null,
    ]) {
      expect(
        parsePeerDispatchReceipt(receipt({ state }), TUI_EXPECT),
      ).toBeNull();
    }
  });

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

  it("rejects unsafe integers and malformed scoped goals", () => {
    for (const acceptedAt of ["1700000123456", 1.5, 2 ** 64, -1, Number.NaN]) {
      expect(
        parsePeerDispatchReceipt(
          receipt({ accepted_at_ms: acceptedAt }),
          TUI_EXPECT,
        ),
      ).toBeNull();
    }
    expect(
      parsePeerDispatchReceipt(
        receipt({
          scoped_goal: { goal_id: "", task_id: "op-41", revision: 3 },
        }),
        TUI_EXPECT,
      ),
    ).toBeNull();
  });

  it("distinguishes unknown vs explicit-absent scoped goal", () => {
    const { scopedGoal: _drop, ...unknownGoal } = TUI_EXPECT;
    expect(
      parsePeerDispatchReceipt(
        receipt({ scoped_goal: undefined }),
        unknownGoal,
      ),
    ).not.toBeNull();
    const parsed = parsePeerDispatchReceipt(
      receipt({ scoped_goal: undefined }),
      { ...TUI_EXPECT, scopedGoal: null },
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.scopedGoal).toBeNull();
    expect(
      parsePeerDispatchReceipt(receipt(), { ...TUI_EXPECT, scopedGoal: null }),
    ).toBeNull();
  });

  it("confirms request-derived operation/model/lane/workspace fences", () => {
    expect(
      parsePeerDispatchReceipt(
        receipt({ operation_id: "op-OTHER" }),
        TUI_EXPECT,
      ),
    ).toBeNull();
    expect(
      parsePeerDispatchReceipt(receipt({ model: "k3" }), TUI_EXPECT),
    ).toBeNull();
    expect(
      parsePeerDispatchReceipt(
        receipt({ model_lane: "other-lane" }),
        TUI_EXPECT,
      ),
    ).toBeNull();
    expect(
      parsePeerDispatchReceipt(
        receipt({ workspace_root: "/other/ws" }),
        TUI_EXPECT,
      ),
    ).toBeNull();
  });

  it("rejects non-object payloads and freezes the parsed view", () => {
    expect(parsePeerDispatchReceipt(null, TUI_EXPECT)).toBeNull();
    expect(parsePeerDispatchReceipt("accepted", TUI_EXPECT)).toBeNull();
    const frozen = parsePeerDispatchReceipt(receipt(), TUI_EXPECT)!;
    expect(() => {
      (frozen as { slug?: string }).slug = "evil";
    }).toThrow();
  });
});

describe("checkDispatchRetryIdentity", () => {
  it("accepts an equal retry that changes ONLY duplicate", () => {
    const first = parsePeerDispatchReceipt(receipt(), TUI_EXPECT)!;
    const retry = parsePeerDispatchReceipt(
      receipt({ duplicate: true }),
      TUI_EXPECT,
    )!;
    expect(checkDispatchRetryIdentity(first, retry)).toEqual({ ok: true });
  });

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

  it("returns constant diagnostics without echoing conflicting values", () => {
    const first = parsePeerDispatchReceipt(receipt(), TUI_EXPECT)!;
    const check = checkDispatchRetryIdentity(first, {
      ...first,
      slug: "canary",
    });
    expect(JSON.stringify(check)).not.toContain("canary");
  });
});
