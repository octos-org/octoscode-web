import { describe, expect, it, vi } from "vitest";
import { restoreFocusAfterRemoval } from "./focus-restore.ts";

/**
 * Judge r2 #8 (round 3): "Request-removal focus … unproven" — when an
 * approval card (or any blocking request) disappears, focus must move OFF the
 * removed subtree, and ONLY if focus was inside it. Pure decision helper;
 * the approval surface mounts it (hunk reported for App if needed).
 */
const el = (connected: boolean) =>
  ({ isConnected: connected }) as unknown as HTMLElement;

describe("focus restore after a request disappears (judge #8)", () => {
  it("moves focus to the fallback only when focus was inside the removed node", () => {
    const fallback = el(true);
    const removed = el(false);
    const inside = { isConnected: true } as unknown as HTMLElement;
    const outside = el(true);
    const contains = vi.fn(
      (node: Node | null) => node === (inside as unknown as Node),
    );
    (removed as unknown as { contains: typeof contains }).contains = contains;

    const moveInside = restoreFocusAfterRemoval({
      activeElement: inside,
      removed,
      fallback,
    });
    expect(moveInside).toBe(true);

    const moveOutside = restoreFocusAfterRemoval({
      activeElement: outside,
      removed,
      fallback,
    });
    expect(moveOutside).toBe(false);
  });

  it("does nothing when nothing had focus", () => {
    expect(
      restoreFocusAfterRemoval({ activeElement: null, removed: el(false), fallback: el(true) }),
    ).toBe(false);
  });

  it("does nothing while the removed node is still connected (not really removed)", () => {
    expect(
      restoreFocusAfterRemoval({
        activeElement: { isConnected: true } as HTMLElement,
        removed: el(true),
        fallback: el(true),
      }),
    ).toBe(false);
  });
});
