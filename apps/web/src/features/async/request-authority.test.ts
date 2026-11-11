import { describe, expect, it } from "vitest";
import { RequestAuthorityGate } from "./request-authority.ts";

describe("RequestAuthorityGate", () => {
  // One guard per property (T-0591 B1 merge): every original assertion from
  // the four prior its is preserved here — the merge only shares the gate /
  // client setup, never drops a check. Each `it` below names the property it
  // still pins, so a regression in any one reads as its own failure.
  function fresh() {
    const gate = new RequestAuthorityGate<object>();
    return { gate, client: {} };
  }

  it("requires the latest generation, the exact client and the exact session scope", () => {
    const { gate, client } = fresh();
    const authority = gate.begin(client, "session-a");

    expect(gate.isCurrent(authority, client, "session-a")).toBe(true);
    expect(gate.isCurrent(authority, {}, "session-a")).toBe(false);
    expect(gate.isCurrent(authority, client, "session-b")).toBe(false);
  });

  it("lets a stale scope finish exactly once and refuses the second finish", () => {
    const { gate } = fresh();
    const staleScope = gate.begin({}, "session-a");

    expect(gate.isCurrent(staleScope, {}, "session-a")).toBe(false);
    expect(gate.finish(staleScope)).toBe(true);
    expect(gate.finish(staleScope)).toBe(false);
  });

  it("keeps the newer request current and refuses the older finally", () => {
    const { gate, client } = fresh();
    const older = gate.begin(client, "session-a");
    const newer = gate.begin(client, "session-b");

    expect(gate.isCurrent(older, client, "session-a")).toBe(false);
    expect(gate.finish(older)).toBe(false);
    expect(gate.isCurrent(newer, client, "session-b")).toBe(true);
    expect(gate.finish(newer)).toBe(true);
  });

  it("invalidates every completion owned by a reset projection", () => {
    const { gate, client } = fresh();
    const authority = gate.begin(client, "session-a");

    gate.invalidate();

    expect(gate.isCurrent(authority, client, "session-a")).toBe(false);
    expect(gate.finish(authority)).toBe(false);
  });
});
