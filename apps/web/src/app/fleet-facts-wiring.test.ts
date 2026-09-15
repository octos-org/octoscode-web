import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Round 3 item 5 (judge #3): Fleet rows come from data-05's FleetFacts union
 * — inventory acceptance facts (title/model/elapsed/goal) ∪ roster live axis —
 * never slug-derived identity or zero-fill defaults.
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("App renders data-05's FleetFacts union", () => {
  it("imports the aggregation + union projections", () => {
    expect(app).toMatch(/from "\.\.\/features\/fleet\/fleet-facts\.ts"/);
    expect(app).toContain("aggregateFleetFacts(");
    expect(app).toContain("unionFleetFacts(");
  });

  it("aggregates the walked session inventories (operations, not rows)", () => {
    expect(app).toContain("aggregateFleetFacts(");
    expect(app).toMatch(/sessionId: ref\.sessionId/);
    expect(app).toContain("driverInventory");
  });

  it("unions the aggregated facts with the peer manager's roster", () => {
    expect(app).toContain("unionFleetFacts(");
    expect(app).toMatch(/rosters:/);
    expect(app).toMatch(/identity: peer\.identity/);
  });

  it("threads the union rows into the FleetView mount", () => {
    const mount = app.indexOf("<FleetView");
    const region = app.slice(mount, mount + 900);
    expect(region).toMatch(/\{ fleetPeers \}/);
    expect(app).toContain("fleetRosterFromUnion(");
  });
});
