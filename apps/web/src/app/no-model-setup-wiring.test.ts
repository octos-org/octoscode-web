import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Hotfix run 21: the §5.1 empty-catalog routing must be gated by SETTLED
 * fetch evidence. Pre-session the hook never starts a fetch (mock's
 * profile/llm/list needs a session_id), so `available:true + models:[]` must
 * NOT route — the picker stays the default post-connect surface.
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("App routes to Settings only on settled unusable model evidence", () => {
  it("decides through the pure gate (shouldRouteNoModelSetup)", () => {
    expect(app).toContain("shouldRouteNoModelSetup(");
    expect(app).toMatch(
      /from "\.\.\/features\/connection\/no-model-setup\.ts"/,
    );
  });

  it("tracks that a fetch actually started before the gate can fire", () => {
    // Only a started-then-settled fetch is evidence; `available` alone or an
    // in-flight/never-started read must never route.
    expect(app).toContain("modelsFetchStarted");
    expect(app).toMatch(/models\.state\.loading[\s\S]{0,120}modelsFetchStarted/);
  });

  it("keeps the picker as the default post-connect surface", () => {
    // The routing is an effect that OPENS settings only when the gate says so;
    // it must not be an unconditional open, and must close nothing else.
    expect(app).toMatch(
      /shouldRouteNoModelSetup\(\{[\s\S]{0,200}\}\)/,
    );
    // The old defective gate (length === 0 alone) is gone.
    expect(app).not.toContain(
      "if (!hasUsablePrimary && models.state.models.length === 0)",
    );
  });
});
