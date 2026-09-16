import { describe, expect, it } from "vitest";
import { toolKind } from "./tool-kind.ts";

describe("toolKind", () => {
  it("recognises the families a coding session actually runs", () => {
    expect(toolKind("shell")).toBe("shell");
    expect(toolKind("run_command")).toBe("shell");
    expect(toolKind("read_file")).toBe("read");
    expect(toolKind("readFile")).toBe("read");
    expect(toolKind("list_dir")).toBe("read");
    expect(toolKind("write_file")).toBe("edit");
    expect(toolKind("apply_patch")).toBe("edit");
    expect(toolKind("grep")).toBe("search");
    expect(toolKind("glob")).toBe("search");
    expect(toolKind("web_fetch")).toBe("web");
    expect(toolKind("browser.navigate")).toBe("web");
  });

  it("falls back to the generic mark instead of guessing", () => {
    expect(toolKind("mcp__weather__forecast")).toBe("generic");
    expect(toolKind("")).toBe("generic");
    expect(toolKind("   ")).toBe("generic");
    // "thread" contains "read" but is not a read tool: matching is word-wise.
    expect(toolKind("thread_status")).toBe("generic");
    expect(toolKind("spawn")).toBe("generic");
  });

  it("prefers the more specific family when a name carries two hints", () => {
    // Writing a file is an edit even though "file" reads like a read tool.
    expect(toolKind("write_file")).toBe("edit");
    // Running a search command is still a shell invocation.
    expect(toolKind("run_grep")).toBe("shell");
  });
});
