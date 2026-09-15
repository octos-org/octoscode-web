import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * §8 shortcut suppression wiring: Alt+A / Alt+P / Alt+D must never fire while
 * focus is inside an input, textarea, select, contenteditable or a dialog.
 * ux-copy-03 owns the predicate; App (this file's subject) owns the three
 * window keydown handlers that must consult it. Source-level assertions
 * (App.tsx reads `window` at module scope, so it cannot be imported under
 * node — the same discipline as show-approval-key.test.ts).
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("App suppresses parity shortcuts inside text entry and dialogs (§8)", () => {
  it("imports the co-owner DOM classifier", () => {
    expect(app).toContain("shortcutTargetSuppressed");
    expect(app).toMatch(
      /from "\.\.\/features\/composer\/shortcut-suppression\.ts"/,
    );
  });

  it("guards the show-approval (Alt+A) handler", () => {
    expect(app).toMatch(
      /id !== "show-approval"\)[\s\S]{0,400}shortcutTargetSuppressed/,
    );
  });

  it("guards the toggle-peer-dock (Alt+P) handler", () => {
    expect(app).toMatch(
      /id === "toggle-peer-dock"[\s\S]{0,400}shortcutTargetSuppressed/,
    );
  });

  it("guards the focus-dispatch (Alt+D → Fleet Brief) handler", () => {
    expect(app).toMatch(
      /id !== "focus-dispatch"[\s\S]{0,400}shortcutTargetSuppressed/,
    );
  });

  it("treats a suppressed event as a no-op before any preventDefault or focus", () => {
    // The guard must return BEFORE the handler's preventDefault/focus work:
    // a suppressed chord belongs to the text control or dialog, never to us.
    const guardCount = (
      app.match(/if \(shortcutTargetSuppressed\(event\.target\)\) return;/g) ??
      []
    ).length;
    expect(guardCount).toBeGreaterThanOrEqual(3);
  });
});
