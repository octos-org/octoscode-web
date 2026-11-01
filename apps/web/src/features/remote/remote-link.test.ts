import { describe, expect, it } from "vitest";
import { remoteLink } from "./remote-link.ts";

const recovery = (reconnectAttempt: number) => ({
  phase: "reconnecting" as const,
  sessionId: "",
  reconnectAttempt,
});

describe("remote link", () => {
  it("is online once the transport is connected, session or not", () => {
    expect(
      remoteLink({
        phase: "authenticated",
        status: "connected",
        recovery: recovery(0),
      }),
    ).toEqual({ kind: "online" });
    expect(
      remoteLink({
        phase: "ready",
        status: "connected",
        recovery: recovery(0),
      }),
    ).toEqual({ kind: "online" });
  });

  it("reconnects quietly at first, then says it is offline", () => {
    expect(
      remoteLink({
        phase: "reconnect_wait",
        status: "disconnected",
        recovery: recovery(1),
      }),
    ).toEqual({ kind: "reconnecting", attempt: 1 });
    expect(
      remoteLink({
        phase: "reconnecting",
        status: "connecting",
        recovery: recovery(3),
      }),
    ).toEqual({ kind: "offline", attempt: 3 });
    expect(
      remoteLink({ phase: "error", status: "error", recovery: recovery(0) }),
    ).toEqual({ kind: "offline", attempt: 0 });
  });
});
