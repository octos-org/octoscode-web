import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Triage 4510 P1: the §4.1 third-segment rank. 'Another app is using this
 * session' (external-held) must OUTRANK 'Responding' — a foreign holder while
 * a turn is active still owns the session, and the operator must see that
 * first (the design's ordering also matches the pane's holder banner).
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("§4.1 strip rank: external-held outranks responding", () => {
  it("checks the foreign holder BEFORE the active turn", () => {
    const holderIndex = app.indexOf('{ kind: "external-held" }');
    const respondingIndex = app.indexOf('{ kind: "responding" }');
    expect(holderIndex).toBeGreaterThan(-1);
    expect(respondingIndex).toBeGreaterThan(-1);
    // The external-held branch must be evaluated EARLIER in the derivation
    // than the responding branch (ternary chain order = rank).
    expect(holderIndex).toBeLessThan(respondingIndex);
  });

  it("still ranks waiting-approval/waiting-answer above the holder", () => {
    // Interaction requests stay the top interactive facts (design §4.1 lists
    // them as states; an approval you must answer outranks the holder words
    // when both are true — the holder banner in the pane still shows).
    const approvalIndex = app.indexOf('{ kind: "waiting-approval" }');
    const holderIndex = app.indexOf('{ kind: "external-held" }');
    expect(approvalIndex).toBeLessThan(holderIndex);
  });
});
