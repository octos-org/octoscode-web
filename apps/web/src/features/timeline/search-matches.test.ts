import { describe, expect, it } from "vitest";
import { collectMatchOffsets } from "./search-matches.ts";

describe("collectMatchOffsets", () => {
  it("finds a single match", () => {
    expect(collectMatchOffsets("hello world", "world", false)).toEqual([
      [6, 11],
    ]);
  });

  it("finds overlapping-adjacent matches without overlap", () => {
    // "aa" in "aaa" yields [0,2) then [2,4)? No — [2,4) exceeds length;
    // the second match starts after the first ends.
    expect(collectMatchOffsets("aaa", "aa", false)).toEqual([[0, 2]]);
  });

  it("finds repeated non-overlapping matches", () => {
    expect(collectMatchOffsets("ababab", "ab", false)).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
    ]);
  });

  it("ignores case by default", () => {
    expect(collectMatchOffsets("Hello HELLO hello", "hello", false)).toEqual([
      [0, 5],
      [6, 11],
      [12, 17],
    ]);
  });

  it("respects case sensitivity when requested", () => {
    expect(collectMatchOffsets("Hello HELLO hello", "hello", true)).toEqual([
      [12, 17],
    ]);
  });

  it("returns nothing for an empty needle", () => {
    expect(collectMatchOffsets("anything", "", false)).toEqual([]);
  });

  it("returns nothing when there is no match", () => {
    expect(collectMatchOffsets("abc", "xyz", false)).toEqual([]);
  });
});
