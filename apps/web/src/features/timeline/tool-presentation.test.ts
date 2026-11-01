import { describe, expect, it } from "vitest";
import { toolTitle } from "./tool-presentation.ts";

describe("tool presentation", () => {
  it("maps common tools to human-readable targeted titles", () => {
    const cases = [
      ["bash", { command: "ls -la" }, "Run command {target}"],
      ["read_file", { path: "a.md" }, "Read file {target}"],
      ["write_file", { path: "a.md" }, "Write file {target}"],
      ["edit_file", { path: "a.md" }, "Edit file {target}"],
      ["apply_patch", { path: "a.md" }, "Edit file {target}"],
      ["glob", { pattern: "*.md" }, "Find files {target}"],
      ["grep", { pattern: "needle" }, "Search files for {target}"],
      ["web_fetch", { url: "https://example.com" }, "Fetch {target}"],
      ["web_search", { query: "octos" }, "Search the web for {target}"],
      ["send_file", { path: "report.md" }, "Deliver file {target}"],
    ] as const;
    for (const [name, args, key] of cases) {
      const title = toolTitle(name, JSON.stringify(args));
      expect(title.key, name).toBe(key);
      expect(title.params.target, name).toBeTruthy();
    }
  });

  it("keeps unknown tools on their server-authored name", () => {
    expect(toolTitle("custom_tool", "{}").key).toBe("");
  });
});
