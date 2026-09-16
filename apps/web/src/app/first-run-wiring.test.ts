import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * §4.4 / §5.1 App-level wiring: defaults applied at CREATION only, the
 * workspace_root first-entry capture, and the "No chat model is set up"
 * routing. Source-level assertions (App.tsx reads `window` at module scope).
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("App applies new-session defaults at creation only (§4.4, case 22)", () => {
  it("threads the sandbox into session open at creation", () => {
    expect(app).toContain("openSessionWithDefaults");
  });

  it("applies the permission default once, right after creation", () => {
    // One permission/profile/set through the shared client seam, gated on the
    // creation marker.
    expect(app).toContain("applyPermissionDefault");
    expect(app).toContain("setPermissionProfile");
  });

  it("never re-applies defaults when reopening an existing session", () => {
    // The guard must key on session CREATION, not selection/restore: App must
    // mint a fresh session id ONLY in the create path and gate the defaults
    // apply on that same path.
    expect(app).toContain("freshWebSessionId()");
    expect(app).toContain("appliedDefaultsForSession");
  });
});

describe("App captures opened.workspace_root for the picker entry (§5.1)", () => {
  it("feeds the server working directory entry from the open result", () => {
    expect(app).toContain("serverWorkingDirectory");
  });
});

describe("App routes 'No chat model is set up' to Settings › Providers (§5.1)", () => {
  it("checks the profile model list after connecting", () => {
    // Hotfix run 21: routing is decided by the settled-evidence gate, never by
    // an unsettled/never-started fetch (the picker stays the default surface).
    expect(app).toContain("shouldRouteNoModelSetup");
    expect(app).toContain('setSettingsSection("models")');
    expect(app).toContain("modelsFetchStarted");
  });
});
