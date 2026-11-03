import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../timeline/entry-model.ts";
import { latestReadOnlyDenial } from "./read-only-denial.ts";

function user(id: string, body: string): TimelineEntry {
  return {
    id,
    kind: "user",
    title: "You",
    status: "complete",
    body,
    turnId: id,
  };
}

function tool(turnId: string, status: string, body: string): TimelineEntry {
  return {
    id: `${turnId}:${status}:${body}`,
    kind: "tool",
    title: "write_file",
    status,
    body,
    turnId,
  } as TimelineEntry;
}

describe("latestReadOnlyDenial", () => {
  it.each([
    "edit_file is not permitted by read-only filesystem access",
    "sed: couldn't open temporary file src/sedrDT0ni: Read-only file system",
    "cargo: Operation not permitted\n[sandbox] This denial usually means the OS sandbox blocked a file access",
  ])("recognizes Core's wording: %s", (body) => {
    expect(
      latestReadOnlyDenial([user("t1", "fix it"), tool("t1", "error", body)]),
    ).toEqual({ turnId: "t1", prompt: "fix it" });
  });

  it.each([
    "file already exists",
    "Command denied by user approval: rm -rf /tmp/copy",
    "cat: /tmp/copy/a.js: No such file or directory",
  ])("ignores other failures: %s", (body) => {
    expect(
      latestReadOnlyDenial([user("t1", "fix it"), tool("t1", "error", body)]),
    ).toBeNull();
  });

  it("ignores a tool that succeeded while printing the words", () => {
    expect(
      latestReadOnlyDenial([
        user("t1", "fix it"),
        tool("t1", "complete", "docs mention read-only mode"),
      ]),
    ).toBeNull();
  });

  it("keeps the denial while the same request tries other routes", () => {
    expect(
      latestReadOnlyDenial([
        user("t1", "fix it"),
        tool("t1", "error", "edit_file is not permitted by read-only access"),
        tool("t1", "error", "cat: /tmp/copy/a.js: No such file or directory"),
        tool("t1", "complete", "listed files"),
      ]),
    ).toEqual({ turnId: "t1", prompt: "fix it" });
  });

  it("clears once a newer request starts", () => {
    expect(
      latestReadOnlyDenial([
        user("t1", "fix it"),
        tool("t1", "error", "read-only filesystem access"),
        user("t2", "just explain it"),
      ]),
    ).toBeNull();
  });

  it("has nothing to redo without request text", () => {
    expect(
      latestReadOnlyDenial([
        user("t1", "  "),
        tool("t1", "error", "read-only filesystem access"),
      ]),
    ).toBeNull();
    expect(
      latestReadOnlyDenial([
        tool("t1", "error", "read-only filesystem access"),
      ]),
    ).toBeNull();
  });
});
