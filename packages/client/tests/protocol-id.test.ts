import { describe, expect, it } from "vitest";
import { isProtocolUuid } from "../src/protocol-id.ts";

// Rust `uuid` 1.20 `Uuid::parse_str` / `try_parse` (parser.rs 147-162) accepts
// EXACTLY these byte shapes: 32-byte simple; 36-byte hyphenated; 38-byte
// `{` + hyphenated + `}`; 45-byte lowercase `urn:uuid:` + hyphenated. Hex
// digits are case-insensitive; the `{`/`}` and `urn:uuid:` bytes are exact
// (never normalized). Nil is a valid version-agnostic UUID.
const CANON = "936da01f-9abd-4d9d-80c7-02af85c822a8";
const SIMPLE = "936da01f9abd4d9d80c702af85c822a8";

const ACCEPTED: string[] = [
  // Genuine forms, including upper/mixed-case HEX.
  SIMPLE,
  "936DA01F9ABD4D9D80C702AF85C822A8",
  CANON,
  "936DA01f-9ABd-4D9d-80C7-02AF85c822A8",
  `{${CANON}}`,
  `{${CANON.toUpperCase()}}`,
  `urn:uuid:${CANON}`,
  `urn:uuid:${CANON.toUpperCase()}`,
  // Nil is a valid version-agnostic UUID in both accepted widths.
  "00000000-0000-0000-0000-000000000000",
  "00000000000000000000000000000000",
];

const REJECTED: string[] = [
  // The exact regression under repair: URN prefix + SIMPLE 32 must be refused.
  `urn:uuid:${SIMPLE}`,
  // Braced SIMPLE 32 is 34 bytes, not the exact 38 the parser branches on.
  `{${SIMPLE}}`,
  // Prefix/braces are byte-exact, never case-folded or normalized.
  `URN:UUID:${CANON}`,
  `Urn:Uuid:${CANON}`,
  `urn:UUID:${CANON}`,
  // Any surrounding or interior whitespace is a wrong shape.
  ` ${CANON}`,
  `${CANON} `,
  `urn:uuid:${CANON} `,
  ` urn:uuid:${CANON}`,
  CANON.replace("-", " "),
  // Misplaced / malformed hyphens and wrong widths.
  "936da01f9-abd-4d9d-80c7-02af85c822a8",
  "936da01f-9abd4-d9d-80c7-02af85c822a8",
  "936da01f-9abd-4d9d-80c7-02af85c822a",
  `${CANON}8`,
  `${CANON}-`,
  `-${CANON}`,
  // A non-hex character is not a valid hex pair.
  "g36da01f-9abd-4d9d-80c7-02af85c822a8",
  // Unbalanced braces and degenerate inputs.
  `{${CANON}`,
  `${CANON}}`,
  "",
  "urn:uuid:",
  "936da01f",
];

const NON_STRINGS: ReadonlyArray<readonly [string, unknown]> = [
  ["number", 42],
  ["null", null],
  ["undefined", undefined],
  ["object", { id: CANON }],
  ["array", [CANON]],
  ["boolean", true],
];

describe("isProtocolUuid — accepted Rust-parity shapes (uuid 1.20 try_parse)", () => {
  for (const value of ACCEPTED) {
    it(`accepts ${JSON.stringify(value)}`, () => {
      expect(isProtocolUuid(value)).toBe(true);
    });
  }
});

describe("isProtocolUuid — rejected malformed / wrong-shape forms", () => {
  for (const value of REJECTED) {
    it(`rejects ${JSON.stringify(value)}`, () => {
      expect(isProtocolUuid(value)).toBe(false);
    });
  }
});

describe("isProtocolUuid — non-string runtime types", () => {
  for (const [label, value] of NON_STRINGS) {
    it(`rejects ${label}`, () => {
      expect(isProtocolUuid(value)).toBe(false);
    });
  }
});

// Rust `try_parse` dispatches on the FULL byte length, so any line terminator
// appended to an otherwise-valid shape is a wrong-length input and must be
// refused. A JavaScript `$` (non-multiline) assertion must reject these too;
// this matrix proves that for every ECMAScript LineTerminator.
const TERMINATORS: ReadonlyArray<readonly [string, string]> = [
  ["LF", "\n"],
  ["CR", "\r"],
  ["CRLF", "\r\n"],
  ["U+2028", "\u2028"],
  ["U+2029", "\u2029"],
];

const TERMINATED_BASES: ReadonlyArray<readonly [string, string]> = [
  ["bare simple32", SIMPLE],
  ["bare hyphen36", CANON],
  ["urn+hyphen36", `urn:uuid:${CANON}`],
];

describe("isProtocolUuid — rejects a trailing line terminator on every shape", () => {
  for (const [baseName, base] of TERMINATED_BASES) {
    for (const [termName, terminator] of TERMINATORS) {
      it(`rejects ${baseName} + ${termName}`, () => {
        expect(isProtocolUuid(`${base}${terminator}`)).toBe(false);
      });
    }
  }
});
