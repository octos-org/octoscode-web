import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Alt+D focus routing. Program WEB-UX-CONTROLLER-2800 §3 bound it to the peer
 * controller console's Dispatch button; WEB-UX-DESIGN-4000 §8 (binding, later
 * program) retargets the SAME physical chord: Alt+D navigates to Fleet and
 * focuses the Start form's Brief field. App.tsx reads `window` at module
 * scope, so it cannot be imported under node (apps/web has no jsdom) — the
 * same source-level discipline as show-approval-key.test.ts.
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("Alt+D navigates to Fleet and focuses its Brief field", () => {
  it("routes the window keydown through the registry parity matcher", () => {
    expect(app).toContain(
      'matchKeyboardParityShortcut(event)?.id !== "focus-dispatch"',
    );
    expect(app).toContain('window.addEventListener("keydown"');
  });

  it("targets the Fleet view's Brief field and activates the route", () => {
    expect(app).toContain('[data-fleet-field="brief"]');
    expect(app).toContain("setFleetRouteActive(true)");
  });
});
