/**
 * fleet-actions — the Start = acquire → dispatch state machine (judge round 1
 * item #2; round 2 owner web-ux-fleet-02; design §4.3/§5.4).
 *
 * Start is the ONLY implicit acquisition: acquire the selected session (CAS on
 * the observed revision), AWAIT the proof, then dispatch ONCE with a minted
 * operation id. RED first: fleet-actions.ts does not exist yet.
 */
import { describe, expect, it } from "vitest";
import {
  FLEET_START_IDLE,
  FLEET_START_REQUESTING,
  fleetStartBegin,
  fleetStartFailure,
  fleetStartRetryKeepsOperationId,
  fleetStartSettle,
  type FleetStartState,
} from "./fleet-actions.ts";

describe("judge #2 — Start = acquire → await proof → dispatch once", () => {
  it("begins REQUESTING from idle with model+brief, briefly holding the draft", () => {
    const state = fleetStartBegin(FLEET_START_IDLE, "glm-5.3", "Review the diff");
    expect(state.kind).toBe("requesting");
    if (state.kind !== "requesting") return;
    expect(state.laneKey).toBe("glm-5.3");
    expect(state.brief).toBe("Review the diff");
    expect(state.operationId).not.toBe("");
  });

  it("refuses to begin without a model or a blank brief (no acquire at all)", () => {
    expect(fleetStartBegin(FLEET_START_IDLE, "", "Review")).toBe(FLEET_START_IDLE);
    expect(fleetStartBegin(FLEET_START_IDLE, "glm-5.3", "   ")).toBe(
      FLEET_START_IDLE,
    );
  });

  it("prevents a REPEAT submit while requesting (no second acquire/dispatch)", () => {
    const requesting = fleetStartBegin(FLEET_START_IDLE, "glm-5.3", "Review");
    expect(fleetStartBegin(requesting, "glm-5.3", "Review")).toBe(requesting);
  });

  it("settles accepted and returns the operation's receipt identity", () => {
    const requesting = fleetStartBegin(FLEET_START_IDLE, "glm-5.3", "R");
    const state = fleetStartSettle(requesting, {
      kind: "accepted",
      slug: "op-d32a",
      operationId: requesting.kind === "requesting" ? requesting.operationId : "",
    });
    expect(state.kind).toBe("accepted");
    if (state.kind !== "accepted") return;
    expect(state.slug).toBe("op-d32a");
  });

  it("settles failure with bounded copy and KEEPS the brief (draft retained)", () => {
    const requesting = fleetStartBegin(FLEET_START_IDLE, "glm-5.3", "Review the diff");
    const state = fleetStartFailure(requesting, "driver_model_unavailable");
    expect(state.kind).toBe("failed");
    if (state.kind !== "failed") return;
    expect(state.refusalKind).toBe("driver_model_unavailable");
    expect(state.brief).toBe("Review the diff");
    expect(state.laneKey).toBe("glm-5.3");
  });

  it("reuses the SAME operation id after an uncertain acknowledgment", () => {
    const first = fleetStartBegin(FLEET_START_IDLE, "glm-5.3", "R");
    const retried = fleetStartRetryKeepsOperationId(first);
    expect(retried).not.toBeNull();
    if (first.kind !== "requesting" || retried?.kind !== "requesting") return;
    expect(retried.operationId).toBe(first.operationId);
    expect(retried.attempt).toBe(first.attempt + 1);
  });

  it("exposes the requesting seed for the acquire→dispatch runner", () => {
    const state: FleetStartState = FLEET_START_REQUESTING;
    void state;
  });
});