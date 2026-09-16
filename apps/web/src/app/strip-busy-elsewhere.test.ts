import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * §4.1 third segment: when the session's live turn was started by ANOTHER
 * attached client (the octoscode terminal, a second tab), the strip must say
 * so rather than reading 'Responding' — which claims the turn as this app's
 * own. The derivation lives in the App's ternary chain, so this pins the
 * branch and its guard the way strip-rank-4510 pins the holder's rank.
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("§4.1 strip: another client's turn is not 'Responding'", () => {
  it("checks the adopted origin before falling back to responding", () => {
    const adopted = app.indexOf('{ kind: "busy-elsewhere" }');
    const responding = app.indexOf('{ kind: "responding" }');
    expect(adopted).toBeGreaterThan(-1);
    expect(responding).toBeGreaterThan(-1);
    expect(adopted).toBeLessThan(responding);
  });

  it("guards the branch with selfSeatHeld so our own peers are never 'another client'", () => {
    // §4.3: a peer THIS app started is SELF. Its turn is ours, and must keep
    // reading as peer activity rather than as a foreign client.
    const branch = app.slice(
      app.indexOf('conversation.queue.active.origin === "adopted"'),
      app.indexOf('{ kind: "busy-elsewhere" }'),
    );
    expect(branch).toContain("!selfSeatHeld");
  });

  it("still ranks the external holder above the busy disclosure", () => {
    // A held control seat refuses chat outright; a busy session does not.
    expect(app.indexOf('{ kind: "external-held" }')).toBeLessThan(
      app.indexOf('{ kind: "busy-elsewhere" }'),
    );
  });
});
