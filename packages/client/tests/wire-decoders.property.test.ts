import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  isNonEmptyString,
  isNonNegativeInteger,
  isStringArray,
  parseUiCursor,
} from "../src/wire-decoders.ts";

// Property-based tests (issue #55): the decoders must never throw for any
// input, and must satisfy their type predicates.

describe("wire-decoders property tests", () => {
  it("isNonEmptyString: accepts only non-empty strings, never throws", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => isNonEmptyString(value)).not.toThrow();
        expect(isNonEmptyString(value)).toBe(
          typeof value === "string" && value.trim().length > 0,
        );
      }),
    );
  });

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

  it("isStringArray: accepts only string arrays", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.string(), fc.integer())), (value) => {
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

  it("parseUiCursor: valid shapes produce cursor objects", () => {
    const validArb = fc.record({
      stream: fc.string({ minLength: 1 }),
      seq: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    });
    fc.assert(
      fc.property(validArb, (value) => {
        const result = parseUiCursor(value);
        expect(result).toEqual({ stream: value.stream, seq: value.seq });
      }),
    );
  });

  it("parseUiCursor: rejects negative or float seq", () => {
    const invalidArb = fc.record({
      stream: fc.constant("test"),
      seq: fc.integer({ min: -100, max: -1 }),
    });
    fc.assert(
      fc.property(invalidArb, (value) => {
        expect(parseUiCursor(value)).toBeNull();
      }),
    );
  });
});
