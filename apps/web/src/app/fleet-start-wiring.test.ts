import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Round 3 item 2 (judge #2): App's Fleet onStart runs the acquire-then-dispatch
 * sequencer — acquire when no seat is held, ONE dispatch when it lands (or
 * immediately if held), pending consumed once. The pure order contract is
 * proven by fleet-start-sequencer.test.ts; this pins the App wiring.
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("App consumes the fleet start sequencer (Start = acquire → dispatch)", () => {
  it("imports and holds the sequencer state", () => {
    expect(app).toMatch(/from "\.\/fleet-start-sequencer\.ts"/);
    expect(app).toContain("fleetStartOnSubmit(");
    expect(app).toContain("fleetStartOnSeatHeld(");
  });

  it("onStart routes through fleetStartOnSubmit with the seat fact", () => {
    expect(app).toContain("fleetStartOnSubmit({");
    expect(app).toMatch(
      /seatHeld:\s*\n?\s*session\.peerController\?\.seatHeld === true/,
    );
    expect(app).toContain("onAcquireSeat");
    expect(app).toContain("onDispatch");
  });

  it("mints the dispatch title as the brief's first line, 60 chars", () => {
    expect(app).toMatch(
      /title: submit\.brief\.split\("\\n", 1\)\[0\]!\.slice\(0, 60\)/,
    );
  });

  it("awaits the seat and dispatches exactly once when it lands", () => {
    expect(app).toMatch(
      /fleetStartOnSeatHeld\(\{[\s\S]{0,260}seatHeld: session\.peerController\?\.seatHeld/,
    );
    // The pending is consumed (null settle clears it), never re-fired.
    expect(app).toMatch(/setFleetStartPending\(\{ kind: "idle" \}\)/);
  });

  it("the seat-hold effect keys on the seat fact, not the controller object", () => {
    // Whitespace-tolerant: Prettier may wrap this dependency array across
    // lines, and the fact under test is which deps are listed, not their
    // formatting.
    expect(app).toMatch(
      /\},\s*\[\s*session\.peerController\?\.seatHeld,\s*fleetStartPending,\s*session\.peerController,?\s*\]\);/,
    );
  });
});
