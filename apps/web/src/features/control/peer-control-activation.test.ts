/**
 * peer/control activation — RED-first unit coverage (align round 2, 1640).
 *
 * Browser evidence (native-glm-browser-peer-control-only-1620.md): the seat
 * MOUNTS but every command activation is a silent NO-OP — 0 `peer/control`
 * frames leave, so no receipt/refusal ever renders. Two PRODUCT defects:
 *  1. the seat's `onSend` is never supplied (Panel :108 optional-chains it
 *     away; `sendPeerControl` has zero product callers);
 *  2. the panel's placeholder commands (`approvalId:""`, `answers:[]`,
 *     `input:[]`) are rejected OFFLINE by the real leaf encoder, so even a
 *     wired sink would emit ZERO frames for 3 of the 4 commands.
 *
 * Proven here against the REAL client leaf + an injected transport, and the
 * pure activation seam. apps/web has no jsdom: no clicks, no sleeps, no
 * test-only product export.
 */
import { describe, expect, it, vi } from "vitest";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
} from "@octos-org/octoscode-client/external-driver";
import { createExternalDriverCommands } from "@octos-org/octoscode-client/external-driver";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  PEER_CONTROL_COMMAND_KINDS,
  buildPeerControlCommand,
  type PeerControlFence,
  type PeerControlLeaf,
  type PeerControlTarget,
} from "./peer-control-commands.ts";
import {
  peerControlRefusalKindOf,
  performPeerControl,
} from "./peer-control-activation.ts";

const MASTER = "dev:local:tui#peer-abc";
const PROFILE = "dev";
const TURN = "11111111-1111-1111-1111-111111111111";
const SLUG = "synthetic-peer";

const CAPS: UiProtocolCapabilities = {
  version: { protocol: "octos/ui-protocol", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 1,
  supported_methods: [EXTERNAL_DRIVER_METHODS.PEER_CONTROL],
  supported_notifications: [],
  supported_features: [EXTERNAL_DRIVER_V1_FEATURE],
};

/** The fixture's EXACT accepted receipt (mock `peerControlAcceptedReceipt`). */
function accepted(params: Record<string, unknown>): Record<string, unknown> {
  return {
    operation_id: params.operation_id,
    state: "accepted",
    target_operation_id: params.target_operation_id,
    expected_turn_id: params.expected_turn_id,
    target_session_id: `${MASTER.split("#")[0]}#peer-${SLUG}`,
    slug: SLUG,
    accepted_at_ms: 1_770_000_000_000,
    payload_digest: "synthetic-payload-digest",
    duplicate: false,
  };
}

async function realLeaf() {
  const frame = vi.fn(async (_method: string, params: unknown) =>
    accepted(params as Record<string, unknown>),
  );
  const commands = createExternalDriverCommands(
    { request: (method, params) => frame(method, params) },
    MASTER,
    CAPS,
    { profileId: PROFILE, topic: "peer-abc" },
  );
  return { commands, frame };
}

const FENCE_TARGET = {
  driverId: "synthetic-driver",
  epoch: 7,
  controlToken: "synthetic-control-token",
  operationId: "ctl-op-1",
  targetOperationId: "dispatch-op-1",
  expectedTurnId: TURN,
} as const;

describe("buildPeerControlCommand — encoder-valid command per kind", () => {
  it.each(PEER_CONTROL_COMMAND_KINDS)(
    "%s survives the REAL leaf encoder and emits exactly ONE frame",
    async (kind) => {
      const { commands, frame } = await realLeaf();
      const command = buildPeerControlCommand(kind);
      expect(command.kind).toBe(kind);
      const receipt = await commands.peerControl({ ...FENCE_TARGET, command });
      // An offline encoder rejection throws BEFORE any frame; reaching here
      // with exactly one frame proves the built command is encoder-valid.
      expect(frame).toHaveBeenCalledTimes(1);
      expect(receipt).toMatchObject({ state: "accepted", slug: SLUG });
    },
  );

  it("mints no empty id/text the native encoder would reject offline", () => {
    const approval = buildPeerControlCommand("approval_respond");
    expect(approval.kind).toBe("approval_respond");
    if (approval.kind === "approval_respond") {
      expect(approval.approvalId.length).toBeGreaterThan(0);
      expect(approval.decision).toBe("approve");
    }
    const question = buildPeerControlCommand("question_respond");
    if (question.kind === "question_respond") {
      expect(question.questionId.length).toBeGreaterThan(0);
      expect(question.answers.length).toBeGreaterThan(0);
    }
    const steer = buildPeerControlCommand("steer");
    if (steer.kind === "steer") {
      expect(steer.input.length).toBeGreaterThan(0);
      expect(steer.input[0]?.text.length).toBeGreaterThan(0);
    }
    expect(buildPeerControlCommand("interrupt")).toEqual({ kind: "interrupt" });
  });
});

describe("peerControlRefusalKindOf — bounded refusal narrowing", () => {
  it("reads the typed kind off a refusal-shaped error", () => {
    expect(peerControlRefusalKindOf({ refusalKind: "driver_fence_stale" })).toBe(
      "driver_fence_stale",
    );
    expect(
      peerControlRefusalKindOf({ refusalKind: "peer_control_refused" }),
    ).toBe("peer_control_refused");
  });

  it("is null for anything that is not a typed refusal", () => {
    expect(peerControlRefusalKindOf(new Error("boom"))).toBeNull();
    expect(peerControlRefusalKindOf(null)).toBeNull();
    expect(peerControlRefusalKindOf(undefined)).toBeNull();
    expect(peerControlRefusalKindOf({ refusalKind: 7 })).toBeNull();
    expect(peerControlRefusalKindOf({ refusalKind: "" })).toBeNull();
  });
});

describe("performPeerControl — ONE activation, never a retry", () => {
  const fence: PeerControlFence = {
    driverId: "drv-1",
    epoch: 7,
    controlToken: "tok-secret",
  };
  const target: PeerControlTarget = {
    controlOperationId: "ctl-op-1",
    targetOperationId: "dispatch-op-1",
    expectedTurnId: TURN,
  };

  it("settles to a receipt on an accepted reply", async () => {
    const peerControl = vi.fn(async () => ({ slug: SLUG, duplicate: false }));
    const leaf = { peerControl } as unknown as PeerControlLeaf;
    const state = await performPeerControl({
      leaf,
      fence,
      target,
      command: { kind: "interrupt" },
    });
    expect(peerControl).toHaveBeenCalledTimes(1);
    expect(state).toEqual({
      kind: "receipt",
      receipt: { slug: SLUG, duplicate: false },
    });
  });

  it("settles to a typed refusal and never re-sends", async () => {
    const peerControl = vi.fn(async () => {
      throw Object.assign(new Error("refused"), {
        refusalKind: "driver_fence_stale",
      });
    });
    const leaf = { peerControl } as unknown as PeerControlLeaf;
    const state = await performPeerControl({
      leaf,
      fence,
      target,
      command: { kind: "interrupt" },
    });
    expect(peerControl).toHaveBeenCalledTimes(1);
    expect(state).toEqual({
      kind: "refused",
      refusalKind: "driver_fence_stale",
    });
  });

  it("degrades a non-typed failure to a bounded refused state", async () => {
    const peerControl = vi.fn(async () => {
      throw new Error("malformed receipt");
    });
    const leaf = { peerControl } as unknown as PeerControlLeaf;
    const state = await performPeerControl({
      leaf,
      fence,
      target,
      command: { kind: "interrupt" },
    });
    expect(peerControl).toHaveBeenCalledTimes(1);
    expect(state.kind).toBe("refused");
  });
});
