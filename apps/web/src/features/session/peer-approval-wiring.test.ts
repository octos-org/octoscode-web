import { describe, expect, it, vi } from "vitest";
import type { ExternalDriverCommands } from "@octos-org/octoscode-client/external-driver";
import type { PeerRosterEntry } from "../peers/peer-manager.ts";
import {
  buildPeerApprovalActivation,
  performPeerApproval,
} from "./use-octos-session.ts";

/**
 * Gap 6b RED: the roster row action must reach `peer/control` as an
 * `approval_respond`. The dock already forwards `(entry, decision)`; nothing
 * built the target identity or the command. The target is ROSTER-derived now
 * (`PeerRosterEntry.operationId` + the live `turnId`), so this pins the pure
 * seam the hook uses — fail-closed when any required id is missing, and exactly
 * ONE frame per activation.
 */
const TURN = "11111111-1111-1111-1111-111111111111";

const ENTRY: PeerRosterEntry = {
  identity: "peer-1",
  profileId: "profile-1",
  topic: "topic",
  slug: "peer-1",
  cwd: "/workspace",
  briefPath: "/brief.md",
  origin: "staged",
  turnId: TURN,
  status: "started",
  activity: "blocked",
  openedAt: 1,
  finishedAt: null,
  outputTokens: 0,
  requestId: "req-1",
  requestKind: "approval",
  operationId: "dispatch-op-1",
  error: null,
  canRetry: false,
};

const ACQUIRE = {
  capability: { driverId: "drv-1", epoch: 7, reveal: () => "tok-secret" },
  binding: {
    driverId: "drv-1",
    epoch: 7,
    revision: 12,
    leaseExpiresAtMs: 1_700_000_000_000,
    acceptedWork: ["dispatch-op-1"],
  },
  pendingWork: ["dispatch-op-1"],
  recovery: "none" as const,
};

const leafOf = (impl = async () => ({})): ExternalDriverCommands =>
  ({ peerControl: vi.fn(impl) }) as unknown as ExternalDriverCommands;

describe("buildPeerApprovalActivation — roster-derived target + command", () => {
  it("builds the target from the entry's accepted operation and live turn", () => {
    const built = buildPeerApprovalActivation({
      entry: ENTRY,
      decision: "approve",
      newOperationId: () => "ctl-op-1",
    });
    expect(built).not.toBeNull();
    expect(built?.target).toEqual({
      controlOperationId: "ctl-op-1",
      targetOperationId: "dispatch-op-1",
      expectedTurnId: TURN,
    });
    expect(built?.command).toEqual({
      kind: "approval_respond",
      approvalId: "req-1",
      decision: "approve",
    });
  });

  it("carries the DENY decision verbatim", () => {
    expect(
      buildPeerApprovalActivation({
        entry: ENTRY,
        decision: "deny",
        newOperationId: () => "ctl-op-2",
      })?.command,
    ).toEqual({ kind: "approval_respond", approvalId: "req-1", decision: "deny" });
  });

  it("is null when the accepted dispatch operation id is missing", () => {
    expect(
      buildPeerApprovalActivation({
        entry: { ...ENTRY, operationId: null },
        decision: "approve",
        newOperationId: () => "ctl-op-1",
      }),
    ).toBeNull();
  });

  it("is null when the pending request id is missing", () => {
    expect(
      buildPeerApprovalActivation({
        entry: { ...ENTRY, requestId: null },
        decision: "approve",
        newOperationId: () => "ctl-op-1",
      }),
    ).toBeNull();
  });

  it("is null when the turn id is not a protocol UUID", () => {
    expect(
      buildPeerApprovalActivation({
        entry: { ...ENTRY, turnId: "not-a-uuid" },
        decision: "approve",
        newOperationId: () => "ctl-op-1",
      }),
    ).toBeNull();
  });
});

describe("performPeerApproval — exactly ONE frame, fail-closed", () => {
  it("sends one approval_respond through the seat's leaf and returns a receipt", async () => {
    const leaf = leafOf(async () => ({ accepted: true }));
    const state = await performPeerApproval({
      leaf,
      acquire: ACQUIRE,
      entry: ENTRY,
      decision: "approve",
      newOperationId: () => "ctl-op-1",
    });
    expect(leaf.peerControl).toHaveBeenCalledTimes(1);
    expect(leaf.peerControl).toHaveBeenCalledWith({
      driverId: "drv-1",
      epoch: 7,
      controlToken: "tok-secret",
      operationId: "ctl-op-1",
      targetOperationId: "dispatch-op-1",
      expectedTurnId: TURN,
      command: {
        kind: "approval_respond",
        approvalId: "req-1",
        decision: "approve",
      },
    });
    expect(state).toEqual({ kind: "receipt", receipt: { accepted: true } });
  });

  it("returns null WITHOUT a frame when the seat leaf is absent", async () => {
    const state = await performPeerApproval({
      leaf: null,
      acquire: ACQUIRE,
      entry: ENTRY,
      decision: "approve",
      newOperationId: () => "ctl-op-1",
    });
    expect(state).toBeNull();
  });

  it("returns null WITHOUT a frame when the entry cannot form a target", async () => {
    const leaf = leafOf();
    const state = await performPeerApproval({
      leaf,
      acquire: ACQUIRE,
      entry: { ...ENTRY, operationId: null },
      decision: "approve",
      newOperationId: () => "ctl-op-1",
    });
    expect(state).toBeNull();
    expect(leaf.peerControl).not.toHaveBeenCalled();
  });

  it("maps a typed refusal to the bounded refused state, still ONE frame", async () => {
    const leaf = leafOf(async () => {
      throw Object.assign(new Error("stale"), { refusalKind: "driver_fence_stale" });
    });
    const state = await performPeerApproval({
      leaf,
      acquire: ACQUIRE,
      entry: ENTRY,
      decision: "deny",
      newOperationId: () => "ctl-op-1",
    });
    expect(leaf.peerControl).toHaveBeenCalledTimes(1);
    expect(state).toEqual({ kind: "refused", refusalKind: "driver_fence_stale" });
  });
});
