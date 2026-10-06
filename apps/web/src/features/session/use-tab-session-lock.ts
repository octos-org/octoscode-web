import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createTabLockController,
  type TabLockState,
} from "./tab-session-lock-core.ts";

/**
 * React wrapper over the cross-tab session lock controller (#56, first
 * slice). State machine lives in tab-session-lock-core.ts (unit-tested
 * there); this hook only binds it to the component lifecycle.
 *
 * This slice is advisory only: it drives the takeover banner. It does
 * not gate sending.
 */
export function useTabSessionLock(sessionKey: string | null) {
  // Optimistic: the common single-tab case shows no banner while the
  // availability check is in flight.
  const [state, setState] = useState<TabLockState>({ kind: "owner" });

  const controller = useMemo(
    () =>
      "locks" in navigator
        ? createTabLockController(setState, (name, options, callback) =>
            navigator.locks.request(name, options, callback),
          )
        : null,
    [],
  );

  useEffect(() => {
    if (controller === null) {
      setState({ kind: "unsupported" });
      return;
    }
    if (sessionKey === null) {
      setState({ kind: "unsupported" });
      return;
    }
    controller.acquire(sessionKey, false);
    return () => controller.dispose();
  }, [controller, sessionKey]);

  const takeOver = useCallback(() => {
    if (sessionKey !== null && controller !== null) {
      controller.acquire(sessionKey, true);
    }
  }, [controller, sessionKey]);

  return { state, takeOver };
}
