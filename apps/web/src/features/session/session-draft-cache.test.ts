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

  it("rejects invalid capacity instead of silently becoming unbounded", () => {
    expect(() => new SessionDraftCache(0)).toThrow(/positive integer/);
  });
});
