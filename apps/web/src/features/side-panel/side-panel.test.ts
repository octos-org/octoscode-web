import { describe, expect, it } from "vitest";
import { folderChildren } from "./file-tree.ts";
import {
  clampPanelWidth,
  DEFAULT_PANEL_LAYOUT,
  readPanelLayout,
} from "./panel-layout.ts";
import type { SessionFileChange } from "./session-changes.ts";

const change = (path: string): SessionFileChange => ({
  path,
  operation: "modify",
  previewId: null,
  bytesWritten: null,
});

describe("file tree", () => {
  it("merges listed folders with changed files, folders first", () => {
    const changes = [
      change("report.md"),
      change("docs/q4/summary.md"),
      change("docs/plan.md"),
      change("/tmp/outside.txt"),
      change("Data.csv"),
    ];
    const listings = new Map([
      ["", ["src", "docs"]],
      ["docs", ["q4"]],
    ]);
    expect(
      folderChildren("", listings, changes).map((node) => [
        node.kind,
        node.name,
        node.kind === "folder" ? node.changed : node.path,
      ]),
    ).toEqual([
      ["folder", "docs", 2],
      ["folder", "src", 0],
      ["file", "Data.csv", "Data.csv"],
      ["file", "report.md", "report.md"],
    ]);
    // A folder the server never listed still appears when a change lives in it.
    expect(
      folderChildren("docs", new Map(), changes).map((node) => node.path),
    ).toEqual(["docs/q4", "docs/plan.md"]);
  });
});

describe("panel layout", () => {
  it("keeps the conversation readable and ignores a corrupt preference", () => {
    expect(clampPanelWidth(900)).toBe(720);
    expect(clampPanelWidth(100)).toBe(300);
    expect(clampPanelWidth(600, 900)).toBe(520);
    const storage = new Map<string, string>();
    const fake = {
      getItem: (key: string) => storage.get(key) ?? null,
    } as Storage;
    storage.set("octoscode-web:session-panel", "{not json");
    expect(readPanelLayout(fake)).toEqual(DEFAULT_PANEL_LAYOUT);
    storage.set(
      "octoscode-web:session-panel",
      JSON.stringify({ open: true, tab: "files", width: 5000 }),
    );
    expect(readPanelLayout(fake)).toEqual({
      open: true,
      tab: "files",
      width: 720,
    });
  });
});
