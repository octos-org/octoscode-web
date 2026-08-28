import { describe, expect, it } from "vitest";
import { SessionConnectionLifecycle } from "./connection-lifecycle.ts";

const input = {
  endpoint: " http://127.0.0.1:50080 ",
  token: " secret ",
  sessionId: " coding:local:main ",
  profileId: " main ",
  cwd: " /srv/work/project ",
};

describe("SessionConnectionLifecycle", () => {
  it("normalizes identifiers but never mutates credentials", () => {
    const lifecycle = new SessionConnectionLifecycle(() => 0.5);
    expect(lifecycle.begin(input, true)).toEqual({
      endpoint: "http://127.0.0.1:50080",
      token: " secret ",
      sessionId: "coding:local:main",
      profileId: "main",
      cwd: "/srv/work/project",
    });
    expect(lifecycle.shouldResolveLaunch(false)).toBe(true);
  });

  it("does not repeat launch resolution after a durable session opened", () => {
    const lifecycle = new SessionConnectionLifecycle(() => 0.5);
    const config = lifecycle.begin(input, true);
    lifecycle.markLaunchResolved();
    lifecycle.markSessionEstablished(config);
    expect(lifecycle.shouldResolveLaunch(true)).toBe(false);
    expect(lifecycle.sessionEstablished).toBe(true);
  });

  it("can authenticate without requesting a hidden default session", () => {
    const lifecycle = new SessionConnectionLifecycle(() => 0.5);
    lifecycle.begin(input, false, false);
    expect(lifecycle.shouldOpenSession).toBe(false);
    expect(lifecycle.shouldResolveLaunch(false)).toBe(false);
    expect(lifecycle.sessionEstablished).toBe(false);
  });

  it("drops a rejected Session hint without dropping authenticated identity", () => {
    const lifecycle = new SessionConnectionLifecycle(() => 0.5);
    lifecycle.begin(input, false, false);

    expect(lifecycle.clearSessionSelection()).toEqual({
      endpoint: "http://127.0.0.1:50080",
      token: " secret ",
      sessionId: "",
      profileId: "",
      cwd: "",
    });
    expect(lifecycle.shouldOpenSession).toBe(false);
    expect(lifecycle.sessionEstablished).toBe(false);
  });

  it("uses bounded jittered backoff without giving up a durable session", () => {
    const lifecycle = new SessionConnectionLifecycle(() => 1);
    lifecycle.begin(input, false);
    expect(
      Array.from({ length: 7 }, () => lifecycle.nextReconnect()?.delayMs),
    ).toEqual([600, 1200, 2400, 4800, 6000, 6000, 6000]);
  });

  it("cannot reconnect after explicit suspension or disconnect", () => {
    const lifecycle = new SessionConnectionLifecycle();
    lifecycle.begin(input, false);
    lifecycle.suspend();
    expect(lifecycle.nextReconnect()).toBeNull();
    lifecycle.begin(input, false);
    lifecycle.disconnect();
    expect(lifecycle.nextReconnect()).toBeNull();
    expect(lifecycle.config).toBeNull();
  });
});
