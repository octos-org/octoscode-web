/**
 * Cross-tab session ownership state machine (#56, first slice).
 *
 * Pure controller over the Web Locks API so the generation-guard logic is
 * unit-testable without React or jsdom (repo has neither). The hook in
 * use-tab-session-lock.ts is a thin React wrapper.
 *
 * Contract with navigator.locks.request(name, options, callback):
 * - callback(null)                 → lock not available (ifAvailable)
 * - callback(handle) → Promise     → we hold the lock until the promise
 *   resolves; it also resolves when another tab STEALS the lock.
 */

export type TabLockState =
  /** Web Locks API unavailable (older browser / non-secure context). */
  | { kind: "unsupported" }
  /** This tab holds the session lock. */
  | { kind: "owner" }
  /** Another tab holds the lock (or took it from us). */
  | { kind: "held-elsewhere" };

/** Sessions are scoped per server endpoint; the caller bakes it into the key. */
export function tabLockName(sessionKey: string): string {
  return `octoscode-web:session:${sessionKey}`;
}

/** Minimal structural type for the browser Lock handle we receive. */
export interface LockHandleLike {
  readonly name: string;
}

export interface LocksRequestLike {
  (
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean },
    callback: (lock: LockHandleLike | null) => Promise<void> | void,
  ): Promise<unknown>;
}

export function createTabLockController(
  setState: (state: TabLockState) => void,
  request: LocksRequestLike,
) {
  let generation = 0;
  let release: (() => void) | null = null;

  const acquire = (key: string, steal: boolean): void => {
    const mine = ++generation;
    let voluntary = false;
    const options: { ifAvailable?: boolean; steal?: boolean } = steal
      ? { steal: true }
      : { ifAvailable: true };
    request(tabLockName(key), options, (lock): Promise<void> => {
      if (lock === null) {
        if (mine === generation) setState({ kind: "held-elsewhere" });
        // The outer .then() must stay quiet: the unavailability was
        // already reported directly.
        voluntary = true;
        return Promise.resolve();
      }
      if (mine === generation) setState({ kind: "owner" });
      // Hold the lock until dispose() marks a voluntary release. A steal
      // from another tab resolves the OUTER request promise (per spec),
      // leaving this held promise pending — which is how we tell the
      // two apart.
      return new Promise<void>((resolve) => {
        release = () => {
          voluntary = true;
          resolve();
        };
      });
    })
      .then(() => {
        release = null;
        // Settles on voluntary release (voluntary=true) or on a steal by
        // another tab (voluntary=false). A stale generation means we
        // already switched sessions — stay quiet.
        if (!voluntary && mine === generation) {
          setState({ kind: "held-elsewhere" });
        }
      })
      .catch(() => {
        // A steal rejected by the release cooldown, or the request
        // rejected: treat as not-ours until a later attempt succeeds.
        if (mine === generation) setState({ kind: "held-elsewhere" });
      });
  };

  return {
    acquire,
    /** Called by the hook on unmount/session switch. */
    dispose(): void {
      generation++;
      release?.();
      release = null;
    },
  };
}
