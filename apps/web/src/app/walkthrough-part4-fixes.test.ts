import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Walkthrough 4200 Part-4 defects (App-level). Source-level assertions
 * (App.tsx reads `window` at module scope — same discipline as
 * show-approval-key.test.ts).
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const pane = readFileSync(
  new URL("../features/session-config/SessionConfigPane.tsx", import.meta.url),
  "utf8",
);

describe("(1) Fleet is a ROUTED destination that replaces the chat pane", () => {
  it("renders Fleet INSTEAD of the conversation section, not appended below", () => {
    // Round 2 (judge #1) + 4200b: BOTH panes stay mounted and the inactive
    // one hides via the `hidden` attribute. The Fleet pane additionally
    // requires an OPEN session (pre-session it hides entirely; the nav entry
    // still routes there and shows the empty state inside).
    expect(app).toMatch(/hidden=\{fleetRouteActive\}/);
    expect(app).toMatch(/hidden=\{!\(fleetRouteActive && session\.opened\)\}/);
    // And neither <FleetView> nor the chat pane is appended after </main>.
    const mainEnd = app.indexOf("</main>");
    expect(app.slice(mainEnd)).not.toContain("<FleetView");
  });

  it("carries a Back control returning to the previously selected session", () => {
    expect(app).toContain("onBackFromFleet");
  });

  it("activating Fleet closes the settings dialog (one destination at a time)", () => {
    expect(app).toMatch(/setFleetRouteActive\(true\)[\s\S]{0,80}setSettingsOpen\(false\)/);
  });
});

describe("(2) The picker's first entry exists on a FRESH profile", () => {
  it("always projects a Server's working directory entry when a session is open", () => {
    // The derivation must not depend on recents/known sessions; a fresh
    // profile with an open session still yields the entry (possibly the
    // "(path not reported)" variant).
    expect(app).toMatch(/const serverWorkingDirectory =/);
    expect(app).toContain("serverWorkingDirectoryEntry");
  });

  it("threads it to both picker mounts", () => {
    const mounts = app.match(/\{\.\.\.\(serverWorkingDirectory/g) ?? [];
    expect(mounts.length).toBeGreaterThanOrEqual(2);
  });
});

describe("(3) The pane's Advanced expander opens reliably", () => {
  it("is a native details/summary with a data hook and open passthrough", () => {
    expect(pane).toMatch(/<details[^>]*data-session-config-advanced="true"/);
    expect(pane).toMatch(/<summary[^>]*data-session-config-advanced-summary="true"/);
  });

  it("keeps the remembered-collapsed default closed but keyboard operable", () => {
    expect(pane).toMatch(/advancedOpen = false/);
    expect(pane).toContain("onAdvancedOpenChange");
  });
});

describe("(4) Handover copy reaches the strip and the pane", () => {
  it("the strip's third segment shows the foreign-holder words (already the external-held state)", () => {
    expect(app).toContain("{ kind: \"external-held\" }");
  });

  it("the pane's Advanced renders the Resume chat control bound to the seam", () => {
    expect(app).toContain("RESUME_CHAT_LABEL");
    expect(app).toContain("resumeChatSend");
  });

  it("the strip surfaces the handover status while a resume runs", () => {
    expect(app).toContain("conversation.seatHandover");
  });
});
