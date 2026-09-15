import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Alt+A "show approval" (reference-TUI keymap.rs:1). App.tsx reads `window` at
 * module scope, so it cannot be imported under node (apps/web has no jsdom) —
 * the same source-level discipline as peer-approval-wiring.test.ts.
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("Alt+A reveals the oldest pending approval of the active Session", () => {
  it("routes the window keydown through the registry keyboard-parity matcher", () => {
    expect(app).toContain("matchKeyboardParityShortcut(event)");
    expect(app).toContain('window.addEventListener("keydown"');
  });

  it("focuses the mounted ApprovalPanel dialog", () => {
    expect(app).toContain('aria-labelledby="approval-title"');
  });

  it("announces the no-op through an aria-live hint when none is pending", () => {
    expect(app).toContain('role="status" aria-live="polite"');
  });
});