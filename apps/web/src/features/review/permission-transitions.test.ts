import { describe, expect, it } from "vitest";
import {
  PermissionTransitions,
  type PermissionChannel,
  type PermissionChannelMessage,
} from "./permission-transitions.ts";
import {
  enqueue,
  flush,
  harness,
  open,
  starts,
  terminal,
} from "../session/session-record-test-fixture.ts";

/** Tabs' channels, delivered like BroadcastChannel: to the others only. */
function channels(count: number): PermissionChannel[] {
  const all: PermissionChannel[] = [];
  for (let index = 0; index < count; index += 1) {
    const channel: PermissionChannel = {
      onmessage: null,
      postMessage: (message: PermissionChannelMessage) => {
        for (const other of all)
          if (other !== channel)
            other.onmessage?.({
              data: structuredClone(message),
            } as MessageEvent);
      },
      close: () => undefined,
    };
    all.push(channel);
  }
  return all;
}

/** A permission read that lands at once. */
const read = (
  gate: PermissionTransitions,
  sessionId: string,
  explicit = false,
) => gate.completeRead(gate.beginRead(sessionId, explicit));

// T-0666 (audit T-0623 P1): after Allow or Revoke, nothing dispatches in that
// Session until the server's receipt is verified and read back.
describe("permission change dispatch gate", () => {
  it("holds only the changed Session until a read started after its verified receipt lands", () => {
    const gate = new PermissionTransitions();
    const ticket = gate.begin("A");
    expect([gate.state("A"), gate.blocked("B")]).toEqual(["applying", false]);
    // Neither a read already in flight nor the user's re-read overtakes the SET.
    const early = gate.beginRead("A");
    read(gate, "A", true);
    gate.verified(ticket);
    gate.completeRead(early);
    expect(gate.state("A")).toBe("applying");
    read(gate, "A");
    gate.settle(ticket);
    expect(gate.blocked("A")).toBe(false);
  });

  it("keeps an unknown outcome closed until the user re-reads, and a superseded SET opens nothing", () => {
    const gate = new PermissionTransitions();
    // Timeout, a lost or refused receipt, or the Session switched away.
    gate.settle(gate.begin("A"));
    read(gate, "A");
    expect(gate.state("A")).toBe("unconfirmed");
    read(gate, "A", true);
    expect(gate.blocked("A")).toBe(false);
    // An older SET's late receipt never settles the newer one.
    const older = gate.begin("A");
    const newer = gate.begin("A");
    gate.verified(older);
    read(gate, "A");
    gate.settle(older);
    expect(gate.state("A")).toBe("applying");
    gate.verified(newer);
    read(gate, "A");
    expect(gate.blocked("A")).toBe(false);
  });

  it("holds the Session in another tab until the sender settles and that tab reads", () => {
    const [one, two] = channels(2);
    const sender = new PermissionTransitions();
    const other = new PermissionTransitions();
    sender.connect(one!);
    other.connect(two!);
    const rereads: string[] = [];
    other.onSettledElsewhere((sessionId) => {
      rereads.push(sessionId);
      read(other, sessionId);
    });
    const ticket = sender.begin("A");
    read(other, "A");
    expect(other.state("A")).toBe("elsewhere");
    sender.verified(ticket);
    read(sender, "A");
    expect([sender.blocked("A"), other.blocked("A"), rereads]).toEqual([
      false,
      false,
      ["A"],
    ]);
    // An unknown outcome there needs the user's re-read here too.
    sender.settle(sender.begin("B"));
    read(other, "B");
    expect(other.state("B")).toBe("unconfirmed");
    read(other, "B", true);
    // So does a tab that went away mid-change.
    sender.begin("C");
    read(other, "C", true);
    expect([other.blocked("B"), other.blocked("C")]).toEqual([false, false]);
  });

  it("holds every dispatch of the changed Session while another drains, then releases its head once", async () => {
    const gate = new PermissionTransitions();
    const h = harness({
      permissionHeld: (scope) => gate.blocked(scope.sessionId),
    });
    gate.subscribe((sessionId) => {
      if (!gate.blocked(sessionId)) h.manager.releasePermissionHold(sessionId);
    });
    const a = await open(h, "A");
    const b = await open(h, "B");
    enqueue(a, "A1");
    enqueue(a, "A2");
    await flush();
    const ticket = gate.begin("A");
    // A prompt or steer is refused (the composer keeps it); A1's terminal
    // releases nothing.
    expect(a.controller.submitTurn({ turnId: "A3", text: "A3" })).toBe(false);
    h.client.emit(terminal("A", "A1", 1));
    enqueue(b, "B1");
    await flush();
    expect(starts(h.client)).toEqual([
      ["A", "A1"],
      ["B", "B1"],
    ]);
    gate.verified(ticket);
    read(gate, "A");
    await flush();
    expect(starts(h.client)).toEqual([
      ["A", "A1"],
      ["B", "B1"],
      ["A", "A2"],
    ]);
  });
});
