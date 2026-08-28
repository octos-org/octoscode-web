import { describe, expect, it } from "vitest";
import { PendingNavigationIntentController } from "./pending-navigation-intent.ts";

interface NavigationIntent {
  sessionId: string;
}

describe("PendingNavigationIntentController", () => {
  it("latches one click during dispatch and releases it exactly once on ACK", () => {
    const controller =
      new PendingNavigationIntentController<NavigationIntent>();
    const lease = controller.beginDispatch("transport-1:session-a", "turn-a");
    const intent = { sessionId: "session-b" };

    expect(controller.request(intent)).toEqual({
      kind: "deferred",
      lease,
      stage: "dispatch",
      replacedIntent: null,
    });
    expect(controller.acceptDispatch(lease)).toEqual({ intent, lease });
    expect(controller.acceptDispatch(lease)).toBeNull();
    expect(controller.snapshot()).toEqual({
      authorityKey: "transport-1:session-a",
      dispatch: null,
      intent: null,
      stage: null,
    });
  });

  it("runs navigation immediately when no start is dispatching", () => {
    const controller =
      new PendingNavigationIntentController<NavigationIntent>();
    const intent = { sessionId: "session-b" };

    expect(controller.request(intent)).toEqual({ kind: "run-now", intent });
    expect(controller.snapshot()).toEqual({
      authorityKey: null,
      dispatch: null,
      intent: null,
      stage: null,
    });
  });

  it("uses an explicit latest-wins policy for repeated clicks", () => {
    const controller =
      new PendingNavigationIntentController<NavigationIntent>();
    const lease = controller.beginDispatch("transport-1:session-a", "turn-a");
    const first = { sessionId: "session-b" };
    const latest = { sessionId: "session-c" };

    expect(controller.request(first)).toMatchObject({
      kind: "deferred",
      replacedIntent: null,
    });
    expect(controller.request(latest)).toEqual({
      kind: "deferred",
      lease,
      stage: "dispatch",
      replacedIntent: first,
    });
    expect(controller.acceptDispatch(lease)).toEqual({
      intent: latest,
      lease,
    });
  });

  it.each(["rejectDispatch", "cancelDispatch"] as const)(
    "clears a deferred intent when %s retires its start",
    (retire) => {
      const controller =
        new PendingNavigationIntentController<NavigationIntent>();
      const lease = controller.beginDispatch("transport-1:session-a", "turn-a");
      controller.request({ sessionId: "session-b" });

      expect(controller[retire](lease)).toBe(true);
      expect(controller.acceptDispatch(lease)).toBeNull();
      expect(controller.snapshot().intent).toBeNull();
      expect(controller.request({ sessionId: "session-c" }).kind).toBe(
        "run-now",
      );
    },
  );

  it("clears dispatch and intent when transport/session authority changes", () => {
    const controller =
      new PendingNavigationIntentController<NavigationIntent>();
    const stale = controller.beginDispatch("transport-1:session-a", "turn-a");
    controller.request({ sessionId: "session-b" });

    controller.setAuthority("transport-2:session-a");

    expect(controller.snapshot()).toEqual({
      authorityKey: "transport-2:session-a",
      dispatch: null,
      intent: null,
      stage: null,
    });
    expect(controller.acceptDispatch(stale)).toBeNull();
  });

  it("cancels only the queued navigation without weakening the dispatch gate", () => {
    const controller =
      new PendingNavigationIntentController<NavigationIntent>();
    const lease = controller.beginDispatch("transport-1:session-a", "turn-a");
    const intent = { sessionId: "session-b" };
    controller.request(intent);

    expect(controller.cancelIntent()).toEqual(intent);
    expect(controller.snapshot()).toEqual({
      authorityKey: "transport-1:session-a",
      dispatch: lease,
      intent: null,
      stage: null,
    });
    expect(controller.request({ sessionId: "session-c" }).kind).toBe(
      "deferred",
    );
  });

  it("keeps state when the same authority is published again", () => {
    const controller =
      new PendingNavigationIntentController<NavigationIntent>();
    const lease = controller.beginDispatch("transport-1:session-a", "turn-a");
    const intent = { sessionId: "session-b" };
    controller.request(intent);

    controller.setAuthority("transport-1:session-a");

    expect(controller.acceptDispatch(lease)).toEqual({ intent, lease });
  });

  it("does not let an older completion release or clear a newer intent", () => {
    const controller =
      new PendingNavigationIntentController<NavigationIntent>();
    const stale = controller.beginDispatch("transport-1:session-a", "turn-a");
    controller.request({ sessionId: "session-b" });
    const current = controller.beginDispatch("transport-1:session-a", "turn-c");
    const latest = { sessionId: "session-d" };
    controller.request(latest);

    expect(controller.acceptDispatch(stale)).toBeNull();
    expect(controller.rejectDispatch(stale)).toBe(false);
    expect(controller.snapshot()).toEqual({
      authorityKey: "transport-1:session-a",
      dispatch: current,
      intent: latest,
      stage: "dispatch",
    });
    expect(controller.acceptDispatch(current)).toEqual({
      intent: latest,
      lease: current,
    });
  });

  it("invalidates every completion on reset", () => {
    const controller =
      new PendingNavigationIntentController<NavigationIntent>();
    const stale = controller.beginDispatch("transport-1:session-a", "turn-a");
    controller.request({ sessionId: "session-b" });

    controller.reset();

    expect(controller.snapshot()).toEqual({
      authorityKey: null,
      dispatch: null,
      intent: null,
      stage: null,
    });
    expect(controller.acceptDispatch(stale)).toBeNull();
  });

  it("fails closed when a dispatch has no authority or turn identity", () => {
    const controller =
      new PendingNavigationIntentController<NavigationIntent>();

    expect(() => controller.beginDispatch("", "turn-a")).toThrow(
      "Navigation authority is required",
    );
    expect(() => controller.beginDispatch("transport-1:session-a", "")).toThrow(
      "Turn id is required",
    );
  });

  it("keeps an accepted intent authority-scoped until recovery is ready", () => {
    const controller =
      new PendingNavigationIntentController<NavigationIntent>();
    const lease = controller.beginDispatch("transport-1:session-a", "turn-a");
    const first = { sessionId: "session-b" };
    controller.request(first);
    const released = controller.acceptDispatch(lease);
    if (!released) throw new Error("Expected the deferred intent");

    expect(controller.holdUntilReady(released)).toBe(true);
    expect(controller.snapshot()).toEqual({
      authorityKey: "transport-1:session-a",
      dispatch: null,
      intent: first,
      stage: "ready",
    });
    expect(controller.releaseReady("transport-2:session-a")).toBeNull();
    expect(controller.releaseReady("transport-1:session-a")).toEqual(released);
    expect(controller.releaseReady("transport-1:session-a")).toBeNull();
  });

  it("keeps latest-wins while recovery is becoming ready", () => {
    const controller =
      new PendingNavigationIntentController<NavigationIntent>();
    const lease = controller.beginDispatch("transport-1:session-a", "turn-a");
    const first = { sessionId: "session-b" };
    controller.request(first);
    const released = controller.acceptDispatch(lease);
    if (!released) throw new Error("Expected the deferred intent");
    controller.holdUntilReady(released);
    const latest = { sessionId: "session-c" };

    expect(controller.request(latest)).toEqual({
      kind: "deferred",
      lease,
      stage: "ready",
      replacedIntent: first,
    });
    expect(controller.releaseReady("transport-1:session-a")).toEqual({
      intent: latest,
      lease,
    });
  });

  it("returns a recovery-held intent when authority changes", () => {
    const controller =
      new PendingNavigationIntentController<NavigationIntent>();
    const lease = controller.beginDispatch("transport-1:session-a", "turn-a");
    const intent = { sessionId: "session-b" };
    controller.request(intent);
    const released = controller.acceptDispatch(lease);
    if (!released) throw new Error("Expected the deferred intent");
    controller.holdUntilReady(released);

    expect(controller.setAuthority("transport-2:session-a")).toEqual(intent);
    expect(controller.snapshot()).toEqual({
      authorityKey: "transport-2:session-a",
      dispatch: null,
      intent: null,
      stage: null,
    });
  });
});
