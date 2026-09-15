import { describe, expect, it } from "vitest";
import {
  ExternalDriverCapabilityError,
  ExternalDriverProtocolError,
  ExternalDriverRefusalError,
} from "../src/external-driver.ts";
import type { ExternalDriverControlContext } from "../src/external-driver.ts";
import { createExternalDriverPeerCommands } from "../src/external-driver-peer-control.ts";

/**
 * 2030 regression suite for the 2019 peer leaf. Five defects fixed:
 *  1. post-await decode read caller-MUTABLE args (in-flight retarget);
 *  2. `peer/control` receipt lacked the captured master/profile fence, so a
 *     valid-shape FOREIGN base `#peer-<same-slug>` reply was accepted;
 *  3. no cross-variant key rejection on `PeerControlCommand`
 *     (`deny_unknown_fields`) or on the tagged dispatch target;
 *  4. optional Rust `Option<String>` fields were wrongly refused when EMPTY;
 *  5. `validateFence` always threw a PEER_DISPATCH diagnostic.
 * 63 original control tests stay UNCHANGED; this file is additive.
 */

const PROOF = "proof-synthetic-fixture";
const TURN = "3f1c9d2a-4b6e-4c1a-9f2d-7a5e8b0c1d2e";
/** Captured master session; its wire base is `dev:local:tui`. */
const MASTER = "dev:local:tui#peer-abc";
const PROFILE = "dev";
/** Native worker session for slug `abc` = captured base + `#peer-abc`. */
const WORKER = "dev:local:tui#peer-abc";
/** Valid-shape session from a DIFFERENT master base, same slug. */
const FOREIGN_WORKER = "other:local:tui#peer-abc";

interface LooseCommands {
  peerDispatch(args: unknown): Promise<unknown>;
  peerControl(args: unknown): Promise<unknown>;
}

const DISPATCH_REPLY = {
  operation_id: "op-dispatch-1",
  state: "accepted",
  model: "deepseek-chat",
  model_lane: "deepseek-chat",
  workspace_root: "/ws/peer-abc",
  adopted_turn_id: TURN,
  adopted_session_id: WORKER,
  slug: "abc",
  duplicate: false,
  accepted_at_ms: 1_700_000_000_000,
  payload_digest: "sha256:deadbeef",
};

const CONTROL_REPLY = {
  operation_id: "op-control-1",
  state: "accepted",
  target_operation_id: "op-dispatch-1",
  expected_turn_id: TURN,
  target_session_id: WORKER,
  slug: "abc",
  accepted_at_ms: 1_700_000_000_500,
  payload_digest: "sha256:cafef00d",
  duplicate: false,
};

const FENCE = { driverId: "driver-b", epoch: 8, controlToken: PROOF };

const DISPATCH_PARAMS = {
  ...FENCE,
  operationId: "op-dispatch-1",
  model: "deepseek-chat",
  dispatch: { kind: "new_brief", brief: "do the thing" },
};

const CONTROL_PARAMS = {
  ...FENCE,
  operationId: "op-control-1",
  targetOperationId: "op-dispatch-1",
  expectedTurnId: TURN,
  command: { kind: "steer", input: [{ kind: "text", text: "keep going" }] },
};

function leafContext(
  reply: () => unknown = () => structuredClone(DISPATCH_REPLY),
): {
  calls: Array<{ method: string; params: Record<string, unknown> }>;
  commands: LooseCommands;
} {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const context = {
    rpc: {
      request: async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        return reply();
      },
    },
    sessionId: MASTER,
    profileId: PROFILE,
    topic: "peer-abc",
    supportedMethods: new Set<string>(["peer/dispatch", "peer/control"]),
    featureAdvertised: true,
  } as unknown as ExternalDriverControlContext;
  return {
    calls,
    commands: createExternalDriverPeerCommands(
      context,
    ) as unknown as LooseCommands,
  };
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

describe("capability gate stays first (offline, zero RPC)", () => {
  it("refuses when the feature is not advertised", async () => {
    const calls: unknown[] = [];
    const context = {
      rpc: {
        request: async () => {
          calls.push(1);
          return {};
        },
      },
      sessionId: MASTER,
      profileId: PROFILE,
      supportedMethods: new Set<string>(["peer/dispatch", "peer/control"]),
      featureAdvertised: false,
    } as unknown as ExternalDriverControlContext;
    const commands = createExternalDriverPeerCommands(
      context,
    ) as unknown as LooseCommands;
    await expect(commands.peerControl(CONTROL_PARAMS)).rejects.toBeInstanceOf(
      ExternalDriverCapabilityError,
    );
    expect(calls).toEqual([]);
  });
});

