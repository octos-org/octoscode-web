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

/**
 * One §8 window keydown handler, sliced from its shortcut-matcher line to the
 * `window.addEventListener` that registers it.
 */
function handlerBody(matcher: RegExp): string {
  const start = app.search(matcher);
  if (start < 0) throw new Error(`no handler matched ${String(matcher)}`);
  const rest = app.slice(start);
  const end = rest.indexOf("window.addEventListener");
  if (end <= 0) throw new Error(`no registration after ${String(matcher)}`);
  return rest.slice(0, end);
}

describe("App suppresses parity shortcuts inside text entry and dialogs (§8)", () => {
  it("imports the co-owner DOM classifier", () => {
    expect(app).toContain("shortcutTargetSuppressed");
    expect(app).toMatch(
      /from "\.\.\/features\/composer\/shortcut-suppression\.ts"/,
    );
  });

  it("guards the show-approval (Alt+A) handler", () => {
    // Alt+A keeps the TEXT half unconditionally; the DIALOG half is waived
    // only for the approval surface itself, which is this chord's own target
    // (re-revealing it is not "stealing" a chord another dialog owns).
    const body = handlerBody(/id !== "show-approval"/);
    expect(body).toMatch(/shortcutTargetIsTextInput\(event\.target\)\) return;/);
    expect(body).toMatch(/shortcutTargetSuppressed\(event\.target\)\) return;/);
    expect(body).toMatch(/insideApproval/);
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
    // Asserted per handler on the ORDER of the guard and the first side
    // effect, so a handler may read the DOM first (Alt+A resolves its own
    // target surface) without weakening the rule.
    for (const matcher of [
      /id !== "show-approval"/,
      /id === "toggle-peer-dock"/,
      /id !== "focus-dispatch"/,
    ]) {
      const body = handlerBody(matcher);
      const guard = body.search(
        /shortcutTarget(?:IsTextInput|Suppressed)\(event\.target\)\) return;/,
      );
      expect(guard).toBeGreaterThanOrEqual(0);
      const effect = body.search(/preventDefault\(\)|\.focus\(\)/);
      expect(effect).toBeGreaterThanOrEqual(0);
      expect(guard).toBeLessThan(effect);
    }
  });
});
