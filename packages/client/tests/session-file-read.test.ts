import { describe, expect, it } from "vitest";
import { parseSessionFileReadResult } from "../src/session.ts";

const VALID = {
  session_id: "s1",
  path: "report.md",
  size_bytes: 3,
  offset: 0,
  eof: true,
  mime_type: "text/markdown",
  encoding: "base64",
  content_base64: "YWJj",
};

describe("session/files/read result", () => {
  it("round-trips a valid base64 chunk and rejects wrong encoding or offsets", () => {
    expect(parseSessionFileReadResult({ ...VALID })).toMatchObject({
      session_id: "s1",
      path: "report.md",
      size_bytes: 3,
      offset: 0,
      eof: true,
      encoding: "base64",
      content_base64: "YWJj",
    });
    expect(
      parseSessionFileReadResult({ ...VALID, encoding: "utf8" }),
    ).toBeNull();
    expect(parseSessionFileReadResult({ ...VALID, offset: -1 })).toBeNull();
  });
});
