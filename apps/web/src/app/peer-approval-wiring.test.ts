import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Gap 6b: the roster approval sink must actually REACH the sidebar. The hook
 * exposes `peers.approvalRespond` and ProductSidebar/PeerDock already thread
 * `onApprovalRespond`, but without the App prop hunk the dock never receives
 * it and every row action stays unmounted (the same dead-seat class of bug the
 * control seat had). Source-level assertion: App.tsx reads `window` at module
 * scope, so it cannot be imported under node (apps/web has no jsdom).
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("App threads the peer approval sink to ProductSidebar", () => {
  it("passes peers.approvalRespond as the onApprovalRespond prop", () => {
    expect(app).toContain("onApprovalRespond={peers.approvalRespond}");
  });

  it("keeps passing the peer dock manager alongside it", () => {
    expect(app).toContain("peerDock={peers.manager}");
  });
});
