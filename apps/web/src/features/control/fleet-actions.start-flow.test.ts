/**
 * fleet-actions Start flow — GLM-WEB-GATES-4230 RED (judge/live walkthrough
 * 4200c: Start sent ONLY peer/prepare; no session/driver/acquire and no
 * peer/dispatch followed; the row sat 'Starting' 150 s).
 *
 * Root cause (traced in use-octos-session + session-peer-coordinator):
 *   App's onStart -> peerController.onDispatch -> dispatchStagedPeer ->
 *   performStagedDispatch -> manager.kickoff -> commands.prepare (peer/prepare)
 *   -> #stage -> onOpenPeer -> coordinator.open -> `#openByDispatch` ONLY when
 *   `binding.record.controlReadiness === "ready"` AND `dispatchPeer` reads
 *   `controlAcquireRef.current` — which is NULL because NOTHING ACQUIRES on
 *   Start (P2q opt-in latch keeps the seat parked). performPeerDispatch then
 *   refuses `driver_fence_stale` (plan refused, no frame) and the row rests in
 *   its staging ('Starting') forever.
 *
 * This file specifies the MACHINE's contract for the fix: FleetView's onStart
 * must fire an EXPLICIT start sequence (acquire -> await proof -> dispatch),
 * and the pure helpers below must build exactly ONE acquire and exactly ONE
 * dispatch from one Start, in order, reusing the machine's operation id. The
 * hook hunk that runs it lives with the hook owner (spec'd in my 4230 report).
 */
import { describe, expect, it } from "vitest";
import {
  buildFleetStartAcquire,
  buildFleetStartDispatch,
  FLEET_START_IDLE,
  fleetStartBegin,
  type FleetStartState,
} from "./fleet-actions.ts";

const OBSERVED_REVISION = 12;

describe("Fixes 4230 — Start = acquire (CAS) -> await proof -> dispatch once", () => {
  it("builds exactly ONE acquire from a requesting Start: CAS on the observed revision", () => {
    const machine = fleetStartBegin(
      FLEET_START_IDLE,
      "glm-5.3",
      "Review the diff",
    );
    if (machine.kind !== "requesting") throw new Error("not requesting");
    const acquire = buildFleetStartAcquire(machine, {
      driverId: "octoscode-web:uuid-1",
      observedRevision: OBSERVED_REVISION,
    });
    expect(acquire).not.toBeNull();
    expect(acquire!.driverId).toBe("octoscode-web:uuid-1");
    expect(acquire!.expectedRevision).toBe(OBSERVED_REVISION);
    // TWO builds from the SAME machine return the SAME acquire (idempotent
    // planning — the caller sends one frame, not one per render).
    expect(
      buildFleetStartAcquire(machine, {
        driverId: "octoscode-web:uuid-1",
        observedRevision: OBSERVED_REVISION,
      }),
    ).toEqual(acquire);
  });

  it("refuses the acquire when the observed revision is unknown (no CAS basis)", () => {
    const machine = fleetStartBegin(FLEET_START_IDLE, "glm-5.3", "R");
    if (machine.kind !== "requesting") throw new Error("not requesting");
    expect(
      buildFleetStartAcquire(machine, {
        driverId: "octoscode-web:uuid-1",
        observedRevision: null,
      }),
    ).toBeNull();
  });

  it("builds exactly ONE dispatch carrying the machine's operation id + lane + brief", () => {
    const machine = fleetStartBegin(
      FLEET_START_IDLE,
      "glm-5.3",
      "Review the diff",
    );
    if (machine.kind !== "requesting") throw new Error("not requesting");
    const dispatch = buildFleetStartDispatch(machine, {
      driverId: "octoscode-web:uuid-1",
      epoch: 7,
      controlToken: "tok-secret",
    });
    expect(dispatch).not.toBeNull();
    expect(dispatch!.operationId).toBe(machine.operationId);
    expect(dispatch!.model).toBe("glm-5.3");
    expect(dispatch!.dispatch).toEqual({
      kind: "new_brief",
      brief: "Review the diff",
      title: "Review the diff",
    });
    // No proof => no dispatch AT ALL (fail-closed; the old bug's class).
    expect(buildFleetStartDispatch(machine, null)).toBeNull();
  });

  it("the same machine NEVER yields a second acquire or dispatch (repeat blocked)", () => {
    const first = fleetStartBegin(FLEET_START_IDLE, "glm-5.3", "R");
    const again = fleetStartBegin(first, "glm-5.3", "R");
    expect(again).toBe(first);
    const settled: FleetStartState = fleetStartBegin(
      FLEET_START_IDLE,
      "x",
      "y",
    );
    void settled;
  });
});
