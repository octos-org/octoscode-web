import { describe, expect, it } from "vitest";
import type { FileMutationNotice } from "@octos-org/octoscode-client/protocol";
import { applyFileMutation } from "./session-changes.ts";

const notice = (
  path: string,
  operation: FileMutationNotice["operation"],
  previewId: string | null = null,
): FileMutationNotice => ({
  sessionId: "s1",
  turnId: "t1",
  path,
  operation,
  previewId,
  bytesWritten: null,
});

describe("session file changes", () => {
  it("keeps one row per file, newest first, relative to the workspace", () => {
    let changes = applyFileMutation(
      [],
      notice("/srv/w/a.md", "create", "p1"),
      "/srv/w/",
    );
    changes = applyFileMutation(changes, notice("b.ts", "modify"), "/srv/w");
    changes = applyFileMutation(changes, notice("./a.md", "write"), "/srv/w");
    expect(changes).toEqual([
      // Still new, and still diffable through the preview Core kept.
      {
        path: "a.md",
        operation: "create",
        previewId: "p1",
        bytesWritten: null,
      },
      {
        path: "b.ts",
        operation: "modify",
        previewId: null,
        bytesWritten: null,
      },
    ]);
  });

  it("drops a file created and deleted in the same Session, keeps other deletes", () => {
    let changes = applyFileMutation([], notice("tmp.txt", "create"), "/w");
    changes = applyFileMutation(changes, notice("old.txt", "delete"), "/w");
    changes = applyFileMutation(changes, notice("tmp.txt", "delete"), "/w");
    expect(changes.map((change) => [change.path, change.operation])).toEqual([
      ["old.txt", "delete"],
    ]);
  });
});
