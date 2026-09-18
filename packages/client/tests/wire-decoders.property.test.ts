import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  isNonEmptyString,
  isNonNegativeInteger,
  isStringArray,
  parseUiCursor,
} from "../src/wire-decoders.ts";

// Property-based tests (issue #55): the decoders must never throw for any
// input, and must satisfy their type predicates. Generated contracts own
// compile-time correctness; these tests own the runtime input space.

describe("wire-decoders property tests", () => {
  it("isNonEmptyString: accepts only non-empty strings, never throws", () => {
    const arb = fc.anything();
    fc.assert(
      fc.property(arb, (value) => {
        expect(() => isNonEmptyString(value)).not.toThrow();
        if (typeof value === "string" && value.trim().length > 0) {
          expect(isNonEmptyString(value)).toBe(true);
        } else {
          expect(isNonEmptyString(value)).toBe(false);
        }
      }),
    );
  });

  it("isNonNegativeInteger: rejects non-integers, negatives, NaN, Infinity", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => isNonNegativeInteger(value)).not.toThrow();
        if (
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0
        ) {
          expect(isNonNegativeInteger(value)).toBe(true);
        } else {
          expect(isNonNegativeInteger(value)).toBe(false);
        }
      }),
    );
  });

  it("isStringArray: accepts only string arrays", () => {
    const stringArrayArb = fc.array(fc.string());
    const mixedArb = fc.array(
      fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
    );
    fc.assert(
      fc.property(fc.oneof(stringArrayArb, mixedArb), (value) => {
        expect(() => isStringArray(value)).not.toThrow();
        expect(isStringArray(value)).toBe(
          Array.isArray(value) &&
            value.every((entry) => typeof entry === "string"),
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

  it("parseUiCursor: returns cursor for valid shapes, null otherwise", () => {
    const validCursorArb = fc.record({
      stream: fc.string({ minLength: 1 }),
      seq: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    });
    fc.assert(
      fc.property(validCursorArb, (value) => {
        const result = parseUiCursor(value);
        expect(result).not.toBeNull();
        expect(result?.stream).toBe(value.stream);
        expect(result?.seq).toBe(value.seq);
      }),
    );
    fc.assert(
      fc.property(
        fc.record({
          stream: fc.string({ minLength: 1 }),
          seq: fc.integer({ min: -1, max: -1 }),
        }),
        (value) => {
          expect(parseUiCursor(value)).toBeNull();
        },
      ),
    );
  });

  it("parseUiCursor: rejects seq that is a float or negative", () => {
    fc.assert(
      fc.property(
        fc.record({
          stream: fc.constant("test"),
          seq: fc
            .double({ noNaN: true, noDefaultInfinity: true })
            .filter((v) => !Number.isSafeInteger(v) || v < 0),
        }),
        (value) => {
          expect(parseUiCursor(value)).toBeNull();
        },
      ),
    );
  });
});
