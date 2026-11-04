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
    ).toEqual({ turnId: "t1", prompt: "fix it", media: [] });
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
    ).toEqual({ turnId: "t1", prompt: "fix it", media: [] });
  });

  it("redoes the whole request when a steer was added to it", () => {
    expect(
      latestReadOnlyDenial([
        { ...user("t1", "fix the bug"), id: "user:t1" },
        { ...user("t1", "only touch price.js"), id: "user-event:steer" },
        tool("t1", "error", "write_file is not permitted by read-only access"),
      ]),
    ).toEqual({
      turnId: "t1",
      prompt: "fix the bug\n\nonly touch price.js",
      media: [],
    });
  });

  it("keeps a denial when the steer arrived after it", () => {
    expect(
      latestReadOnlyDenial([
        { ...user("t1", "fix the bug"), id: "user:t1" },
        tool("t1", "error", "write_file is not permitted by read-only access"),
        { ...user("t1", "use a new file"), id: "user-event:steer" },
      ]),
    ).toMatchObject({ prompt: "fix the bug\n\nuse a new file" });
  });

  it("brings the request's files along, with the sizes the row knows", () => {
    expect(
      latestReadOnlyDenial([
        {
          ...user("t1", "summarize this"),
          media: ["uploads/sales.csv", "uploads/notes.md"],
          attachmentSizes: { "uploads/sales.csv": 23 },
        },
        tool("t1", "error", "write_file is not permitted by read-only access"),
      ]),
    ).toMatchObject({
      media: [
        {
          path: "uploads/sales.csv",
          mime: "application/octet-stream",
          size_bytes: 23,
        },
        {
          path: "uploads/notes.md",
          mime: "application/octet-stream",
          size_bytes: 0,
        },
      ],
    });
  });

  it("includes a steer Core accepted but has not echoed as a user row", () => {
    // Core gives the model a steer before it sends the steer's user_message,
    // so while the turn runs this notice is the only record of it.
    const steer = (body: string): TimelineEntry => ({
      id: `steer:${body}`,
      kind: "system",
      title: "Steering accepted",
      status: "info",
      body,
    });
    expect(
      latestReadOnlyDenial([
        steer("from an earlier request"),
        { ...user("t1", "fix the bug"), id: "user:t1" },
        steer("only touch price.js"),
        tool("t1", "error", "write_file is not permitted by read-only access"),
      ]),
    ).toMatchObject({ prompt: "fix the bug\n\nonly touch price.js" });
    expect(
      latestReadOnlyDenial([
        { ...user("t1", "fix the bug"), id: "user:t1" },
        steer("only touch price.js"),
        tool("t1", "error", "write_file is not permitted by read-only access"),
        { ...user("t1", "only touch price.js"), id: "user-event:steer" },
      ]),
    ).toMatchObject({ prompt: "fix the bug\n\nonly touch price.js" });
  });

  it("does not take another notice for a steer", () => {
    expect(
      latestReadOnlyDenial([
        { ...user("t1", "fix the bug"), id: "user:t1" },
        {
          id: "steer:x",
          kind: "system",
          title: "Steering queued",
          status: "info",
          body: "The text remains ahead of later pending prompts.",
        },
        tool("t1", "error", "write_file is not permitted by read-only access"),
      ]),
    ).toMatchObject({ prompt: "fix the bug" });
  });

  it("does not credit a later request with an earlier turn's late denial", () => {
    expect(
      latestReadOnlyDenial([
        user("t1", "fix it"),
        user("t2", "just explain it"),
        tool("t1", "error", "read-only filesystem access"),
      ]),
    ).toBeNull();
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
