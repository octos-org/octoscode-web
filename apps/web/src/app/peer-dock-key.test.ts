import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Alt+P toggles the PeerDock fold (reference-TUI event_loop.rs:1544-1551,
 * `peer_dock_collapsed`). The TUI's Ctrl+L alias is DROPPED on the web: Ctrl+L
 * is the browser's own location-bar focus on Chromium/Firefox/Safari, so the
 * binding would be swallowed by the UA. The fold is CONTROLLED — the shell owns
 * it and the dock only renders the state (PeerDock.tsx is untouched).
 *
 * App.tsx reads `window` at module scope (no jsdom), so this is a source-level
 * assertion, the same discipline as show-approval-key.test.ts.
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("Alt+P toggles the PeerDock fold", () => {
  it("routes the window keydown through the registry parity matcher", () => {
    expect(app).toContain(
      'matchKeyboardParityShortcut(event)?.id === "toggle-peer-dock"',
    );
  });

  it("flips the controlled dock fold in shell state", () => {
    expect(app).toContain("setPeerDockCollapsed");
    expect(app).toContain("peerDockCollapsed");
  });

  it("threads the fold to ProductSidebar, never into the dock itself", () => {
    expect(app).toContain("peerDockCollapsed={peerDockCollapsed}");
    expect(app).toContain("onPeerDockToggle=");
  });
});