describe("post-send caller mutation cannot retarget the decode fence", () => {
  it("dispatch: a reply matching the ORIGINAL request still passes, and the sent wire is unchanged", async () => {
    const args: Record<string, unknown> = { ...DISPATCH_PARAMS };
    const { calls, commands } = leafContext(() => {
      // Mutate the caller's object AFTER the wire was captured.
      args.operationId = "op-foreign";
      args.model = "gpt-x";
      return structuredClone(DISPATCH_REPLY);
    });
    const result = (await commands.peerDispatch(args)) as {
      operationId: string;
    };
    expect(result.operationId).toBe("op-dispatch-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toMatchObject({
      operation_id: "op-dispatch-1",
      model: "deepseek-chat",
    });
  });

  it("dispatch: a reply matching the MUTATED foreign operation/model is refused", async () => {
    const args: Record<string, unknown> = { ...DISPATCH_PARAMS };
    const { commands } = leafContext(() => {
      args.operationId = "op-foreign";
      args.model = "gpt-x";
      return structuredClone({
        ...DISPATCH_REPLY,
        operation_id: "op-foreign",
        model: "gpt-x",
      });
    });
    await expect(commands.peerDispatch(args)).rejects.toBeInstanceOf(
      ExternalDriverProtocolError,
    );
  });

  it("control: a reply matching the ORIGINAL target/turn passes; the mutated foreign one is refused", async () => {
    const args: Record<string, unknown> = { ...CONTROL_PARAMS };
    const original = leafContext(() => {
      args.targetOperationId = "op-foreign";
      args.expectedTurnId = "00000000-0000-4000-8000-000000000000";
      return structuredClone(CONTROL_REPLY);
    });
    await expect(original.commands.peerControl(args)).resolves.toMatchObject({
      operationId: "op-control-1",
    });

    const mutated: Record<string, unknown> = { ...CONTROL_PARAMS };
    const foreign = leafContext(() => {
      mutated.targetOperationId = "op-foreign";
      return structuredClone({
        ...CONTROL_REPLY,
        target_operation_id: "op-foreign",
      });
    });
    await expect(foreign.commands.peerControl(mutated)).rejects.toBeInstanceOf(
      ExternalDriverProtocolError,
    );
  });
});

describe("control receipt is fenced to the CAPTURED master/profile scope", () => {
  it("accepts a receipt whose target session is the captured worker", async () => {
    const { commands } = leafContext(() => structuredClone(CONTROL_REPLY));
    await expect(commands.peerControl(CONTROL_PARAMS)).resolves.toMatchObject({
      targetSessionId: WORKER,
      slug: "abc",
    });
  });

  it("refuses a valid-SHAPE foreign-master receipt (same slug, other base)", async () => {
    const { calls, commands } = leafContext(() =>
      structuredClone({ ...CONTROL_REPLY, target_session_id: FOREIGN_WORKER }),
    );
    await expect(commands.peerControl(CONTROL_PARAMS)).rejects.toBeInstanceOf(
      ExternalDriverProtocolError,
    );
    // The RPC WAS sent; the rejection came from the decode fence.
    expect(calls).toHaveLength(1);
  });
});

