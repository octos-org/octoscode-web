import { describe, expect, it } from "vitest";
import { summarizeTurn } from "./turn-summary.ts";
import type { TimelineEntry } from "./entry-model.ts";

const tool = (
  title: string,
  path: string,
  status: TimelineEntry["status"],
  startedAtMs: number,
): TimelineEntry => ({
  id: `tool:${title}:${startedAtMs}`,
  kind: "tool",
  title,
  body: status === "error" ? "permission denied" : "ok",
  toolArguments: JSON.stringify({ path }),
  status,
  turnId: "turn-1",
  startedAtMs,
  endedAtMs: startedAtMs + 1000,
});

describe("turn summary", () => {
  it("reports duration, changed/output files, failures, and token usage", () => {
    const entries: TimelineEntry[] = [
      tool("write_file", "report.md", "complete", 1000),
      tool("edit_file", "report.md", "complete", 2000),
      tool("write_file", "notes.md", "error", 3000),
      {
        id: "terminal:turn-1",
        kind: "system",
        title: "Turn complete",
        body: "",
        status: "complete",
        turnId: "turn-1",
        startedAtMs: 1000,
        endedAtMs: 5000,
        turnUsage: { input: 12, output: 9 },
      },
    ];
    expect(summarizeTurn(entries, "turn-1")).toEqual({
      seconds: 4,
      changedFiles: ["report.md"],
      outputFiles: ["report.md"],
      failedSteps: 1,
      usage: { input: 12, output: 9 },
    });
  });
});
