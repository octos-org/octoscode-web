import { describe, expect, it } from "vitest";
import { SessionDraftCache } from "./session-draft-cache.ts";

describe("SessionDraftCache", () => {
  it("refuses a new draft at its bound without evicting anyone’s unsent text", () => {
    const cache = new SessionDraftCache();
    cache.set("one", "first");
    cache.set("two", "second");
    for (let index = 2; index < 50; index += 1) {
      cache.set(String(index), "draft");
    }
    expect(cache.get("one")).toBe("first");

    // At capacity: a new draft evicts the oldest entry instead of refusing.
    expect(cache.set("three", "third")).toBe(true);
    expect(cache.get("three")).toBe("third");
    expect(cache.snapshot()).toHaveLength(50);
    expect(cache.set("one", "updated first")).toBe(true);
    expect(cache.snapshot()).toHaveLength(50);
    expect(cache.set("two", "")).toBe(true);
    expect(cache.set("three", "third")).toBe(true);
    expect(cache.get("one")).toBe("updated first");
    expect(cache.get("three")).toBe("third");
  });
});
