import { describe, expect, it } from "vitest";
import { listWorkspaceTree } from "../src/session-files.ts";

const ENTRY = {
  filename: "main.rs",
  path: "src/main.rs",
  kind: "file",
  size_bytes: 120,
  modified_at: "2026-11-06T00:00:00Z",
};

describe("listWorkspaceTree", () => {
  it("sends the tree params and returns one folder's page", async () => {
    const seen: unknown[] = [];
    const rpc = async (_method: string, params: unknown) => {
      seen.push(params);
      return {
        files: [{ filename: "src", path: "src", kind: "dir" }, ENTRY],
        next_cursor: "src/main.rs",
      };
    };
    const result = await listWorkspaceTree(rpc, "s1", { prefix: "" });
    expect(seen[0]).toEqual({ session_id: "s1", prefix: "", depth: 1 });
    expect(result).toEqual({
      supported: true,
      page: {
        entries: [
          { name: "src", path: "src", kind: "dir" },
          { name: "main.rs", path: "src/main.rs", kind: "file" },
        ],
        nextCursor: "src/main.rs",
      },
    });
  });

  it("reports an older Core's legacy flat listing as unsupported", async () => {
    // A Core before UPCR-2026-RDA916EB5 ignores the tree fields and answers
    // with the flat file listing (no kind).
    const rpc = async () => ({
      files: [{ filename: "check.txt", path: "pf/coding/reports/check.txt" }],
    });
    expect(await listWorkspaceTree(rpc, "s1", { prefix: "" })).toEqual({
      supported: false,
    });
  });

  it("rejects malformed entries and workspace escapes instead of showing them", async () => {
    for (const files of [
      [{ filename: "x", path: "../outside", kind: "file" }],
      [{ filename: "x", path: "C:\\abs", kind: "file" }],
      [{ filename: "x", path: "a\\b", kind: "file" }],
      [{ filename: "", path: "src/x", kind: "file" }],
      [{ filename: "x", path: "src/x", kind: "symlink" }],
    ]) {
      await expect(
        listWorkspaceTree(async () => ({ files }), "s1"),
      ).rejects.toThrow(/session\/files\.list/);
    }
  });

  it("treats an empty page as supported (nothing to show either way)", async () => {
    expect(await listWorkspaceTree(async () => ({ files: [] }), "s1")).toEqual({
      supported: true,
      page: { entries: [], nextCursor: null },
    });
  });

  it("passes the keyset cursor through and reports the end of the list", async () => {
    const seen: unknown[] = [];
    const rpc = async (_method: string, params: unknown) => {
      seen.push(params);
      return { files: [ENTRY] };
    };
    const result = await listWorkspaceTree(rpc, "s1", {
      prefix: "src",
      limit: 200,
      cursor: "src/lib.rs",
    });
    expect(seen[0]).toEqual({
      session_id: "s1",
      prefix: "src",
      depth: 1,
      limit: 200,
      cursor: "src/lib.rs",
    });
    expect(result.supported && result.page.nextCursor).toBeNull();
  });
});