describe("control command variants + cross-variant rejection", () => {
  it("encodes ordered answers and multiple steer inputs (all four variants)", async () => {
    const cases: Array<{ command: unknown; expect: Record<string, unknown> }> =
      [
        {
          command: {
            kind: "approval_respond",
            approvalId: "ap-1",
            decision: "approve",
          },
          expect: {
            kind: "approval_respond",
            approval_id: "ap-1",
            decision: "approve",
          },
        },
        {
          command: {
            kind: "question_respond",
            questionId: "q-1",
            answers: [{ selectedLabels: ["b", "a"] }, { freeText: "typed" }],
          },
          expect: {
            kind: "question_respond",
            answers: [{ selected_labels: ["b", "a"] }, { free_text: "typed" }],
          },
        },
        {
          command: {
            kind: "steer",
            input: [
              { kind: "text", text: "one" },
              { kind: "text", text: "two" },
            ],
          },
          expect: {
            kind: "steer",
            input: [
              { kind: "text", text: "one" },
              { kind: "text", text: "two" },
            ],
          },
        },
        { command: { kind: "interrupt" }, expect: { kind: "interrupt" } },
      ];
    for (const testCase of cases) {
      const { calls, commands } = leafContext(() =>
        structuredClone(CONTROL_REPLY),
      );
      await commands.peerControl({
        ...CONTROL_PARAMS,
        command: testCase.command,
      });
      expect(calls[0]?.params.command).toMatchObject(testCase.expect);
    }
  });

  it("accepts native OPTIONAL empty strings (no invented non-blank rule)", async () => {
    const { calls, commands } = leafContext(() =>
      structuredClone(CONTROL_REPLY),
    );
    await commands.peerControl({
      ...CONTROL_PARAMS,
      command: {
        kind: "approval_respond",
        approvalId: "ap-1",
        decision: "deny",
        approvalScope: "",
        clientNote: "",
      },
    });
    expect(calls[0]?.params.command).toMatchObject({
      approval_scope: "",
      client_note: "",
    });
  });

  it("reads only the known UserQuestionAnswer fields (unknown siblings tolerated)", async () => {
    const { calls, commands } = leafContext(() =>
      structuredClone(CONTROL_REPLY),
    );
    await commands.peerControl({
      ...CONTROL_PARAMS,
      command: {
        kind: "question_respond",
        questionId: "q-1",
        answers: [{ selectedLabels: ["a"], ignoredSibling: 7 }],
      },
    });
    expect(calls[0]?.params.command).toMatchObject({
      answers: [{ selected_labels: ["a"] }],
    });
    const sentCommand = calls[0]?.params.command;
    expect(sentCommand).toBeDefined();
    const sentAnswers = (sentCommand as { answers: unknown[] }).answers;
    expect(sentAnswers[0]).not.toHaveProperty("ignoredSibling");
  });

  it("rejects cross-variant command fields OFFLINE (zero RPC)", async () => {
    const bad = [
      {
        kind: "steer",
        input: [{ kind: "text", text: "x" }],
        approvalId: "ap-1",
      },
      { kind: "interrupt", input: [{ kind: "text", text: "x" }] },
      {
        kind: "approval_respond",
        approvalId: "ap-1",
        decision: "approve",
        answers: [],
      },
    ];
    for (const command of bad) {
      const { calls, commands } = leafContext(() =>
        structuredClone(CONTROL_REPLY),
      );
      await expect(
        commands.peerControl({ ...CONTROL_PARAMS, command }),
      ).rejects.toBeInstanceOf(ExternalDriverProtocolError);
      expect(calls).toEqual([]);
    }
  });
});

describe("dispatch target ambiguity is rejected OFFLINE (zero RPC)", () => {
  it("rejects new_brief+slug and existing_slug+brief|title|worktree", async () => {
    const bad = [
      { kind: "new_brief", brief: "b", slug: "abc" },
      { kind: "existing_slug", slug: "abc", brief: "b" },
      { kind: "existing_slug", slug: "abc", title: "t" },
      { kind: "existing_slug", slug: "abc", worktree: true },
    ];
    for (const dispatch of bad) {
      const { calls, commands } = leafContext(() =>
        structuredClone(DISPATCH_REPLY),
      );
      await expect(
        commands.peerDispatch({
          ...DISPATCH_PARAMS,
          dispatch,
          kickoffInput: [{ kind: "text", text: "go" }],
        }),
      ).rejects.toBeInstanceOf(ExternalDriverProtocolError);
      expect(calls).toEqual([]);
    }
  });

  it("accepts an empty optional title on new_brief", async () => {
    const { calls, commands } = leafContext(() =>
      structuredClone(DISPATCH_REPLY),
    );
    await commands.peerDispatch({
      ...DISPATCH_PARAMS,
      dispatch: { kind: "new_brief", brief: "b", title: "" },
    });
    expect(calls[0]?.params.dispatch).toMatchObject({ title: "" });
  });
});

describe("fence diagnostics name the ACTUAL method and leak nothing", () => {
  it("a bad control fence reports peer/control, never peer/dispatch, and no proof", async () => {
    const { calls, commands } = leafContext(() =>
      structuredClone(CONTROL_REPLY),
    );
    const error = await capture(
      commands.peerControl({ ...CONTROL_PARAMS, controlToken: "" }),
    );
    expect(error).toBeInstanceOf(ExternalDriverProtocolError);
    const message = (error as Error).message;
    expect(message).toContain("peer/control");
    expect(message).not.toContain("peer/dispatch");
    expect(message).not.toContain(PROOF);
    expect(calls).toEqual([]);
  });

  it("a bad dispatch fence reports peer/dispatch", async () => {
    const { commands } = leafContext(() => structuredClone(DISPATCH_REPLY));
    const error = await capture(
      commands.peerDispatch({ ...DISPATCH_PARAMS, epoch: 0 }),
    );
    expect((error as Error).message).toContain("peer/dispatch");
  });
});

