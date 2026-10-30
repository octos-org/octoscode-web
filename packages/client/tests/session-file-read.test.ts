import { describe, expect, it } from "vitest";
import { parseSessionFileReadResult } from "../src/session.ts";

describe("session/files/read result", () => {
  it("accepts a valid base64 chunk", () => {
    expect(
      parseSessionFileReadResult({
        session_id: "s1",
        path: "report.md",
        size_bytes: 3,
        offset: 0,
        eof: true,
        mime_type: "text/markdown",
        encoding: "base64",
        content_base64: "YWJj",
      }),
    ).toMatchObject({
      session_id: "s1",
      path: "report.md",
      size_bytes: 3,
      offset: 0,
      eof: true,
      encoding: "base64",
      content_base64: "YWJj",
    });
  });

  it("rejects wrong encoding and invalid offsets", () => {
    const base = {
      session_id: "s1",
      path: "report.md",
      size_bytes: 3,
      offset: 0,
      eof: true,
      mime_type: "text/markdown",
      encoding: "base64",
      content_base64: "YWJj",
    };
    expect(
      parseSessionFileReadResult({ ...base, encoding: "utf8" }),
    ).toBeNull();
    expect(parseSessionFileReadResult({ ...base, offset: -1 })).toBeNull();
  });
});
