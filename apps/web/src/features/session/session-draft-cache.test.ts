import { describe, expect, it } from "vitest";
import {
  parseSessionDrafts,
  SessionDraftCache,
} from "./session-draft-cache.ts";

describe("SessionDraftCache", () => {
  it("refuses a new draft at its bound without evicting anyone’s unsent text", () => {
    const cache = new SessionDraftCache(2);
    cache.set("one", "first");
    cache.set("two", "second");
    expect(cache.get("one")).toBe("first");

    expect(cache.set("three", "third")).toBe(false);
    expect(cache.get("two")).toBe("second");
    expect(cache.get("one")).toBe("first");
    expect(cache.get("three")).toBeUndefined();
    expect(cache.set("one", "updated first")).toBe(true);
    expect(cache.size).toBe(2);
    expect(cache.set("two", "")).toBe(true);
    expect(cache.set("three", "third")).toBe(true);
    expect(cache.get("one")).toBe("updated first");
    expect(cache.get("three")).toBe("third");
  });

  it("rejects corrupt and excessive storage instead of restoring partial or truncated drafts", () => {
    for (const value of [
      null,
      {},
      [["a", 3]],
      [
        ["a", "ok"],
        ["a", "duplicate"],
      ],
      [["a", "x".repeat(524_288)]],
      Array.from({ length: 51 }, (_, i) => [String(i), "text"]),
    ]) {
      expect(parseSessionDrafts(value)).toEqual([]);
    }
    const input = [["a", "draft"]];
    const parsed = parseSessionDrafts(input);
    parsed[0]![1] = "changed";
    expect(input[0]![1]).toBe("draft");
  });
});
