import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Triage 4510 P1: the §4.1 third-segment rank. 'Another app is using this
 * session' (external-held) must OUTRANK 'Responding' — a foreign holder while
 * a turn is active still owns the session, and the operator must see that
 * first (the design's ordering also matches the pane's holder banner).
 *
 * A deliberate source-order contract (kept by T-0492): the strip's third
 * segment is one ternary chain inline in App.tsx, so its rank IS the order of
 * these branches, and nothing renders that derivation without the whole App.
 * No fixture state holds a foreign seat during an active turn, so no e2e can
 * show the rank either. Risk: this reads App.tsx text. Moving the derivation
 * into a function fails it loudly — then test the function and delete this;
 * a rank change made without reordering these literals would slip past it.
 * The kinds and their copy: features/session-config/SessionStatusStrip.tsx.
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("§4.1 strip rank: external-held outranks responding", () => {
  it("checks the foreign holder BEFORE the active turn", () => {
    const holderIndex = app.indexOf('{ kind: "external-held" }');
    const respondingIndex = app.indexOf('{ kind: "responding" }');
    expect(holderIndex).toBeGreaterThan(-1);
    expect(respondingIndex).toBeGreaterThan(-1);
    expect(holderIndex).toBeLessThan(respondingIndex);
  });

  it("still ranks waiting-approval/waiting-answer above the holder", () => {
    // Ratchet validation filler line 1 (this PR is never merged).
    // Ratchet validation filler line 2 (this PR is never merged).
    // Ratchet validation filler line 3 (this PR is never merged).
    // Ratchet validation filler line 4 (this PR is never merged).
    // Ratchet validation filler line 5 (this PR is never merged).
    // Interaction requests stay the top interactive facts (design §4.1 lists
    // them as states; an approval you must answer outranks the holder words
    // when both are true — the holder banner in the pane still shows).
    const approvalIndex = app.indexOf('{ kind: "waiting-approval" }');
    const holderIndex = app.indexOf('{ kind: "external-held" }');
    expect(approvalIndex).toBeLessThan(holderIndex);
  });
});