/**
 * 2044 lane fidelity. Wire truth: `PeerDispatchParams.model` is the REQUESTED
 * LANE key, echoed as `PeerDispatchResult.model_lane`; the result's `model` is
 * the server-RESOLVED model and may legitimately differ. The fence is on the
 * echoed LANE, never on the resolved model.
 */
describe("dispatch fences the requested LANE, not the resolved model", () => {
  it("accepts an alias lane whose resolved model DIFFERS (one RPC)", async () => {
    const { calls, commands } = leafContext(() =>
      structuredClone({
        ...DISPATCH_REPLY,
        model: "deepseek-chat-0716-resolved",
        model_lane: "deepseek-chat",
      }),
    );
    const view = (await commands.peerDispatch(DISPATCH_PARAMS)) as {
      model: string;
      modelLane: string;
    };
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toMatchObject({ model: "deepseek-chat" });
    expect(view.modelLane).toBe("deepseek-chat");
    expect(view.model).toBe("deepseek-chat-0716-resolved");
  });

  it("refuses a FOREIGN lane even when the resolved model LOOKS like the request", async () => {
    const { calls, commands } = leafContext(() =>
      // Resolved `model` masquerades as the requested lane — only `model_lane`
      // is authoritative, so this must be refused.
      structuredClone({
        ...DISPATCH_REPLY,
        model: "deepseek-chat",
        model_lane: "some-foreign-lane",
      }),
    );
    await expect(commands.peerDispatch(DISPATCH_PARAMS)).rejects.toBeInstanceOf(
      ExternalDriverProtocolError,
    );
    expect(calls).toHaveLength(1);
  });

  it("post-send mutation: the ORIGINAL lane is still accepted, the mutated one refused", async () => {
    const args: Record<string, unknown> = { ...DISPATCH_PARAMS };
    const original = leafContext(() => {
      args.model = "foreign-lane";
      // Echoes the lane captured BEFORE the caller mutated `args.model`.
      return structuredClone(DISPATCH_REPLY);
    });
    await expect(original.commands.peerDispatch(args)).resolves.toMatchObject({
      modelLane: "deepseek-chat",
    });
    expect(original.calls[0]?.params).toMatchObject({
      model: "deepseek-chat",
    });

    const mutated: Record<string, unknown> = { ...DISPATCH_PARAMS };
    const foreign = leafContext(() => {
      mutated.model = "foreign-lane";
      return structuredClone({ ...DISPATCH_REPLY, model_lane: "foreign-lane" });
    });
    await expect(foreign.commands.peerDispatch(mutated)).rejects.toBeInstanceOf(
      ExternalDriverProtocolError,
    );
  });
});

/**
 * 0550 audit — the four `peer/control` RECEIPT-decode cases the audit asked
 * for, pinned as regressions. The 2019/2030 leaf already enforced all four;
 * these lock the behaviour so a later edit cannot widen it.
 */
