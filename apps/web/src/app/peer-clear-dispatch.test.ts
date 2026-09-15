import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `/peer clear` end-to-end dispatch (reference-TUI parity 2500 §2). The 2520
 * landing made the prune (`clearFinished`) and the copy (`peerClearAnnouncement`)
 * pure and unit-proven, but the App `peers` case still opened the dialog, so the
 * prune was unreachable from the composer. This pins the ONE App hunk that wires
 * it: `intent.clear` prunes the ACTIVE record's roster and announces the count
 * through a live region instead of opening the dialog.
 *
 * App.tsx reads `window` at module scope (apps/web has no jsdom), so it cannot be
 * imported under node — the same source-level discipline as
 * show-approval-key.test.ts / peer-approval-wiring.test.ts.
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("App dispatches /peer clear to the active record's prune", () => {
  it("branches on intent.clear inside the peers case", () => {
    expect(app).toContain("intent.clear");
  });

  it("prunes the active record through the coordinator, not the dialog", () => {
    // `peers.clearFinished()` is `peerCoordinator.clearFinished(activeRecord)`
    // (use-octos-session) — the ACTIVE record's binding only, fail-closed 0 for
    // a foreign/unbound record.
    expect(app).toContain("peers.clearFinished()");
  });

  it("announces the count through the shared copy helper", () => {
    expect(app).toContain("peerClearAnnouncement(");
  });

  it("surfaces the announcement through a live region", () => {
    expect(app).toContain("peerClearHint");
    expect(app).toContain('role="status" aria-live="polite"');
  });
});
