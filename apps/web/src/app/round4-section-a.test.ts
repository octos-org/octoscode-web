import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Round 4 A (walkthrough 4200d/08.png): the Fleet pane's wrapper section and
 * FleetView's own section BOTH carried the Fleet landmark (strict-mode a11y
 * break: 2 regions). The wrapper must be a plain div with NO aria-label; and
 * the Back button must be styled like the app's secondary buttons.
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const fleetView = readFileSync(
  new URL("../features/fleet/FleetView.tsx", import.meta.url),
  "utf8",
);

describe("(A) one Fleet landmark", () => {
  it("the wrapper is a non-landmark div with no Fleet aria-label", () => {
    expect(app).not.toMatch(/aria-label=\{fleetNavigationEntry\.label\}/);
    // The routed pane wrapper is a div now.
    expect(app).toMatch(
      /<div\s*\n?\s*className="conversation fleet-pane"\s*\n?\s*hidden=\{!\(fleetRouteActive && session\.opened\)\}/,
    );
  });

  it("FleetView keeps its section as the ONLY Fleet region", () => {
    expect(fleetView).toMatch(/<section[^>]*aria-label=\{t\("Fleet"\)\}/);
  });

  it("the Back button is styled as a secondary button, not raw native", () => {
    expect(styles).toMatch(/\.fleet-back\s*\{/);
    expect(styles).toMatch(/--dsw-alias-button-elevated-fill/);
    expect(app).toMatch(/className="fleet-back"/);
  });
});
