import { describe, expect, it } from "vitest";
import { RequestAuthorityGate } from "./request-authority.ts";

describe("RequestAuthorityGate", () => {
  it("requires both the latest generation and its client/session scope", () => {
    const gate = new RequestAuthorityGate<object>();
    const client = {};
    const authority = gate.begin(client, "session-a");

    expect(gate.isCurrent(authority, client, "session-a")).toBe(true);
    expect(gate.isCurrent(authority, {}, "session-a")).toBe(false);
    expect(gate.isCurrent(authority, client, "session-b")).toBe(false);
  });

  it("lets a stale scope clean up only when no newer request owns the flag", () => {
    const gate = new RequestAuthorityGate<object>();
    const client = {};
    const staleScope = gate.begin(client, "session-a");

    expect(gate.isCurrent(staleScope, {}, "session-a")).toBe(false);
    expect(gate.finish(staleScope)).toBe(true);
    expect(gate.finish(staleScope)).toBe(false);
  });

  it("does not let an older finally clear a newer request", () => {
    const gate = new RequestAuthorityGate<object>();
    const client = {};
    const older = gate.begin(client, "session-a");
    const newer = gate.begin(client, "session-b");

    expect(gate.isCurrent(older, client, "session-a")).toBe(false);
    expect(gate.finish(older)).toBe(false);
    expect(gate.isCurrent(newer, client, "session-b")).toBe(true);
    expect(gate.finish(newer)).toBe(true);
  });

  it("invalidates every completion owned by a reset projection", () => {
    const gate = new RequestAuthorityGate<object>();
    const client = {};
    const authority = gate.begin(client, "session-a");

    gate.invalidate();

    expect(gate.isCurrent(authority, client, "session-a")).toBe(false);
    expect(gate.finish(authority)).toBe(false);
  });

  it("lets a new authority start when the replaced request never settles", () => {
    const gate = new RequestAuthorityGate<object>();
    const olderClient = {};
    const newerClient = {};
    const neverSettles = gate.begin(olderClient, "session-a");

    gate.invalidate();
    const replacement = gate.begin(newerClient, "session-b");

    expect(gate.finish(neverSettles)).toBe(false);
    expect(gate.isCurrent(replacement, newerClient, "session-b")).toBe(true);
  });
});
