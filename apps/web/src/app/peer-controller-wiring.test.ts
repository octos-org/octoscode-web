import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * P2b (grant 2855), updated for the strip+pane structure (UX program goal 1):
 * the peer controller console must still REACH the product — now mounted in
 * the session configuration pane's Advanced section instead of the removed
 * composer bar. Source-level assertion: App.tsx reads `window` at module
 * scope, so it cannot be imported under node.
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("App threads the peer controller console into the pane", () => {
  it("forwards session.peerController to the pane's Advanced section", () => {
    expect(app).toContain("session.peerController");
  });

  it("keeps the driver seat beside the console in Advanced", () => {
    expect(app).toContain("session.peerControl");
    expect(app).toContain("session.driverInventory");
  });

  it("hands the console NO staging inputs (it owns lane/brief/title)", () => {
    const pane = app.slice(app.indexOf("<SessionConfigPane"));
    const callSite = pane.slice(0, pane.indexOf("</SessionConfigPane>"));
    expect(callSite).not.toContain("lane=");
    expect(callSite).not.toContain("brief=");
    expect(callSite).not.toContain("title=");
  });
});