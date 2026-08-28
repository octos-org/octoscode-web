import { describe, expect, it } from "vitest";
import { SessionDraftCache } from "./session-draft-cache.ts";

describe("SessionDraftCache", () => {
  it("evicts the least recently used draft at its explicit bound", () => {
    const cache = new SessionDraftCache(2);
    cache.set("one", "first");
    cache.set("two", "second");
    expect(cache.get("one")).toBe("first");

    cache.set("three", "third");

    expect(cache.get("two")).toBeUndefined();
    expect(cache.get("one")).toBe("first");
    expect(cache.get("three")).toBe("third");
    expect(cache.size).toBe(2);
  });

  it("clears every draft when the authenticated principal changes", () => {
    const cache = new SessionDraftCache();
    cache.set("session-a", "private draft");
    cache.set("session-b", "another draft");

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get("session-a")).toBeUndefined();
  });

  it("rejects invalid capacity instead of silently becoming unbounded", () => {
    expect(() => new SessionDraftCache(0)).toThrow(/positive integer/);
  });
});
