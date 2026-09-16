import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 4200c additions (10.png): (a) the Fleet pane sat in the SIDEBAR column —
 * CSS `display:grid` on .conversation overrides the UA `hidden` attribute, so
 * the "hidden" pane still took a grid cell (240px) while chat filled the main
 * slot. (b) The Start form's Session selector is empty on the live Core: App
 * passed the workspace-prefixed product key where the raw session id belongs.
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("(a) Fleet pane occupies the MAIN content slot, never the sidebar", () => {
  it("moves the pane after the chat section inside the same grid area", () => {
    // Both .conversation sections must sit as grid children of .workspace-grid
    // in order (chat first, fleet second) — the pane replaces the main slot.
    const chat = app.indexOf(
      '<section className="conversation" hidden={fleetRouteActive}>',
    );
    const fleet = app.indexOf("hidden={!(fleetRouteActive && session.opened)}");
    expect(chat).toBeGreaterThan(-1);
    expect(fleet).toBeGreaterThan(chat);
  });

  it("styles .conversation so the UA hidden attribute actually hides it", () => {
    // The bug: .conversation { display: grid } beats [hidden]. The rule must
    // yield to hidden (either via :not([hidden]) scoping or an explicit
    // .conversation[hidden] override).
    const yields =
      /\.conversation\s*\{\s*display:\s*grid/.test(styles) === false ||
      /\.conversation\[hidden\]/.test(styles);
    expect(yields).toBe(true);
    expect(styles).toMatch(/\.conversation\[hidden\]\s*\{/);
  });

  it("keeps the sidebar free of the fleet pane", () => {
    const sidebarEnd = app.indexOf("</aside>");
    expect(app.slice(0, sidebarEnd)).not.toContain(
      "aria-label={fleetNavigationEntry.label}",
    );
  });
});

describe("(b) Start form's Session selector defaults to the selected session", () => {
  it("passes the RAW session id, not the workspace-prefixed product key", () => {
    const mount = app.indexOf("<FleetPane");
    const region = app.slice(mount, mount + 1600);
    expect(region).toMatch(/selectedSessionId=\{/);
    expect(region).not.toMatch(/selectedSessionId=\{activeSessionKey\}/);
    expect(app).toContain("session.opened?.session_id");
  });
});
