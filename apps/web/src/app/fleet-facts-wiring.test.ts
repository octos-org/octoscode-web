import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Round 3 item 5 (judge #3): Fleet rows come from data-05's FleetFacts union
 * — inventory acceptance facts (title/model/elapsed/goal) ∪ roster live axis —
 * never slug-derived identity or zero-fill defaults.
 *
 * The union lives in `FleetPane`, the lazy boundary App mounts for the Fleet
 * destination, so the projections stay out of the shell's entry chunk. App
 * hands the pane the raw inputs it aggregates.
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const pane = readFileSync(
  new URL("../features/fleet/FleetPane.tsx", import.meta.url),
  "utf8",
);

describe("App renders data-05's FleetFacts union", () => {
  it("imports the aggregation + union projections", () => {
    expect(pane).toMatch(/from "\.\/fleet-facts\.ts"/);
    expect(pane).toContain("aggregateFleetFacts(");
    expect(pane).toContain("unionFleetFacts(");
  });

  it("aggregates the walked session inventories (operations, not rows)", () => {
    expect(pane).toContain("aggregateFleetFacts(");
    expect(pane).toMatch(/sessionId: ref\.sessionId/);
    expect(pane).toContain("driverInventory");
    // App supplies the walked inventory the aggregation reads.
    expect(app).toMatch(/driverInventory=\{session\.driverInventory\}/);
  });

  it("unions the aggregated facts with the peer manager's roster", () => {
    expect(pane).toContain("unionFleetFacts(");
    expect(pane).toMatch(/rosters:/);
    expect(pane).toMatch(/identity: peer\.identity/);
    // App supplies the roster the union reads.
    expect(app).toMatch(/rosterSource=\{peers\.manager\}/);
  });

  it("threads the union rows into the FleetView mount", () => {
    const mount = pane.indexOf("<FleetView\n");
    const region = pane.slice(mount, mount + 900);
    expect(region).toMatch(/\{ fleetPeers \}/);
    expect(pane).toContain("fleetRosterFromUnion(");
  });
});
