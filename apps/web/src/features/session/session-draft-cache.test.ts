import { describe, expect, it } from "vitest";
import {
  parseSessionDrafts,
  SessionDraftCache,
} from "./session-draft-cache.ts";

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

  it("reports evictions so the durable copy can be removed with the cache entry", () => {
    const evicted: string[] = [];
    let cacheStateDuringEvict: string | undefined;
    const cache = new SessionDraftCache([], (key) => {
      evicted.push(key);
      // The callback fires after the mutation settled.
      cacheStateDuringEvict = cache.get("fresh");
    });
    for (let index = 0; index < 50; index += 1) {
      cache.set(String(index), "draft");
    }
    // Updating an existing entry at capacity evicts nothing.
    cache.set("0", "updated");
    expect(evicted).toEqual([]);
    // A new entry at capacity evicts and reports the oldest.
    cache.set("fresh", "draft");
    expect(evicted).toEqual(["0"]);
    expect(cacheStateDuringEvict).toBe("draft");
    // clear() is a rebuild, not an eviction: nothing is reported.
    cache.clear();
    expect(evicted).toEqual(["0"]);
    // With room again, a new entry evicts nothing.
    cache.set("another", "draft");
    expect(evicted).toEqual(["0"]);
  });

  it("skips corrupt entries without poisoning the entire batch", () => {
    // Non-array inputs still return empty.
    expect(parseSessionDrafts(null)).toEqual([]);
    expect(parseSessionDrafts({})).toEqual([]);
    // A single corrupt entry is skipped; good entries survive.
    expect(parseSessionDrafts([["a", 3]])).toEqual([]);
    expect(
      parseSessionDrafts([
        ["a", "ok"],
        ["bad", null],
        ["b", "ok2"],
      ]),
    ).toEqual([
      ["a", "ok"],
      ["b", "ok2"],
    ]);
    // Duplicate keys: last occurrence wins.
    expect(
      parseSessionDrafts([
        ["a", "first"],
        ["a", "second"],
      ]),
    ).toEqual([["a", "second"]]);
    // Oversized entries are skipped.
    expect(parseSessionDrafts([["a", "x".repeat(524_288)]])).toEqual([]);
    // Excess entries beyond the batch are naturally bounded by the caller.
    const input = [["a", "draft"]];
    const parsed = parseSessionDrafts(input);
    parsed[0]![1] = "changed";
    expect(input[0]![1]).toBe("draft");
  });
});