describe("0550 audit — peer/control receipt decode", () => {
  it("accepts a live-shaped state:'accepted' receipt", async () => {
    const { commands, calls } = leafContext(() => structuredClone(CONTROL_REPLY));
    await expect(commands.peerControl(CONTROL_PARAMS)).resolves.toMatchObject({
      operationId: "op-control-1",
      state: "accepted",
      targetOperationId: "op-dispatch-1",
      expectedTurnId: TURN,
      targetSessionId: WORKER,
      slug: "abc",
      duplicate: false,
    });
    expect(calls).toHaveLength(1);
  });

  it("accepts an idempotent replay (state:'accepted', duplicate:true)", async () => {
    const { commands } = leafContext(() =>
      structuredClone({ ...CONTROL_REPLY, duplicate: true }),
    );
    await expect(commands.peerControl(CONTROL_PARAMS)).resolves.toMatchObject({
      state: "accepted",
      duplicate: true,
    });
  });

  it("REJECTS the 0515 stub shape (state:'not_implemented', duplicate:true)", async () => {
    const stub = {
      operation_id: "op-control-1",
      state: "not_implemented",
      duplicate: true,
    };
    const { commands, calls } = leafContext(() => structuredClone(stub));
    const error = await capture(commands.peerControl(CONTROL_PARAMS));
    expect(error).toBeInstanceOf(ExternalDriverProtocolError);
    expect((error as Error).message).toBe(
      "peer/control failed: peer control receipt malformed",
    );
    // The RPC WAS sent; the rejection came from the receipt decode, not the wire.
    expect(calls).toHaveLength(1);
  });

  it("REJECTS a dispatch-shaped receipt (extra key → deny_unknown_fields parity)", async () => {
    for (const extra of [
      { model: "deepseek-chat" },
      { workspace_root: "/ws/peer-abc" },
      { adopted_session_id: WORKER },
      { session_id: WORKER },
    ]) {
      const { commands, calls } = leafContext(() =>
        structuredClone({ ...CONTROL_REPLY, ...extra }),
      );
      const error = await capture(commands.peerControl(CONTROL_PARAMS));
      expect(error).toBeInstanceOf(ExternalDriverProtocolError);
      expect((error as Error).message).toBe(
        "peer/control failed: peer control receipt malformed",
      );
      expect(calls).toHaveLength(1);
    }
  });

  it("REJECTS caller-injected session_id/model/workspaceRoot OFFLINE (zero frames)", async () => {
    for (const injected of ["session_id", "model", "workspaceRoot"] as const) {
      const { commands, calls } = leafContext();
      const args: Record<string, unknown> = {
        ...CONTROL_PARAMS,
        [injected]: "caller-injected",
      };
      const error = await capture(commands.peerControl(args));
      expect(error).toBeInstanceOf(ExternalDriverProtocolError);
      expect((error as Error).message).toBe(
        "peer/control failed: invalid peer control arguments",
      );
      expect(calls).toEqual([]);
    }
  });
});

/**
 * 0830 — the Core's TYPED refused receipt (`state:"refused"`) was
 * indistinguishable, client-side, from garbage (INVALID_CONTROL_RECEIPT). The
 * decoder now branches `refused` to a typed refusal BEFORE the accepted
 * decode; every OTHER non-accepted state (and every malformed shape) stays
 * INVALID_CONTROL_RECEIPT. Wire stays frozen; one decoder branch, one kind.
 */
const REFUSED_REPLY = {
  operation_id: "op-control-1",
  state: "refused",
  target_operation_id: "",
  expected_turn_id: "",
  target_session_id: "",
  slug: "",
  accepted_at_ms: 0,
  payload_digest: "",
  duplicate: false,
};

describe("0830 — refused peer/control receipt decodes as a typed refusal", () => {
  it("maps state:'refused' to ExternalDriverRefusalError('peer_control_refused')", async () => {
    const { commands, calls } = leafContext(() => structuredClone(REFUSED_REPLY));
    const error = await capture(commands.peerControl(CONTROL_PARAMS));
    expect(error).toBeInstanceOf(ExternalDriverRefusalError);
    expect((error as ExternalDriverRefusalError).refusalKind).toBe(
      "peer_control_refused",
    );
    // A decoded RECEIPT, not a wire failure: the RPC was still sent once.
    expect(calls).toHaveLength(1);
  });

  it("is NOT the generic malformed-receipt error", async () => {
    const { commands } = leafContext(() => structuredClone(REFUSED_REPLY));
    const error = await capture(commands.peerControl(CONTROL_PARAMS));
    expect((error as Error).message).not.toBe(
      "peer/control failed: peer control receipt malformed",
    );
  });

  it.each(["not_implemented", "queued", "refuse", ""])(
    "keeps non-accepted state %j as INVALID_CONTROL_RECEIPT",
    async (state) => {
      const { commands, calls } = leafContext(() =>
        structuredClone({ ...REFUSED_REPLY, state }),
      );
      const error = await capture(commands.peerControl(CONTROL_PARAMS));
      expect(error).toBeInstanceOf(ExternalDriverProtocolError);
      expect(error).not.toBeInstanceOf(ExternalDriverRefusalError);
      expect((error as Error).message).toBe(
        "peer/control failed: peer control receipt malformed",
      );
      expect(calls).toHaveLength(1);
    },
  );

  it("a refused state with an extra key stays malformed (deny_unknown_fields)", async () => {
    const { commands } = leafContext(() =>
      structuredClone({ ...REFUSED_REPLY, model: "deepseek-chat" }),
    );
    const error = await capture(commands.peerControl(CONTROL_PARAMS));
    expect(error).not.toBeInstanceOf(ExternalDriverRefusalError);
    expect((error as Error).message).toBe(
      "peer/control failed: peer control receipt malformed",
    );
  });
});
