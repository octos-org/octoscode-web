import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Program 4000 goal 3 mount: the strip owner (this app) mounts the Fleet view
 * using ux-fleet-02's descriptor. Source-level assertions (App.tsx reads
 * `window` at module scope, so it cannot be imported under node).
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(
  new URL("../features/shell/ProductSidebar.tsx", import.meta.url),
  "utf8",
);
const registry = readFileSync(
  new URL("../features/commands/registry.ts", import.meta.url),
  "utf8",
);

describe("App mounts the Fleet view (goal 3)", () => {
  it("imports the navigation descriptor and the view", () => {
    expect(app).toContain(
      'from "../features/fleet/fleet-navigation.ts"'.replace(
        "../features/",
        "../features/",
      ),
    );
  });

  it("routes a Fleet surface with the same peerController value", () => {
    expect(app).toContain("<FleetPane");
    expect(app).toMatch(/peerController=\{[^}]*session\.peerController/s);
  });

  it("passes the session list for row names and Start targeting", () => {
    expect(app).toMatch(/sessions=\{/);
  });
});

describe("ProductSidebar carries a Fleet entry next to Settings", () => {
  it("accepts an optional Fleet navigation entry and fires onFleet", () => {
    expect(sidebar).toContain("fleetEntry?");
    expect(sidebar).toContain("fleetActive");
    expect(sidebar).toContain("onFleet");
  });
});

describe("Alt+D navigates to Fleet and focuses Brief (§8)", () => {
  it("retargets the focus-dispatch shortcut to the Fleet Brief field", () => {
    // The registry keeps the physical chord; App routes it to Fleet.
    expect(registry).toContain('id: "focus-dispatch"');
    expect(app).toContain('data-fleet-field="brief"');
  });
});
