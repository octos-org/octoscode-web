import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * UX program goal 1: the chat window's composer footer carries ONE
 * read-only status strip; configuration lives in the pane. Source-level
 * assertion (App.tsx reads `window` at module scope, so it cannot be
 * imported under node — same discipline as session-control-seat-wiring).
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("App mounts the status strip and the configuration pane", () => {
  it("mounts SessionStatusStrip where the SessionControlBar was", () => {
    expect(app).toContain("<SessionStatusStrip");
    expect(app).toContain("onOpenPane={");
  });

  it("keeps every hook wiring the strip needs (permission, model, seat)", () => {
    expect(app).toContain("session.peerControl");
    expect(app).toContain("session.driverInventory");
    expect(app).toContain("permissionControl");
  });

  it("renders the pane open state next to the strip", () => {
    expect(app).toContain("<SessionConfigPane");
    expect(app).toContain("sessionConfigOpen");
  });

  it("no longer mounts the old SessionControlBar in the composer", () => {
    // Scope to the composer footer region: the design (§4.2 note, §9
    // "removed: the persistent SessionControlBar seats under the chat")
    // forbids the bar UNDER THE CHAT. The Advanced section may mount it
    // inside the pane (permitted by the Part-1 brief: "stays in the tree
    // only behind the pane's Advanced section"), so a whole-file absence
    // would be the wrong assertion.
    const composerStart = app.indexOf('<div className="composer-footer">');
    const composerEnd = app.indexOf("composer-actions", composerStart);
    const composerRegion = app.slice(
      composerStart,
      composerEnd === -1 ? undefined : composerEnd,
    );
    expect(composerRegion).not.toContain("<SessionControlBar");
  });
});