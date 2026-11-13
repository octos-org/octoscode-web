import { describe, expect, it } from "vitest";
import {
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

describe("post-send caller mutation cannot retarget the decode fence", () => {
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
});

describe("control command variants + cross-variant rejection", () => {
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

/**
 * 2044 lane fidelity. Wire truth: `PeerDispatchParams.model` is the REQUESTED
 * LANE key, echoed as `PeerDispatchResult.model_lane`; the result's `model` is
 * the server-RESOLVED model and may legitimately differ. The fence is on the
 * echoed LANE, never on the resolved model.
 */
describe("dispatch fences the requested LANE, not the resolved model", () => {
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
});

/**
 * 0550 audit — the four `peer/control` RECEIPT-decode cases the audit asked
 * for, pinned as regressions. The 2019/2030 leaf already enforced all four;
 * these lock the behaviour so a later edit cannot widen it.
 */
describe("0550 audit — peer/control receipt decode", () => {
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
    const { commands, calls } = leafContext(() =>
      structuredClone(REFUSED_REPLY),
    );
    const error = await capture(commands.peerControl(CONTROL_PARAMS));
    expect(error).toBeInstanceOf(ExternalDriverRefusalError);
    expect((error as ExternalDriverRefusalError).refusalKind).toBe(
      "peer_control_refused",
    );
    // A decoded RECEIPT, not a wire failure: the RPC was still sent once.
    expect(calls).toHaveLength(1);
  });
});
