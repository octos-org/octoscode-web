import { describe, expect, it } from "vitest";
import { readPanelSelection, resolvePanelFile } from "./panel-selection.ts";
import type { SessionFileChange } from "./session-changes.ts";

const change: SessionFileChange = {
  path: "reports/summary.md",
  operation: "create",
  previewId: "current-preview",
  bytesWritten: 12,
};

describe("panel file identity", () => {
  it("joins only an exact workspace-relative path, never a basename or another root", () => {
    const delivered = [
      "/work/reports/summary.md",
      "/work/archive/summary.md",
      "/other/reports/summary.md",
    ];
    expect(
      resolvePanelFile(change.path, "/work/", [change], delivered),
    ).toEqual({ change, reference: delivered[0], found: true });
    expect(
      resolvePanelFile("summary.md", "/work", [change], delivered).found,
    ).toBe(false);
    expect(
      resolvePanelFile(
        "/other/reports/summary.md",
        "/work",
        [change],
        delivered,
      ).change,
    ).toBeNull();
  });

  it("uses fresh server records after reload and keeps a missing selection from becoming a read request", () => {
    const storage = {
      getItem: (key: string) =>
        key.endsWith("session-a") ? JSON.stringify(change.path) : null,
      setItem() {},
      removeItem() {},
    };
    const hint = readPanelSelection(storage, "session-a");
    expect(readPanelSelection(storage, "session-b")).toBeNull();
    expect(resolvePanelFile(hint, "/work", [], [])).toEqual({
      change: null,
      reference: null,
      found: false,
    });
    const updated = {
      ...change,
      operation: "delete" as const,
      previewId: "new-delete-preview",
    };
    expect(resolvePanelFile(hint, "/work", [updated], []).change).toBe(updated);
  });
});
