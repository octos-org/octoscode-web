import { describe, expect, it } from "vitest";
import { RequestGate } from "./request-gate.ts";

describe("RequestGate", () => {
  it("makes only the latest request generation authoritative", () => {
    const gate = new RequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it("invalidates work without starting another request", () => {
    const gate = new RequestGate();
    const request = gate.begin();
    gate.invalidate();
    expect(gate.isCurrent(request)).toBe(false);
  });
});
