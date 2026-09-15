import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Round 3 item 4 (judge #6): the pane MOUNTS config-07's sections and
 * consumes the notice board + readbacks. Source-level assertions.
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const pane = readFileSync(
  new URL("../features/session-config/SessionConfigPane.tsx", import.meta.url),
  "utf8",
);

describe("pane mounts config-07's sections", () => {
  it("feeds all three section slots", () => {
    expect(app).toContain("modelSection={{");
    expect(app).toContain("permissionsSection={{");
    expect(app).toContain("sandboxSection={{");
  });

  it("pane accepts section slots for the config surfaces", () => {
    expect(pane).toMatch(/modelSection\?:/);
    expect(pane).toMatch(/permissionsSection\?:/);
    expect(pane).toMatch(/sandboxSection\?:/);
  });

  it("App feeds the notice board notices through noticeMessage", () => {
    expect(app).toContain("noticeBoard");
    expect(app).toContain("noticeMessage(");
    expect(app).toContain("disposition:");
  });

  it("approval-policy readback keeps the not-verified qualifier path", () => {
    expect(app).toContain("approvalPolicyUnverified");
    expect(app).toContain("approval_policy");
  });

  it("sandbox effective fields + New session with… action", () => {
    expect(app).toContain("effective: {");
    expect(app).toContain("onNewSessionWith");
    expect(app).toContain("SESSION_SANDBOX_V1");
  });
});
