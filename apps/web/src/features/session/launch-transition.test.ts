import { describe, expect, it } from "vitest";
import { LaunchTransitionCoordinator } from "./launch-transition.ts";

interface Config {
  cwd: string;
  sessionId: string;
}

interface Decision {
  decision: "cross_profile" | "no_profile";
  profile: string | null;
}

describe("LaunchTransitionCoordinator", () => {
  it("owns the transition before resolve and rejects an older resolver", async () => {
    const coordinator = new LaunchTransitionCoordinator<Config, Decision>();
    const olderDecision = deferred<Decision>();
    const older = coordinator.begin(config("/srv/older"));
    const stalePublish = olderDecision.promise.then((decision) =>
      coordinator.rememberDecision(older, decision),
    );

    const newer = coordinator.begin(config("/srv/newer"));
    expect(coordinator.isCurrent(older)).toBe(false);
    expect(coordinator.isCurrent(newer)).toBe(true);

    olderDecision.resolve({ decision: "cross_profile", profile: "old" });
    await expect(stalePublish).resolves.toBe(false);
    expect(coordinator.current()).toEqual({
      lease: newer,
      config: config("/srv/newer"),
      decision: null,
    });
  });

  it("keeps the server decision available when candidate opening fails", () => {
    const coordinator = new LaunchTransitionCoordinator<Config, Decision>();
    const launchConfig = config("/srv/project");
    const decision: Decision = { decision: "no_profile", profile: null };
    const lease = coordinator.begin(launchConfig);

    expect(coordinator.rememberDecision(lease, decision)).toBe(true);

    // Entering an opening phase does not clear controller state. If candidate
    // open/hydrate fails, the UI can atomically restore this exact choice.
    expect(coordinator.restoreChoice(lease)).toEqual({
      config: launchConfig,
      decision,
    });
    expect(coordinator.isCurrent(lease)).toBe(true);
  });

  it("treats a falsy generic decision as remembered rather than absent", () => {
    const coordinator = new LaunchTransitionCoordinator<Config, false>();
    const launchConfig = config("/srv/falsy");
    const lease = coordinator.begin(launchConfig);

    expect(coordinator.rememberDecision(lease, false)).toBe(true);
    expect(coordinator.restoreChoice(lease)).toEqual({
      config: launchConfig,
      decision: false,
    });
  });

  it("does not let a stale candidate commit or restore over its successor", () => {
    const coordinator = new LaunchTransitionCoordinator<Config, Decision>();
    const older = coordinator.begin(config("/srv/older"));
    coordinator.rememberDecision(older, {
      decision: "cross_profile",
      profile: "review",
    });

    const newer = coordinator.begin(config("/srv/newer"));
    expect(coordinator.commit(older)).toBe(false);
    expect(coordinator.restoreChoice(older)).toBeNull();
    expect(coordinator.isCurrent(newer)).toBe(true);
  });

  it("retires a committed lease and invalidates every callback on cancel", () => {
    const coordinator = new LaunchTransitionCoordinator<Config, Decision>();
    const committed = coordinator.begin(config("/srv/commit"));
    expect(coordinator.commit(committed)).toBe(true);
    expect(coordinator.isCurrent(committed)).toBe(false);
    expect(coordinator.current()).toBeNull();

    const discarded = coordinator.begin(config("/srv/discard"));
    expect(coordinator.discard(discarded)).toBe(true);
    expect(coordinator.isCurrent(discarded)).toBe(false);

    const cancelled = coordinator.begin(config("/srv/cancel"));
    expect(coordinator.cancel()).toEqual({
      lease: cancelled,
      config: config("/srv/cancel"),
      decision: null,
    });
    expect(coordinator.isCurrent(cancelled)).toBe(false);
    expect(
      coordinator.rememberDecision(cancelled, {
        decision: "no_profile",
        profile: null,
      }),
    ).toBe(false);
  });
});

function config(cwd: string): Config {
  return { cwd, sessionId: `session:${cwd}` };
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
} {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return {
    promise,
    resolve(value) {
      if (!resolve) throw new Error("Deferred promise is not initialized");
      resolve(value);
    },
  };
}
