import { describe, expect, it, vi } from "vitest";
import {
  createTabLockController,
  tabLockName,
  type LockHandleLike,
} from "./tab-session-lock-core.ts";

/**
 * Hand-rolled navigator.locks shim. Holds are tracked per name; the
 * stored resolve() simulates both voluntary release and a steal from
 * another tab (which resolves the holder's pending request).
 */
function installShim() {
  const holds = new Map<string, () => void>();
  const request = vi.fn(
    (
      name: string,
      options: { ifAvailable?: boolean; steal?: boolean },
      callback: (lock: LockHandleLike | null) => Promise<void> | void,
    ): Promise<unknown> => {
      if (options.steal) {
        holds.get(name)?.();
        holds.delete(name);
      } else if (holds.has(name)) {
        // ifAvailable and already held elsewhere.
        return Promise.resolve(callback(null));
      }
      return new Promise<void>((resolve) => {
        const handle: LockHandleLike = { name };
        // The real API invokes the callback immediately upon acquisition.
        const outcome = callback(handle);
        const releaseOnce = () => {
          if (!holds.has(name)) return;
          holds.delete(name);
          resolve();
        };
        holds.set(name, releaseOnce);
        if (outcome && typeof outcome.then === "function") {
          void outcome.then(releaseOnce, releaseOnce);
        } else {
          releaseOnce();
        }
      });
    },
  );
  return {
    request,
    holds,
    stealFrom: (name: string) => {
      holds.get(name)?.();
      holds.delete(name);
    },
    releaseVia: (name: string) => {
      holds.get(name)?.();
    },
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("tab-session-lock-core", () => {
  it("derives stable lock names from the session key", () => {
    expect(tabLockName("coding:local:main")).toBe(
      "octoscode-web:session:coding:local:main",
    );
  });

  it("reports held-elsewhere when the lock is already taken", async () => {
    const shim = installShim();
    const states: string[] = [];
    const controller = createTabLockController(
      (state) => states.push(state.kind),
      shim.request,
    );
    const key = "coding:local:main";
    // Simulate another tab holding it first.
    void shim.request(tabLockName(key), {}, async () => new Promise(() => {}));

    controller.acquire(key, false);
    await flush();
    expect(states).toEqual(["held-elsewhere"]);
  });

  it("becomes owner on a free lock, flips on steal, ignores stale release", async () => {
    const shim = installShim();
    const states: string[] = [];
    const controller = createTabLockController(
      (state) => states.push(state.kind),
      shim.request,
    );
    const key = "coding:local:other";

    controller.acquire(key, false);
    await flush();
    expect(states).toEqual(["owner"]);

    // Another tab steals → our hold resolves with generation current.
    shim.stealFrom(tabLockName(key));
    await flush();
    expect(states).toEqual(["owner", "held-elsewhere"]);

    // dispose() bumps the generation: the trailing release must not
    // push a second (stale) held-elsewhere state.
    controller.dispose();
    await flush();
    expect(states).toEqual(["owner", "held-elsewhere"]);
  });

  it(" voluntary release followed by dispose stays quiet", async () => {
    const shim = installShim();
    const states: string[] = [];
    const controller = createTabLockController(
      (state) => states.push(state.kind),
      shim.request,
    );
    const key = "coding:local:quiet";

    controller.acquire(key, false);
    await flush();
    expect(shim.holds.has(tabLockName(key))).toBe(true);

    // Session switch: dispose releases; no flip-to-elsewhere is emitted.
    controller.dispose();
    await flush();
    expect(shim.holds.has(tabLockName(key))).toBe(false);
    expect(states).toEqual(["owner"]);
  });
});
