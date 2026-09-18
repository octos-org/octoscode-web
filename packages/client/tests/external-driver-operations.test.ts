import { describe, expect, it } from "vitest";
import {
  DRIVER_OPERATIONS_LIMITS,
  buildDriverOperationsRequest,
  classifyDriverGetOperationsResult,
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
const CANARY = "tok-CANARY-7f";

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
  it("omits operations entirely when init is omitted", () => {
    expect(buildDriverOperationsRequest()).toBeUndefined();
  });

  it("emits an empty object (default limit 50, no cursor) for {}", () => {
    const built = buildDriverOperationsRequest({})!;
    expect(built.wire).toEqual({});
    expect(built.effectiveLimit).toBe(50);
  });

  it("carries explicit cursor and integral limit with effectiveLimit", () => {
    const built = buildDriverOperationsRequest({
      cursor: "c-1",
      limit: 100,
    })!;
    expect(built.wire).toEqual({ cursor: "c-1", limit: 100 });
    expect(built.effectiveLimit).toBe(100);
  });

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

  it("rejects a non-record operations request (array/string/null)", () => {
    for (const bad of [[{ cursor: "x" }], ["cursor"], "cursor", 7, true]) {
      expect(() => buildDriverOperationsRequest(bad as never)).toThrow(
        /malformed/,
      );
    }
    expect(() => buildDriverOperationsRequest(null as never)).toThrow(
      /malformed/,
    );
  });

  it("rejects unknown request fields (deny_unknown)", () => {
    expect(() =>
      buildDriverOperationsRequest({
        extra: 1,
      } as unknown as DriverOperationsPageRequestInit),
    ).toThrow(/unknown_field/);
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
  it("parses a full canonical page with max u64 revision as STRING", () => {
    const parsed = parseDriverOperationsPageResult(page(), SCOPE);
    expect(parsed).not.toBeNull();
    expect(parsed!.observedRevision).toBe("18446744073709551615");
    expect(firstRow(parsed).acceptance.slug).toBe("glm-worker-1");
    expect(parsed!.complete).toBe(true);
    expect(parsed!.nextCursor).toBeNull();
  });

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

  it("rejects operations: null and missing next_cursor when operations supplied", () => {
    // explicit null result operations is malformed, never an empty page
    expect(
      parseDriverOperationsPageResult({ operations: null }, SCOPE),
    ).toBeNull();
    // missing required next_cursor inside a supplied operations object
    const missingCursor = page();
    delete (missingCursor as Record<string, unknown>).next_cursor;
    expect(parseDriverOperationsPageResult(missingCursor, SCOPE)).toBeNull();
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

  it("rejects empty/oversized next_cursor and non-string snapshot", () => {
    expect(
      parseDriverOperationsPageResult(
        page({ complete: false, next_cursor: "" }),
        SCOPE,
      ),
    ).toBeNull();
    expect(
      parseDriverOperationsPageResult(
        page({ complete: false, next_cursor: "y".repeat(4097) }),
        SCOPE,
      ),
    ).toBeNull();
    expect(
      parseDriverOperationsPageResult(page({ snapshot: "" }), SCOPE),
    ).toBeNull();
    expect(
      parseDriverOperationsPageResult(page({ snapshot: 7 }), SCOPE),
    ).toBeNull();
  });

  it("accepts all five lifecycle states and peer_dispatch kind only", () => {
    for (const lifecycle of [
      "accepted",
      "admitted",
      "started",
      "terminal",
      "recovery_required",
    ]) {
      const parsed = parseDriverOperationsPageResult(
        page({ items: [row({ lifecycle })] }),
        SCOPE,
      );
      expect(firstRow(parsed).lifecycle).toBe(lifecycle);
    }
    expect(
      parseDriverOperationsPageResult(
        page({ items: [row({ kind: "wake" })] }),
        SCOPE,
      ),
    ).toBeNull();
    expect(
      parseDriverOperationsPageResult(
        page({ items: [row({ kind: null })] }),
        SCOPE,
      ),
    ).toBeNull();
  });

  it("validates native identity: UUID, base#peer-<slug>, single topic", () => {
    expect(
      parseDriverOperationsPageResult(
        page({
          items: [
            row({
              acceptance: {
                ...row().acceptance,
                adopted_turn_id: "turn-77",
              },
            }),
          ],
        }),
        SCOPE,
      ),
    ).toBeNull();
    expect(
      parseDriverOperationsPageResult(
        page({
          items: [
            row({
              acceptance: {
                ...row().acceptance,
                adopted_session_id: `${MASTER_BASE}#glm-worker-1`,
              },
            }),
          ],
        }),
        SCOPE,
      ),
    ).toBeNull();
    expect(
      parseDriverOperationsPageResult(
        page({
          items: [
            row({
              acceptance: {
                ...row().acceptance,
                adopted_session_id: `${MASTER_BASE}#peer-glm-worker-1#x`,
              },
            }),
          ],
        }),
        SCOPE,
      ),
    ).toBeNull();
    expect(
      parseDriverOperationsPageResult(
        page({
          items: [
            row({
              acceptance: {
                ...row().acceptance,
                slug: "bad\nslug",
              },
            }),
          ],
        }),
        SCOPE,
      ),
    ).toBeNull();
  });

  it("rejects unknown row/acceptance fields (deny_unknown) without echo", () => {
    const withPrompt = row({ prompt: "secret" });
    expect(
      parseDriverOperationsPageResult(page({ items: [withPrompt] }), SCOPE),
    ).toBeNull();
    const withControl = row({
      acceptance: { ...row().acceptance, control_token: CANARY },
    });
    expect(
      parseDriverOperationsPageResult(page({ items: [withControl] }), SCOPE),
    ).toBeNull();
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

  it("rejects absurd digit runs before any BigInt allocation", () => {
    expect(
      parseDriverOperationsPageResult(
        page({ observed_revision: "9".repeat(64) }),
        SCOPE,
      ),
    ).toBeNull();
    expect(
      parseDriverOperationsPageResult(
        page({ observed_revision: "9".repeat(4000) }),
        SCOPE,
      ),
    ).toBeNull();
  });

  it("rejects whole page over 100 rows or 256KiB serialized", () => {
    const many = page({ items: Array.from({ length: 101 }, () => row()) });
    expect(parseDriverOperationsPageResult(many, SCOPE)).toBeNull();
    const big = page({
      items: [
        row({
          acceptance: {
            ...row().acceptance,
            payload_digest: "d".repeat(300_000),
          },
        }),
      ],
    });
    expect(parseDriverOperationsPageResult(big, SCOPE)).toBeNull();
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

  it("accepts opaque web-N and ordinary channel:chat worker bases (each under its own captured scope)", () => {
    for (const base of [
      "web-4",
      "local:demo/api:session",
      "dev:matrix:!room:localhost",
    ]) {
      const baseScope: DriverOperationsCapturedScope = {
        profileId: "dev",
        masterSessionId: base,
      };
      const parsed = parseDriverOperationsPageResult(
        page({
          items: [
            row({
              acceptance: {
                ...row().acceptance,
                adopted_session_id: `${base}#peer-glm-worker-1`,
              },
            }),
          ],
        }),
        baseScope,
      );
      expect(parsed).not.toBeNull();
      // The same row under the OTHER captured master base is rejected —
      // the fence is scope-derived, not shape-only.
      expect(
        parseDriverOperationsPageResult(
          page({
            items: [
              row({
                acceptance: {
                  ...row().acceptance,
                  adopted_session_id: `${base}#peer-glm-worker-1`,
                },
              }),
            ],
          }),
          SCOPE,
        ),
      ).toBeNull();
    }
  });

  it("exposes no proof/prompt/answer anywhere in a parsed view", () => {
    const parsed = parseDriverOperationsPageResult(page(), SCOPE)!;
    const encoded = JSON.stringify(parsed);
    expect(encoded).not.toContain("prompt");
    expect(encoded).not.toContain("control_token");
    expect(encoded).not.toContain("payload_digest");
  });
});

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

describe("classifyDriverGetOperationsResult (typed requested-page boundary)", () => {
  it("not requested + absent -> omitted", () => {
    expect(
      classifyDriverGetOperationsResult({ mode: "internal" }, false, SCOPE),
    ).toEqual({
      kind: "omitted",
    });
  });

  it("requested + absent -> typed UNSUPPORTED, never empty inventory", () => {
    expect(
      classifyDriverGetOperationsResult({ mode: "internal" }, true, SCOPE),
    ).toEqual({ kind: "unsupported" });
  });

  it("requested + well-formed page -> page", () => {
    const outcome = classifyDriverGetOperationsResult(
      { operations: page() },
      true,
      SCOPE,
    );
    expect(outcome?.kind).toBe("page");
  });

  it("requested + operations null / malformed / bad row -> malformed", () => {
    expect(
      classifyDriverGetOperationsResult({ operations: null }, true, SCOPE),
    ).toEqual({ kind: "malformed" });
    const missingCursor = page();
    delete (missingCursor as Record<string, unknown>).next_cursor;
    expect(
      classifyDriverGetOperationsResult(
        { operations: missingCursor },
        true,
        SCOPE,
      ),
    ).toEqual({ kind: "malformed" });
    expect(
      classifyDriverGetOperationsResult(
        { operations: page({ items: [row({ kind: "wake" })] }) },
        true,
        SCOPE,
      ),
    ).toEqual({ kind: "malformed" });
  });

  it("not requested but a page is present -> page (server chose to send)", () => {
    const outcome = classifyDriverGetOperationsResult(
      { operations: page() },
      false,
      SCOPE,
    );
    expect(outcome?.kind).toBe("page");
  });

  it("non-record result -> malformed", () => {
    expect(classifyDriverGetOperationsResult(null, true, SCOPE)).toEqual({
      kind: "malformed",
    });
    expect(classifyDriverGetOperationsResult(42, false, SCOPE)).toEqual({
      kind: "malformed",
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

  it("rejects a same-profile DIFFERENT master base (page-level)", () => {
    const wrongBase = page({
      items: [
        row({
          acceptance: {
            ...row().acceptance,
            adopted_session_id: "dev:local:tui-other#peer-glm-worker-1",
          },
        }),
      ],
    });
    expect(parseDriverOperationsPageResult(wrongBase, SCOPE)).toBeNull();
  });

  it("rejects a foreign QUALIFIED profile on the captured profileId", () => {
    const wrongProfile = page({
      items: [
        row({
          acceptance: {
            ...row().acceptance,
            adopted_session_id: "k3:local:tui#peer-glm-worker-1",
          },
        }),
      ],
    });
    expect(parseDriverOperationsPageResult(wrongProfile, SCOPE)).toBeNull();
  });

  it("accepts the byte-exact captured master base", () => {
    expect(parseDriverOperationsPageResult(page(), SCOPE)).not.toBeNull();
  });

  it("requires the captured scope: undefined/missing/malformed scope", () => {
    expect(() =>
      parseDriverOperationsPageResult(page(), undefined as never),
    ).toThrow(/malformed|scope/);
    const noProfile = { ...SCOPE };
    delete (noProfile as { profileId?: string }).profileId;
    expect(() =>
      parseDriverOperationsPageResult(page(), noProfile as never),
    ).toThrow(/malformed|scope/);
    expect(() =>
      parseDriverOperationsPageResult(page(), null as never),
    ).toThrow(/malformed|scope/);
  });

  it("classify also enforces the captured scope on rows", () => {
    const foreign = {
      operations: page({
        items: [
          row({
            acceptance: {
              ...row().acceptance,
              adopted_session_id: "other:local:tui#peer-glm-worker-1",
            },
          }),
        ],
      }),
    };
    expect(classifyDriverGetOperationsResult(foreign, true, SCOPE)).toEqual({
      kind: "malformed",
    });
  });

  it("bounds the raw page at EXACTLY 262144 UTF-8 bytes (+1 byte rejected)", () => {
    const encoder = new TextEncoder();
    const rawBytes = (candidate: unknown): number =>
      encoder.encode(JSON.stringify(candidate)).length;

    // ONE adjustable string (a single row's digest): every ASCII char is
    // exactly 1 UTF-8 byte, so +1 digest char === +1 raw byte — the exact
    // boundary is directly reachable, never a closest-under fallback.
    const buildAscii = (digestLen: number) =>
      page({
        items: [
          row({
            acceptance: {
              ...row().acceptance,
              payload_digest: "d".repeat(digestLen),
            },
          }),
        ],
      });
    const probeBytes = rawBytes(buildAscii(1000));
    const exactDigest = 1000 + (262_144 - probeBytes);
    const atLimit = buildAscii(exactDigest);
    expect(rawBytes(atLimit)).toBe(262_144); // EXACT
    expect(parseDriverOperationsPageResult(atLimit, SCOPE)).not.toBeNull();

    const overLimit = buildAscii(exactDigest + 1);
    expect(rawBytes(overLimit)).toBe(262_145); // EXACT +1
    expect(parseDriverOperationsPageResult(overLimit, SCOPE)).toBeNull();
  });

  it("measures UTF-8 BYTES not chars: multi-byte content at the same exact cap", () => {
    const encoder = new TextEncoder();
    const rawBytes = (candidate: unknown): number =>
      encoder.encode(JSON.stringify(candidate)).length;
    const EURO = "\u20ac"; // 3 UTF-8 bytes, 1 UTF-16 code unit

    const build = (asciiLen: number, euros: number) =>
      page({
        items: [
          row({
            acceptance: {
              ...row().acceptance,
              payload_digest: "d".repeat(asciiLen) + EURO.repeat(euros),
            },
          }),
        ],
      });

    // Calibrate pure ASCII to exactly the cap.
    const probeBytes = rawBytes(build(1000, 0));
    const asciiExact = 1000 + (262_144 - probeBytes);
    expect(rawBytes(build(asciiExact, 0))).toBe(262_144);

    // Swap 3 ASCII bytes for one 3-byte euro: BYTE length unchanged while
    // the JSON char length shrinks — proves the cap counts UTF-8 bytes.
    const multi = build(asciiExact - 3, 1);
    expect(JSON.stringify(multi).length).toBe(
      JSON.stringify(build(asciiExact, 0)).length - 2,
    );
    expect(rawBytes(multi)).toBe(262_144);
    expect(parseDriverOperationsPageResult(multi, SCOPE)).not.toBeNull();

    // +1 ASCII byte on the multi-byte page === 262145 raw bytes → reject.
    const multiOver = build(asciiExact - 2, 1);
    expect(rawBytes(multiOver)).toBe(262_145);
    expect(parseDriverOperationsPageResult(multiOver, SCOPE)).toBeNull();
  });

  it("rejects cyclic payloads and never crashes on JSON.stringify", () => {
    const cyclic: Record<string, unknown> = { items: [] };
    cyclic.self = cyclic;
    const cycPage = { operations: { ...page(), items: [cyclic] } };
    expect(() => JSON.stringify(cycPage)).toThrow(); // precondition
    expect(
      parseDriverOperationsPageResult(cycPage.operations, SCOPE),
    ).toBeNull();
    const cycRow: Record<string, unknown> = row();
    cycRow.self = cycRow;
    expect(
      parseDriverOperationsPageResult(
        page({ items: [cycRow as never] }),
        SCOPE,
      ),
    ).toBeNull();
  });
});

describe("captured-scope validation covers EMPTY and OMITTED pages", () => {
  const EMPTY = page({ items: [] });
  const baseOf = (master: string) => master.split("#")[0];

  it("throws on a foreign qualified master even with EMPTY items (parse + classify)", () => {
    const foreign = {
      profileId: "dev",
      masterSessionId: "other:local:tui",
    } as DriverOperationsCapturedScope;
    expect(() => parseDriverOperationsPageResult(EMPTY, foreign)).toThrow();
    expect(() =>
      classifyDriverGetOperationsResult({ operations: EMPTY }, true, foreign),
    ).toThrow();
  });

  it("throws on a malformed master base even with EMPTY items", () => {
    for (const masterSessionId of [
      "dev:local: bad",
      "dev:local:tui#bad#topic",
      "de\tv:local:tui",
      "",
      "dev:local:tui\u0007",
    ]) {
      const badScope = {
        profileId: "dev",
        masterSessionId,
      } as DriverOperationsCapturedScope;
      expect(() => parseDriverOperationsPageResult(EMPTY, badScope)).toThrow();
      expect(() =>
        classifyDriverGetOperationsResult(
          { operations: EMPTY },
          true,
          badScope,
        ),
      ).toThrow();
    }
  });

  it("throws on invalid profileId even with a BARE web master (syntax hole)", () => {
    for (const profileId of ["de v", "", "dev:x", "dev#1"]) {
      const badScope = {
        profileId,
        masterSessionId: "web-4",
      } as DriverOperationsCapturedScope;
      expect(() => parseDriverOperationsPageResult(EMPTY, badScope)).toThrow();
      // omitted operations response validates the scope too
      expect(() =>
        classifyDriverGetOperationsResult({ mode: "internal" }, true, badScope),
      ).toThrow();
    }
  });

  it("valid bare web / Matrix / ordinary-channel / qualified scopes accept EMPTY and nonempty pages", () => {
    for (const masterSessionId of [
      "web-4",
      "dev:matrix:!room:localhost",
      "local:demo/api:session",
      "dev:local:tui#glm-oup-master-20260908",
    ]) {
      const validScope: DriverOperationsCapturedScope = {
        profileId: "dev",
        masterSessionId,
      };
      const emptyParsed = parseDriverOperationsPageResult(EMPTY, validScope);
      expect(emptyParsed).not.toBeNull();
      expect(emptyParsed!.items.length).toBe(0);
      const outcome = classifyDriverGetOperationsResult(
        { operations: EMPTY },
        true,
        validScope,
      );
      expect(outcome?.kind).toBe("page");
      // nonempty page on the same captured base
      const nonempty = page({
        items: [
          row({
            acceptance: {
              ...row().acceptance,
              adopted_session_id: `${baseOf(masterSessionId)}#peer-glm-worker-1`,
            },
          }),
        ],
      });
      expect(
        parseDriverOperationsPageResult(nonempty, validScope),
      ).not.toBeNull();
    }
  });

  it("omitted operations + valid scope still classifies unsupported", () => {
    expect(
      classifyDriverGetOperationsResult({ mode: "internal" }, true, SCOPE),
    ).toEqual({ kind: "unsupported" });
  });
});
