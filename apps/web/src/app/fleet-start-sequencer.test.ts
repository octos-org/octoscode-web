import { describe, expect, it } from "vitest";
import {
  fleetStartOnSubmit,
  fleetStartOnSeatHeld,
  type FleetStartCalls,
} from "./fleet-start-sequencer.ts";

/**
 * 4200c: Start sent ONLY peer/prepare — no session/driver/acquire, no
 * peer/dispatch, row stuck "Starting" 150s. Design §4.3/§5.4: Start IS the
 * implicit acquisition: acquire (CAS on the observed revision) → await proof →
 * dispatch ONCE. This is the App-side call-order contract, recorded like a
 * wire client: the sink records every call in order.
 */
function recorder() {
  const calls: FleetStartCalls[] = [];
  return {
    calls,
    sink: {
      onAcquireSeat: () => void calls.push({ kind: "acquire" }),
      onDispatch: (submit: { laneKey: string; brief: string; title: string }) =>
        void calls.push({ kind: "dispatch", submit }),
    },
  };
}

const SUBMIT = {
  laneKey: "glm-5.3",
  brief: "write a haiku",
  title: "write a haiku",
} as const;

describe("fleet start sequencer (§4.3 Start = acquire → dispatch once)", () => {
  it("acquires FIRST when no seat is held, and does NOT dispatch yet", () => {
    const rec = recorder();
    const next = fleetStartOnSubmit({
      state: { kind: "idle" },
      seatHeld: false,
      submit: SUBMIT,
      sink: rec.sink,
    });
    expect(rec.calls.map((call) => call.kind)).toEqual(["acquire"]);
    expect(next).toEqual({ kind: "awaiting-seat", submit: SUBMIT });
  });

  it("dispatches immediately when the seat is already held", () => {
    const rec = recorder();
    const next = fleetStartOnSubmit({
      state: { kind: "idle" },
      seatHeld: true,
      submit: SUBMIT,
      sink: rec.sink,
    });
    expect(rec.calls.map((call) => call.kind)).toEqual(["dispatch"]);
    expect(next).toBeNull();
  });

  it("dispatches exactly ONCE when the awaited seat lands", () => {
    const rec = recorder();
    const next = fleetStartOnSeatHeld({
      state: { kind: "awaiting-seat", submit: SUBMIT },
      seatHeld: true,
      sink: rec.sink,
    });
    expect(rec.calls.map((call) => call.kind)).toEqual(["dispatch"]);
    expect(next).toBeNull();
  });

  it("keeps waiting while the seat is still not held (no dispatch, no repeat acquire)", () => {
    const rec = recorder();
    const next = fleetStartOnSeatHeld({
      state: { kind: "awaiting-seat", submit: SUBMIT },
      seatHeld: false,
      sink: rec.sink,
    });
    expect(rec.calls).toEqual([]);
    expect(next).toEqual({ kind: "awaiting-seat", submit: SUBMIT });
  });

  it("never double-dispatches: a settled pending is consumed", () => {
    const rec = recorder();
    expect(
      fleetStartOnSeatHeld({
        state: { kind: "awaiting-seat", submit: SUBMIT },
        seatHeld: true,
        sink: rec.sink,
      }),
    ).toBeNull();
    // The consumed pending leaves no residue for a second fire.
    expect(rec.calls.length).toBe(1);
  });

  it("a repeat submit while awaiting re-acquires nothing and queues the LATEST brief", () => {
    const rec = recorder();
    const next = fleetStartOnSubmit({
      state: { kind: "awaiting-seat", submit: SUBMIT },
      seatHeld: false,
      submit: { ...SUBMIT, brief: "second brief" },
      sink: rec.sink,
    });
    expect(rec.calls).toEqual([]);
    expect(next).toEqual({
      kind: "awaiting-seat",
      submit: { ...SUBMIT, brief: "second brief" },
    });
  });
});
