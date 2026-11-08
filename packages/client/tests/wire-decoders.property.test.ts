import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isNonNegativeInteger, parseUiCursor } from "../src/wire-decoders.ts";
// Property-based tests (issue #55): the decoders must never throw for any
// input, and must satisfy their type predicates.

describe("wire-decoders property tests", () => {
  it("isNonNegativeInteger: rejects non-integers, negatives, NaN, Infinity", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => isNonNegativeInteger(value)).not.toThrow();
        expect(isNonNegativeInteger(value)).toBe(
          typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value >= 0,
        );
      }),
    );
  });

  it("parseUiCursor: never throws for arbitrary input", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => parseUiCursor(value)).not.toThrow();
      }),
    );
  });
});
